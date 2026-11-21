import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DDL, RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import {
  createWorkItem, assignWorkItem, reportWorkItem, closeWorkItem,
  getWorkItem, listWorkItems, workRecoveryCandidates,
} from '../lib/redteam/agent-work-items.js'

function memory() {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  db.exec(DDL) // repeatable on an existing engagement
  return db
}
const create = (db, key = 'review-doc') => createWorkItem(db, {
  task_key: key, role: 'review', objective: 'Review documentation',
})
const assign = (db, task_id, session_id = 'child', run_id = 'run-1') =>
  assignWorkItem(db, { task_id, session_id, run_id })
const report = (db, task_id, status, session_id = 'child', run_id = 'run-1',
  summary = 'Review result recorded') =>
  reportWorkItem(db, { task_id, session_id, run_id, status, summary })

test('work registration is idempotent and does not overwrite the existing item', () => {
  const db = memory()
  try {
    const first = create(db)
    const duplicate = createWorkItem(db, {
      task_key: 'review-doc', role: 'other', objective: 'Must not replace original',
    })
    assert.equal(first.created, true)
    assert.equal(duplicate.created, false)
    assert.equal(first.item.id, duplicate.item.id)
    assert.equal(duplicate.item.role, 'review')
    assert.equal(getWorkItem(db, first.item.id).history.length, 0)
    assert.throws(() => create(db, 'bad\nkey'), /task_key/)
    assert.equal(listWorkItems(db).total, 1)
  } finally { db.close() }
})

test('multiple attempts preserve history and reject stale or duplicate reports', () => {
  const db = memory()
  try {
    const id = create(db).item.id
    assert.equal(assign(db, id).assigned, true)
    assert.equal(assign(db, id).assigned, false)
    assert.throws(() => assign(db, id, 'other', 'run-2'), /cannot assign/)
    assert.equal(report(db, id, 'failed').recorded, true)
    assert.equal(report(db, id, 'ready').reason, 'already-settled')
    assert.equal(assign(db, id, 'child-2', 'run-2').item.attempt, 2)
    assert.equal(report(db, id, 'ready').reason, 'stale-or-unknown-run')
    assert.equal(report(db, id, 'ready', 'child-2', 'run-2').recorded, true)
    assert.deepEqual(getWorkItem(db, id).history.map(x => x.attempt), [2, 1])
    assert.throws(() => assign(db, id, 'child-3', 'run-3'), /cannot assign/)
    assert.equal(closeWorkItem(db, { task_id: id, outcome: 'done', reason: 'Reviewed' }).closed, true)
    assert.equal(closeWorkItem(db, { task_id: id, outcome: 'done', reason: 'Again' }).closed, false)
    assert.throws(() => assign(db, id, 'child-4', 'run-4'), /cannot assign/)
  } finally { db.close() }
})

test('after restart a stored running record requires host confirmation, not auto retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-superagent-'))
  const path = join(dir, 'test.db')
  let db
  try {
    db = new DatabaseSync(path)
    db.exec(DDL)
    const id = create(db).item.id
    assign(db, id)
    db.close()
    db = new DatabaseSync(path)
    db.exec(DDL)
    const candidates = workRecoveryCandidates(db)
    assert.equal(candidates.total, 1)
    assert.equal(candidates.items[0].needs_host_check, true)
    assert.equal(candidates.items[0].host_activity, 'unverified')
    assert.equal(candidates.proof, 'stored-assignments-only')
    assert.throws(() => assign(db, id, 'new-child', 'new-run'), /cannot assign/)
    assert.equal(report(db, id, 'interrupted', 'child', 'run-1', 'Host checked, run ended').recorded, true)
    assert.equal(assign(db, id, 'new-child', 'new-run').item.attempt, 2)
  } finally {
    try { db?.close() } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('project-specific databases isolate work items and reject session/run reuse', () => {
  const a = memory(), b = memory()
  try {
    const idA = create(a).item.id, idB = create(b).item.id
    assign(a, idA, 'a-child', 'same-run')
    assign(b, idB, 'b-child', 'same-run')
    assert.throws(() => assign(a, create(a, 'another').item.id, 'a-child', 'same-run'), /another work item/)
    assert.equal(getWorkItem(b, idB).assignment.session_id, 'b-child')
  } finally { a.close(); b.close() }
})

test('manual close and filtered pages do not misrepresent incomplete work as done', () => {
  const db = memory()
  try {
    const id = create(db).item.id
    create(db, 'another')
    assert.throws(() => closeWorkItem(db, { task_id: id, outcome: 'done', reason: 'No evidence' }), /ready/)
    assign(db, id)
    assert.throws(() => closeWorkItem(db, { task_id: id, outcome: 'dropped', reason: 'Still running' }), /active/)
    assert.equal(report(db, id, 'waiting', 'child', 'run-1', 'password=PRIVATE').recorded, true)
    assert.doesNotMatch(getWorkItem(db, id).last_outcome, /PRIVATE/)
    assert.equal(listWorkItems(db, { status: 'waiting' }).total, 1)
    assert.equal(listWorkItems(db, { limit: 1 }).hasMore, true)
    assert.throws(() => listWorkItems(db, { offset: -1 }), /offset/)
    assert.throws(() => listWorkItems(db, { status: 'bogus' }), /status/)
    assert.equal(closeWorkItem(db, { task_id: id, outcome: 'dropped', reason: 'Not needed' }).item.status, 'dropped')
  } finally { db.close() }
})

test('existing dispatch routes use the selected engagement and preserve no-selection errors', () => {
  const db = memory()
  const methods = [
    'createWorkItem', 'assignWorkItem', 'reportWorkItem', 'closeWorkItem',
    'getWorkItem', 'listWorkItems', 'workRecoveryCandidates',
  ]
  const store = {
    db() { return db },
    activeEngagementId() { return 'test-project' },
    ...Object.fromEntries(methods.map(name => [name, RedteamStore.prototype[name]])),
  }
  try {
    const first = dispatch(store, { op: 'workItemCreate', engagement: 'test-project',
      task_key: 'proof-1', role: 'review', objective: 'Read an existing document' })
    assert.equal(first.ok, true)
    assert.equal(first.created, true)
    const id = first.item.id
    assert.equal(dispatch(store, { op: 'workItemAssign', engagement: 'test-project',
      task_id: id, session_id: 'child', run_id: 'run-1' }).assigned, true)
    assert.equal(dispatch(store, { op: 'workItemRecovery', engagement: 'test-project' }).total, 1)
    assert.equal(dispatch(store, { op: 'workItemGet', engagement: 'test-project', task_id: id }).item.id, id)
    assert.equal(dispatch(store, { op: 'workItemReport', engagement: 'test-project',
      task_id: id, session_id: 'child', run_id: 'run-1', status: 'ready',
      summary: 'Review complete; requires explicit acceptance' }).recorded, true)
    assert.equal(dispatch(store, { op: 'workItemClose', engagement: 'test-project',
      task_id: id, outcome: 'done', reason: 'Accepted' }).closed, true)
    assert.equal(dispatch(store, { op: 'workItemList', engagement: 'test-project' }).total, 1)
    const none = { ...store, activeEngagementId: () => undefined }
    assert.equal(dispatch(none, { op: 'workItemCreate', task_key: 'x', role: 'review',
      objective: 'x' }).ok, false)
  } finally { db.close() }
})
