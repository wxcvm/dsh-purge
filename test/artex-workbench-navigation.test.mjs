import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { DDL, RedteamStore, dispatch } from '../lib/redteam/store-core.js'

test('assets can be located by exact DSH ID without confusing equal IPs in different segments', (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(DDL)
  db.exec("INSERT INTO asset (id, segment_cidr, ip) VALUES (11, '192.0.2.0/24', '192.0.2.5'), (23, '192.0.2.0/25', '192.0.2.5')")
  const store = {
    db: () => db,
    assetChildren: RedteamStore.prototype.assetChildren,
    assetRow: RedteamStore.prototype.assetRow,
    listAssets: RedteamStore.prototype.listAssets,
  }
  const result = dispatch(store, { op: 'assets', engagement: 'target-a', asset_id: 23, limit: 100 })
  assert.equal(result.ok, true)
  assert.equal(result.total, 1)
  assert.deepEqual(result.items.map(x => x.id), [23])
  const absent = dispatch(store, { op: 'assets', engagement: 'target-a', asset_id: 999, limit: 100 })
  assert.equal(absent.total, 0)
  assert.equal(dispatch(store, { op: 'assets', engagement: 'target-a', asset_id: -5 }).ok, false)
})

test('ARTEX matching links route into the chosen engagement asset and local findings tabs', () => {
  const ui = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  for (const source of [ui, bundle]) {
    assert.match(source, /props\.onGotoAsset\(candidate\.dsh_asset_id\)/)
    assert.match(source, /props\.onGotoFindings\(candidate\.dsh_asset_id\)/)
    assert.match(source, /tab: 'assets', focus: \{ engagement: eng, kind: 'asset', assetId \}/)
    assert.match(source, /tab: 'findings', focus: \{ engagement: eng, kind: 'vulns', assetId \}/)
    assert.match(source, /focusAssetId: st\.focus && st\.focus\.engagement === eng/)
    assert.match(source, /asset_id: focusAssetId \|\| undefined/)
    assert.match(source, /查看该资产漏洞/)
    assert.match(source, /返回 ARTEX/)
  }
})
