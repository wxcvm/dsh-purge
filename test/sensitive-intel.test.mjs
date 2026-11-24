import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readSensitiveIntel, updateSensitiveReview, sensitiveCredentialCategory } from '../lib/redteam/sensitive-intel.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE credential (id INTEGER PRIMARY KEY, asset_id INTEGER, host TEXT, username TEXT, secret_type TEXT, privilege TEXT, found_at TEXT, secret_value TEXT, secret_ref TEXT)');
  db.exec(`CREATE TABLE credential_review (credential_id INTEGER PRIMARY KEY REFERENCES credential(id) ON DELETE CASCADE, status TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  return db;
}

function add(db, id, type, privilege = '', timestamp = '2026-11-23T10:00:00Z') {
  db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, id, 'https://user:pw@asset.example/hidden?token=ANOTHER_PRIVATE_VALUE', 'operator',
    type, privilege, timestamp, 'PRIVATE_SECRET_DO_NOT_RETURN', '/private/evidence/ref'
  );
}

test('strict type classifier leaves generic passwords and tokens unclassified', () => {
  assert.equal(sensitiveCredentialCategory('SSH-password'), 'ssh');
  assert.equal(sensitiveCredentialCategory('postgres_dsn'), 'database');
  assert.equal(sensitiveCredentialCategory('AWS_AKSK'), 'cloud');
  assert.equal(sensitiveCredentialCategory('private_key'), 'keycert');
  assert.equal(sensitiveCredentialCategory('API-token'), 'api');
  assert.equal(sensitiveCredentialCategory('cookie'), 'cookie');
  assert.equal(sensitiveCredentialCategory('password'), 'other');
  assert.equal(sensitiveCredentialCategory('token'), 'other');
});

test('dashboard computes complete counts, masked projection, filtering and pagination', () => {
  const db = makeDb();
  try {
    add(db, 1, 'ssh-password', 'root');
    add(db, 2, 'postgres_dsn', 'reader', '2026-11-20T10:00:00Z');
    add(db, 3, 'password', 'unknown');
    const now = new Date('2026-11-23T14:00:00Z');
    const all = readSensitiveIntel(db, {}, now);
    assert.deepEqual(all.summary, { total: 3, highPrivilege: 1, unreviewed: 3, reviewing: 0, confirmed: 0, falsePositive: 0, resolved: 0, recent24h: 2, relatedAssets: 3, evidenceRefs: 3 });
    assert.equal(all.total, 3);
    assert.equal(all.categories.find((c) => c.id === 'other').total, 1);
    assert.equal(all.items[0].host, 'asset.example');
    assert.equal(all.items[0].has_secret, true);
    assert.equal(all.items[0].has_evidence_ref, true);
    assert.ok(!JSON.stringify(all).includes('PRIVATE_SECRET_DO_NOT_RETURN'));
    assert.ok(!JSON.stringify(all).includes('/private/evidence/ref'));
    assert.ok(!JSON.stringify(all).includes('user:pw@'));
    assert.ok(!JSON.stringify(all).includes('ANOTHER_PRIVATE_VALUE'));
    const onlySsh = readSensitiveIntel(db, { category: 'ssh', query: 'asset', limit: 1 }, now);
    assert.equal(onlySsh.total, 1);
    assert.equal(onlySsh.items[0].id, 1);
    const page = readSensitiveIntel(db, { offset: 1, limit: 1 }, now);
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, 2);
    assert.throws(() => readSensitiveIntel(db, { category: '../../' }), /invalid sensitive category/);
  } finally { db.close(); }
});

test('separate engagement handles do not mix records', () => {
  const first = makeDb(), second = makeDb();
  try {
    add(first, 1, 'ssh-password');
    assert.equal(readSensitiveIntel(first).summary.total, 1);
    assert.equal(readSensitiveIntel(second).summary.total, 0);
  } finally { first.close(); second.close(); }
});


test('review status is persisted and never assumes credential verification', () => {
  const db = makeDb();
  try {
    add(db, 1, 'ssh-password', 'root');
    add(db, 2, 'password');
    const now = new Date('2026-11-23T14:00:00Z');
    const review = updateSensitiveReview(db, 1, 'reviewing', now);
    assert.deepEqual(review, { credential_id: 1, status: 'reviewing', updated_at: now.toISOString() });
    const latest = readSensitiveIntel(db, { status: 'reviewing' }, now);
    assert.equal(latest.total, 1);
    assert.equal(latest.items[0].review_status, 'reviewing');
    assert.equal(latest.summary.unreviewed, 1);
    assert.equal(latest.summary.reviewing, 1);
    updateSensitiveReview(db, 1, 'confirmed', now);
    assert.equal(readSensitiveIntel(db, { status: 'confirmed' }, now).total, 1);
    updateSensitiveReview(db, 1, 'pending', now);
    assert.equal(readSensitiveIntel(db, { status: 'pending' }, now).total, 2);
    assert.equal(readSensitiveIntel(db, {}, now).summary.unreviewed, 2);
    assert.throws(() => updateSensitiveReview(db, 1, 'admin'), /invalid review status/);
    assert.throws(() => updateSensitiveReview(db, 9000, 'reviewing'), /credential not found/);
    assert.throws(() => readSensitiveIntel(db, { status: 'undefined' }), /invalid review status/);
  } finally { db.close(); }
});

test('metadata filters escape LIKE wildcards and never return secret or full account', () => {
  const db = makeDb();
  try {
    add(db, 1, 'ssh-password');
    add(db, 2, 'api-token');
    const a = readSensitiveIntel(db, { category: 'api', limit: 1 });
    assert.equal(a.total, 1);
    assert.equal(a.items[0].id, 2);
    assert.equal(a.items[0].username, 'o***');
    assert.equal(readSensitiveIntel(db, { query: '%', limit: 1 }).total, 0);
    assert.equal(readSensitiveIntel(db, { query: '_' }).total, 0);
    assert.equal(readSensitiveIntel(db, { query: 'operator' }).total, 2);
    assert.ok(!JSON.stringify(a).includes('PRIVATE_SECRET_DO_NOT_RETURN'));
    assert.ok(!JSON.stringify(a).includes('user:pw@'));
  } finally { db.close(); }
});

test('large record sets are paged in SQL and no entire account list is returned', () => {
  const db = makeDb();
  try {
    const insert = db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let i = 1; i <= 501; i++) {
      insert.run(i, i, 'host.example', 'user', i % 2 ? 'ssh-password' : 'postgres_dsn',
        i % 3 ? 'reader' : 'root', '2026-11-23T10:00:00Z', 'secret', '');
    }
    const last = readSensitiveIntel(db, { category: 'ssh', offset: 200, limit: 40 }, new Date('2026-11-23T14:00:00Z'));
    assert.equal(last.summary.total, 501);
    assert.equal(last.total, 251);
    assert.equal(last.items.length, 40);
    assert.equal(last.items[0].id, 101);
    assert.ok(last.items.every((item) => item.category === 'ssh'));
  } finally { db.close(); }
});
