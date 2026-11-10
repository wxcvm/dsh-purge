import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('findings evidence and gained filters cover the entire SQLite result, not just one UI page', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, segment_cidr TEXT);
      CREATE TABLE vuln (
        id INTEGER PRIMARY KEY, asset_id INTEGER, title TEXT, severity TEXT,
        status TEXT, evidence TEXT, gained TEXT, cve TEXT, target TEXT
      );
      CREATE TABLE http_evidence (
        id INTEGER PRIMARY KEY, vuln_id INTEGER, label TEXT, method TEXT, url TEXT,
        status INTEGER, request TEXT, response TEXT, note TEXT, captured_by TEXT, captured_at TEXT
      );
      INSERT INTO asset VALUES (1, '192.0.2.1', '192.0.2.0/24');
      INSERT INTO vuln VALUES
        (1, 1, 'text evidence', 'high', 'confirmed', 'independent observation', '', '', 'example.test'),
        (2, 1, 'HTTP evidence', 'high', 'candidate', '', '', '', 'example.test'),
        (3, 1, 'empty HTTP row', 'high', 'candidate', '   ', '', '', 'example.test'),
        (4, 1, 'no evidence but gained', 'high', 'confirmed', '', 'reviewed', '', 'example.test');
      INSERT INTO http_evidence (vuln_id, request, response, note) VALUES
        (2, 'GET /test HTTP/1.1', '', ''),
        (3, '', '', '   ');
    `)
    const store = { db: () => db }
    const query = (filters = {}) => RedteamStore.prototype.listVulns.call(store, 'test', filters)
    const stats = RedteamStore.prototype.vulnStats.call(store, 'test')
    assert.equal(stats.total, 4)
    assert.equal(stats.withEvidence, 2, 'empty HTTP rows must not count as evidence')
    assert.equal(stats.withGained, 1)
    assert.deepEqual(query({ evidence: 'present' }).items.map((x) => x.id), [2, 1])
    assert.deepEqual(query({ evidence: 'missing' }).items.map((x) => x.id), [4, 3])
    assert.deepEqual(query({ evidence: 'missing', gained: 'present' }).items.map((x) => x.id), [4])
    assert.deepEqual(query({ gained: 'missing' }).items.map((x) => x.id), [3, 2, 1])
    const filtered = query({ evidence: 'present', status: 'candidate', limit: 1, offset: 0 })
    assert.equal(filtered.total, 1)
    assert.equal(filtered.items[0].id, 2)
    const compact = query({ evidence: 'present', withHttpEvidence: false })
    assert.equal(compact.items.find((x) => x.id === 2).http_evidence_count, 1)
    assert.equal(Object.hasOwn(compact.items[0], 'http_evidence'), false)
  } finally {
    db.close()
  }
})

test('findings UI exposes real server-side evidence filters and ignores stale query responses', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  assert.match(source, /evidence: evidence \|\| undefined, gained: gained \|\| undefined/)
  assert.match(source, /concl\('missing-evi', '待补证据'/)
  assert.match(source, /concl\('gain', '拿到权限', .*gained === 'present'/)
  assert.match(source, /generation !== loadGeneration.current/)
  assert.match(source, /state.loading && subTab === 'vulns'/)
})
