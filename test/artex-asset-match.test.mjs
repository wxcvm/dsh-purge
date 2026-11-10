import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { matchArtexSourceAssets } from '../lib/redteam/artex-asset-match.js'

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, primary_name TEXT);
    CREATE TABLE asset_name (asset_id INTEGER, name TEXT);
    CREATE TABLE port (asset_id INTEGER, port INTEGER, state TEXT);
    INSERT INTO asset VALUES (1, '192.0.2.1', 'api.example.test');
    INSERT INTO asset VALUES (2, '192.0.2.2', 'shared.example.test');
    INSERT INTO asset VALUES (3, '192.0.2.3', 'third.example.test');
    INSERT INTO asset_name VALUES (1, 'service.example.test');
    INSERT INTO asset_name VALUES (3, 'shared.example.test');
    INSERT INTO port VALUES (1, 443, 'open');
    INSERT INTO port VALUES (1, 22, 'closed');
    INSERT INTO port VALUES (2, 443, 'open');
  `)
  return db
}

test('matches exact IP / domain alias and open service port without mixing source IDs', (t) => {
  const db = fixture(t)
  const result = matchArtexSourceAssets(db, [
    { asset_id: 101, ip: '192.0.2.1', port: 443, type: 'service' },
    { asset_id: 102, domain: 'SERVICE.EXAMPLE.TEST.', type: 'subdomain' },
    { asset_id: 103, domain: 'shared.example.test', type: 'subdomain' },
    { asset_id: 104, ip: '192.0.2.1', port: 22, type: 'service' },
    { asset_id: 105, ip: '198.51.100.7', type: 'ip' },
    { asset_id: 106, type: 'service' },
  ])
  assert.equal(result.matched, 2)
  assert.equal(result.ambiguous, 1)
  assert.equal(result.host_only, 1)
  assert.equal(result.unmatched, 1)
  assert.equal(result.unavailable, 1)
  assert.deepEqual(result.items[0].candidates.map(x => x.dsh_asset_id), [1])
  assert.equal(result.items[0].candidates[0].port_match, true)
  assert.equal(result.items[1].candidates[0].matched_by, 'domain')
  assert.equal(result.items[2].status, 'ambiguous')
  assert.equal(result.items[3].status, 'host_only', 'closed port cannot prove a matching service')
  assert.equal(result.read_only, true)
  assert.equal(db.prepare('SELECT count(*) AS total FROM asset').get().total, 3)
})

test('routing the match is scoped to the explicitly requested engagement', async (t) => {
  const db = fixture(t)
  const { dispatch, RedteamStore } = await import('../lib/redteam/store-core.js')
  const store = {
    db: (id) => { assert.equal(id, 'chosen-lab'); return db },
    matchArtexAssets: RedteamStore.prototype.matchArtexAssets,
  }
  const out = dispatch(store, { op: 'matchArtexAssets', engagement: 'chosen-lab',
    refs: [{ asset_id: 57, ip: '192.0.2.2' }] })
  assert.equal(out.ok, true)
  assert.equal(out.engagement, 'chosen-lab')
  assert.equal(out.matched, 1)
  assert.equal(out.items[0].candidates[0].dsh_asset_id, 2)
  const invalid = dispatch(store, { op: 'matchArtexAssets', engagement: 'chosen-lab',
    refs: [{ asset_id: '1', ip: '192.0.2.2' }] })
  assert.equal(invalid.ok, false)
})

test('match requires valid source list but does not require any source identifiers', (t) => {
  const db = fixture(t)
  assert.throws(() => matchArtexSourceAssets(db, {}), /资产列表/)
  assert.deepEqual(matchArtexSourceAssets(db, []).items, [])
})

test('missing source IP or domain does not match unrelated blank local fields', (tt) => {
  const db = fixture(tt)
  db.exec(`
    INSERT INTO asset VALUES (4, '', 'blank-ip.example.test');
    INSERT INTO asset VALUES (5, '192.0.2.5', '');
    INSERT INTO asset_name VALUES (5, '');
  `)
  const result = matchArtexSourceAssets(db, [
    { asset_id: 201, domain: 'not-seen.example.test' },
    { asset_id: 202, ip: '203.0.113.9' },
  ])
  assert.deepEqual(result.items.map((item) => item.status), ['unmatched', 'unmatched'])
  assert.equal(result.matched, 0)
})
