import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('SQLite checklists persist, do not reinterpret existing test status, and reopen on edit', t => {
  const home = mkdtempSync(join(tmpdir(), 'purge-review-checklist-'))
  let store = new RedteamStore(home)
  t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }) })
  const external = store.openEngagement('review-external', ['192.0.2.0/24'], { bindCurrent: false }).id
  const internal = store.openEngagement('review-internal', ['10.40.0.0/24'], { bindCurrent: false }).id
  store.importBundle(external, { scan: { tool: 'fixture', argv: [] },
    assets: [{ ip: '192.0.2.7', provenance: 'passive', tool: 'fixture', state: 'live' }] })
  store.importBundle(internal, { scan: { tool: 'fixture', argv: [] },
    assets: [{ ip: '10.40.0.7', provenance: 'passive', tool: 'fixture', state: 'live' }] })
  const extId = store.listAssets(external, { ip: '192.0.2.7' }).items[0].id
  const intId = store.listAssets(internal, { ip: '10.40.0.7' }).items[0].id
  assert.equal(store.db(external).prepare('SELECT COUNT(*) AS n FROM asset_checklist').get().n, 0)
  const first = store.coverageChecklist(external, extId, 'external')
  assert.equal(first.complete, false)
  assert.deepEqual(first.missing, ['surface', 'web', 'auth', 'cve', 'app'])
  assert.equal(store.coverageQueue(external, 'external').pending_in_sample, 1)
  assert.equal(store.db(external).prepare('SELECT COUNT(*) AS n FROM asset_checklist').get().n, 0,
    'status and queue must not materialize defaults in the database')
  assert.throws(() => store.closeCoverageChecklist(external, extId, 'external', 'closed'),
    /checklist incomplete/)
  assert.equal(store.coverageChecklist(external, extId, 'external').status, 'open')
  const updates = ['surface', 'web', 'auth', 'cve', 'app'].map(field => ({ field, state: 'done' }))
  const done = store.updateCoverageChecklist(external, extId, 'external', updates, 'Reviewed manually')
  assert.equal(done.ready_to_close, true)
  assert.equal(done.complete, false)
  assert.equal(store.coverageQueue(external, 'external').items[0].ready_to_close, true)
  const closed = store.closeCoverageChecklist(external, extId, 'external', 'closed')
  assert.equal(closed.complete, true)
  assert.equal(store.coverageQueue(external, 'external').pending_in_sample, 0)
  const reopened = store.updateCoverageChecklist(external, extId, 'external',
    [{ field: 'web', state: 'partial' }])
  assert.equal(reopened.status, 'open')
  assert.deepEqual(reopened.missing, ['web'])
  assert.equal(reopened.note, 'Reviewed manually')
  assert.throws(() => store.closeCoverageChecklist(external, extId, 'external', 'blocked', ''),
    /blocked requires a reason/)
  assert.equal(store.closeCoverageChecklist(external, extId, 'external', 'blocked',
    'Permission unavailable').complete, false)
  assert.equal(store.coverageQueue(external, 'external').pending_in_sample, 0)
  assert.equal(store.getAsset(external, extId).test_status, 'untested',
    'checklists must not silently change the old testing lifecycle')
  assert.equal(store.db(internal).prepare('SELECT COUNT(*) AS n FROM asset_checklist').get().n, 0)
  assert.deepEqual(store.coverageChecklist(internal, intId, 'internal').missing,
    ['files', 'privesc', 'web', 'db', 'lateral'])
  assert.equal(store.coverageQueue(internal, 'internal').items[0].asset_id, intId)
  assert.equal(store.coverageQueue(internal, 'external').pending_in_sample, 0)
  assert.throws(() => store.updateCoverageChecklist(internal, intId, 'internal',
    [{ field: 'cve', state: 'done' }]), /unknown coverage field/)
  assert.throws(() => store.coverageChecklist(external, 999999, 'external'), /asset not found/)
  store.close()
  store = new RedteamStore(home)
  assert.equal(store.coverageChecklist(external, extId, 'external').status, 'blocked')
  assert.equal(store.coverageChecklist(external, extId, 'external').blocked_reason,
    'Permission unavailable')
  assert.equal(store.coverageChecklist(internal, intId, 'internal').status, 'open')
})
