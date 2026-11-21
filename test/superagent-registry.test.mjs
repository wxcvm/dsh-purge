import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DDL, RedteamStore } from '../lib/redteam/store-core.js'
import { collectAgentStatus, reconcileWorkItemRegistry } from '../lib/redteam/agent-status.js'
import { handleWorkItemReview } from '../lib/redteam/ui.js'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  const names = ['active', 'ended', 'unmatched']
  const ids = names.map(name => {
    const created = RedteamStore.prototype.createWorkItem.call({ db: () => db }, 'one',
      { task_key: name, role: 'review', objective: 'Review ' + name })
    return created.item.id
  })
  const store = { db: () => db, activeEngagementId: () => 'one',
    listWorkItems: RedteamStore.prototype.listWorkItems,
    getWorkItem: RedteamStore.prototype.getWorkItem,
    createWorkItem: RedteamStore.prototype.createWorkItem,
    assignWorkItem: RedteamStore.prototype.assignWorkItem,
    observeWorkItemEnd: RedteamStore.prototype.observeWorkItemEnd }
  for (let i = 0; i < ids.length; i++) {
    store.assignWorkItem('one', { task_id: ids[i], session_id: names[i], run_id: 'run-' + i })
  }
  store.observeWorkItemEnd('one', { session_id: 'ended', run_id: 'run-1', stop_reason: 'completed' })
  return { store, db, ids }
}

const registry = { ok: true, available: true, running: [
  { id: 'active', parent: 'root-1', activity: 'running' },
] }

test('live registry reconciles session activity but never settles exact runs', async () => {
  const { store, db, ids } = fixture()
  try {
    const result = await handleWorkItemReview(store,
      { op: 'workItemReview', engagement: 'one' }, async () => registry)
    assert.equal(result.ok, true)
    assert.equal(result.total, 3)
    const byKey = new Map(result.items.map(item => [item.task_key, item]))
    assert.equal(byKey.get('active').registry_activity.state, 'session-active-observed')
    assert.equal(byKey.get('active').registry_activity.parent_session, 'root-1')
    assert.equal(byKey.get('active').registry_activity.exact_run_verified, false)
    assert.equal(byKey.get('active').needs_host_check, true)
    assert.equal(byKey.get('ended').registry_activity.state, 'exact-run-end-observed')
    assert.equal(byKey.get('ended').registry_activity.exact_run_verified, true)
    assert.equal(byKey.get('ended').needs_settlement, true)
    assert.equal(byKey.get('unmatched').registry_activity.state, 'not-in-active-snapshot')
    assert.equal(byKey.get('unmatched').needs_host_check, true)
    assert.deepEqual(ids.map(id => store.getWorkItem('one', id).status), ['running', 'running', 'running'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_work_assignment WHERE finished_at IS NOT NULL').get().n, 0)
  } finally { db.close() }
})

test('partial, unavailable and truncated registries never prove absence or available capacity', () => {
  const listing = { total: 1, items: [{ status: 'running', assignment: { session_id: 'child-x' } }] }
  for (const status of [
    { ok: false, available: false, error: 'offline', running: [] },
    { ok: true, available: false, running: [] },
    { ok: true, available: true, running_truncated: true, running: [] },
  ]) {
    const result = reconcileWorkItemRegistry(listing, status, '2026-11-21T00:00:00Z')
    assert.equal(result.items[0].registry_activity.state, 'unknown')
    assert.equal(result.registry.available, false)
    assert.equal(result.registry.partial, true)
  }
})

test('Host status is obtained from the actual child registry, not assignment strings', async () => {
  const { store, db } = fixture()
  const ctx = {
    sessions: { list: async () => [{ id: 'root-1', header: {} }] },
    subagents: { listChildren: async () => [
      { id: 'active', kind: 'child', activity: 'running' },
      { id: 'ended', kind: 'child', activity: 'idle' },
    ] },
  }
  try {
    const result = await handleWorkItemReview(store, { op: 'workItemReview', engagement: 'one' },
      () => collectAgentStatus(ctx))
    assert.equal(result.registry.available, true)
    assert.equal(result.items.find(item => item.task_key === 'active').registry_activity.state, 'session-active-observed')
    assert.equal(result.items.find(item => item.task_key === 'unmatched').registry_activity.state, 'not-in-active-snapshot')
    const error = await handleWorkItemReview(store, { op: 'workItemReview', engagement: 'one' },
      async () => { throw Error('temporary registry fault') })
    assert.equal(error.registry.partial, true)
    assert.equal(error.items.find(item => item.task_key === 'unmatched').registry_activity.state, 'unknown')
  } finally { db.close() }
})

test('review respects target selection and never reads registry for an empty page', async () => {
  const { store, db } = fixture()
  let reads = 0
  try {
    assert.equal((await handleWorkItemReview({ ...store, activeEngagementId: () => '' },
      { op: 'workItemReview' }, () => { reads++; return registry })).ok, false)
    assert.equal(reads, 0)
    const result = await handleWorkItemReview(store,
      { op: 'workItemReview', engagement: 'one', status: 'queued' }, () => { reads++; return registry })
    assert.equal(result.total, 0)
    assert.equal(result.registry.source, 'not-needed')
    assert.equal(reads, 0)
    assert.equal(await handleWorkItemReview(store, { op: 'notWorkItemReview' }, () => registry), undefined)
  } finally { db.close() }
})
