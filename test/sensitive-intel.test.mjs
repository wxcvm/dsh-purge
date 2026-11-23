import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readSensitiveIntel, sensitiveCredentialCategory } from '../lib/redteam/sensitive-intel.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE credential (id INTEGER PRIMARY KEY, asset_id INTEGER, host TEXT, username TEXT, secret_type TEXT, privilege TEXT, found_at TEXT, secret_value TEXT, secret_ref TEXT)');
  return db;
}

function add(db, id, type, privilege = '', timestamp = '2026-11-23T10:00:00Z') {
  db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, id, 'https://user:pw@asset.example', 'operator',
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
    assert.deepEqual(all.summary, { total: 3, highPrivilege: 1, unreviewed: 3, recent24h: 2, relatedAssets: 3, evidenceRefs: 3 });
    assert.equal(all.total, 3);
    assert.equal(all.categories.find((c) => c.id === 'other').total, 1);
    assert.equal(all.items[0].host, 'asset.example');
    assert.equal(all.items[0].has_secret, true);
    assert.equal(all.items[0].has_evidence_ref, true);
    assert.ok(!JSON.stringify(all).includes('PRIVATE_SECRET_DO_NOT_RETURN'));
    assert.ok(!JSON.stringify(all).includes('/private/evidence/ref'));
    assert.ok(!JSON.stringify(all).includes('user:pw@'));
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
