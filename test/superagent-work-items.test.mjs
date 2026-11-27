import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DDL, migrate, RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import {
  createWorkItem, assignWorkItem, reportWorkItem, closeWorkItem,
  getWorkItem, listWorkItems, workRecoveryCandidates, observeWorkItemEnd,
} from '../lib/redteam/agent-work-items.js'
import { captureAgentEndReport } from '../lib/redteam/agent-attention.js'
import { createReservations } from '../lib/redteam/agent-reservations.js'
import { bindSession } from '../lib/redteam/session-bindings.js'

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
  reportWorkItem(db, { task_id, session_id, run_id, status, summary, host_checked: true })

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
    'createWorkItem', 'assignWorkItem', 'reportWorkItem', 'closeWorkItem', 'requestWorkItemChanges',
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
      summary: 'Review complete; requires explicit acceptance', host_checked: true }).recorded, true)
    assert.equal(dispatch(store, { op: 'workItemClose', engagement: 'test-project',
      task_id: id, outcome: 'done', reason: 'Accepted' }).closed, true)
    assert.equal(dispatch(store, { op: 'workItemList', engagement: 'test-project' }).total, 1)
    const none = { ...store, activeEngagementId: () => undefined }
    assert.equal(dispatch(none, { op: 'workItemCreate', task_key: 'x', role: 'review',
      objective: 'x' }).ok, false)
  } finally { db.close() }
})

test('review feedback survives reopening, a second attempt, and final acceptance', t => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-work-review-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'work.db')
  const methods = ['requestWorkItemChanges', 'closeWorkItem', 'getWorkItem']
  const store = { activeEngagementId: () => 'docs', db: () => db,
    ...Object.fromEntries(methods.map(name => [name, RedteamStore.prototype[name]])) }
  let db = new DatabaseSync(file)
  try {
    db.exec(DDL)
    const id = create(db).item.id
    assign(db, id)
    const first = report(db, id, 'ready', 'child', 'run-1', 'Checked the headings')
    const req = { op: 'workItemRequestChanges', engagement: 'docs', task_id: id,
      expected_revision: first.item.revision, reason: 'Please add the appendix' }
    assert.equal(dispatch(store, { ...req, expected_revision: undefined }).ok, false)
    assert.equal(dispatch({ ...store, activeEngagementId: () => null }, { ...req, engagement: undefined }).ok, false)
    const returned = dispatch(store, req)
    assert.equal(returned.returned, true)
    assert.equal(returned.item.status, 'waiting')
    assert.equal(returned.item.attempt, 1)
    assert.equal(returned.item.assignment.status, 'ready')
    assert.equal(returned.item.assignment.summary, 'Checked the headings')
    assert.equal(returned.item.assignment.review_feedback, req.reason)
    assert.ok(returned.item.assignment.review_returned_at)
    assert.equal(dispatch(store, req).returned, false)
    assert.equal(getWorkItem(db, id).history.length, 1, 'review feedback cannot create a new run')
    db.close()

    db = new DatabaseSync(file)
    migrate(db)
    const pending = getWorkItem(db, id)
    assert.equal(pending.status, 'waiting')
    assert.equal(pending.history[0].review_feedback, req.reason)
    assign(db, id, 'child', 'run-2')
    assert.equal(getWorkItem(db, id).history[1].review_feedback, req.reason)
    const second = report(db, id, 'ready', 'child', 'run-2', 'Checked the headings and added the appendix')
    assert.equal(dispatch(store, req).returned, false, 'the first review cannot return the new attempt')
    const close = { op: 'workItemClose', engagement: 'docs', task_id: id, outcome: 'done', reason: 'Accepted the corrected result' }
    assert.equal(dispatch(store, { ...close, expected_revision: first.item.revision }).closed, false)
    assert.equal(getWorkItem(db, id).status, 'ready')
    assert.equal(dispatch(store, { ...close, expected_revision: second.item.revision }).closed, true)
    assert.deepEqual(getWorkItem(db, id).history.map(run => [run.run_id, run.review_feedback]),
      [['run-2', null], ['run-1', req.reason]])
  } finally { if (db.isOpen) db.close() }
})

test('unobserved run requires explicit operator attestation; observed exact end does not', () => {
  const db = memory()
  try {
    const taskId = create(db, 'unobserved-run').item.id
    assign(db, taskId, 'child', 'run-1')
    const request = { task_id: taskId, session_id: 'child', run_id: 'run-1',
      status: 'ready', summary: 'Read host logs before settling' }
    assert.throws(() => reportWorkItem(db, request), /operator host check/)
    assert.equal(getWorkItem(db, taskId).status, 'running')
    assert.equal(reportWorkItem(db, { ...request, host_checked: true }).recorded, true)
    assert.equal(getWorkItem(db, taskId).assignment.settlement_basis, 'operator-attestation')

    const observedId = create(db, 'observed-run').item.id
    assign(db, observedId, 'ended-child', 'run-2')
    observeWorkItemEnd(db, { session_id: 'ended-child', run_id: 'run-2', stop_reason: 'completed' })
    assert.equal(reportWorkItem(db, { task_id: observedId, session_id: 'ended-child',
      run_id: 'run-2', status: 'ready', summary: 'Host event observed' }).recorded, true)
    assert.equal(getWorkItem(db, observedId).assignment.settlement_basis, 'host-end-observed')
  } finally { db.close() }
})

test('host end is observed once and must never infer done or clear a running task', () => {
  const db = memory()
  try {
    const id = create(db).item.id
    assign(db, id, 'child', 'run-1')
    assert.deepEqual(observeWorkItemEnd(db, { session_id: 'other-child', run_id: 'run-1' }),
      { observed: false, reason: 'unmatched-run' })
    const observed = observeWorkItemEnd(db, {
      session_id: 'child', run_id: 'run-1', stop_reason: 'completed',
    })
    assert.equal(observed.observed, true)
    assert.equal(observed.task_id, id)
    const current = getWorkItem(db, id)
    assert.equal(current.status, 'running')
    assert.equal(current.host_activity, 'end-observed')
    assert.equal(current.needs_host_check, false)
    assert.equal(current.needs_settlement, true)
    assert.equal(current.assignment.host_stop_reason, 'completed')
    assert.equal(observeWorkItemEnd(db, {
      session_id: 'child', run_id: 'run-1', stop_reason: 'error',
    }).reason, 'already-observed')
    assert.equal(getWorkItem(db, id).assignment.host_stop_reason, 'completed')
    assert.throws(() => assign(db, id, 'next', 'run-2'), /cannot assign/)
    assert.equal(report(db, id, 'ready').recorded, true)
    assert.equal(closeWorkItem(db, { task_id: id, outcome: 'done', reason: 'Reviewed' }).closed, true)
  } finally { db.close() }
})

test('a delayed host end can annotate history but cannot override the new attempt', () => {
  const db = memory()
  try {
    const id = create(db).item.id
    assign(db, id, 'child', 'old-run')
    report(db, id, 'failed', 'child', 'old-run')
    assign(db, id, 'next', 'new-run')
    assert.equal(observeWorkItemEnd(db, {
      session_id: 'child', run_id: 'old-run', stop_reason: 'aborted',
    }).observed, true)
    const current = getWorkItem(db, id)
    assert.equal(current.attempt, 2)
    assert.equal(current.status, 'running')
    assert.equal(current.needs_host_check, true)
    assert.equal(current.history[1].host_stop_reason, 'aborted')
    assert.equal(current.history[1].settlement_basis, 'operator-attestation')
    assert.equal(current.history[0].settlement_basis, null)
    assert.equal(current.history[0].host_end_at, null)
    assert.equal(workRecoveryCandidates(db).total, 1)
  } finally { db.close() }
})

test('real subagent/end records only matching bound work, even without redteamReport', () => {
  const db = memory(), other = memory()
  const store = {
    db(id) { return id === 'demo' ? db : id === 'other' ? other : undefined },
    recordAgentReport: RedteamStore.prototype.recordAgentReport,
    observeWorkItemEnd: RedteamStore.prototype.observeWorkItemEnd,
  }
  try {
    bindSession(store, { agent: { session: { id: 'root-demo' } } }, 'demo', { persist: false })
    const id = create(db).item.id
    assign(db, id, 'child-demo', 'actual-run')
    const book = createReservations()
    const event = { id: 'child-demo', runId: 'actual-run', parentSessionId: 'root-demo',
      stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'A final note without marker' }] }
    assert.equal(captureAgentEndReport(store, book, event), null)
    assert.equal(getWorkItem(db, id).host_activity, 'end-observed')
    assert.equal(getWorkItem(db, id).status, 'running')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_attention').get().n, 0)
    assert.equal(captureAgentEndReport(store, book, event), null)
    assert.equal(getWorkItem(db, id).assignment.host_stop_reason, 'completed')
    assert.equal(other.prepare('SELECT COUNT(*) AS n FROM agent_work_assignment').get().n, 0)
    const unrelated = { ...event, parentSessionId: 'foreign-root' }
    assert.equal(captureAgentEndReport(store, book, unrelated), null)
    assert.equal(getWorkItem(db, id).status, 'running')
  } finally { db.close(); other.close() }
})

test('optional observational failure does not prevent the existing attention report', () => {
  const db = memory()
  const errors = []
  const store = {
    db() { return db },
    recordAgentReport: RedteamStore.prototype.recordAgentReport,
    observeWorkItemEnd() { throw new Error('synthetic ledger fault') },
  }
  try {
    bindSession(store, { agent: { session: { id: 'root' } } }, 'demo', { persist: false })
    const end = { id: 'child', runId: 'run-1', parentSessionId: 'root', stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'redteamReport: {"status":"ready"}' }] }
    const result = captureAgentEndReport(store, createReservations(), end, error => errors.push(error.message))
    assert.equal(result.recorded, true)
    assert.deepEqual(errors, ['synthetic ledger fault'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_attention').get().n, 1)
  } finally { db.close() }
})

test('old work assignment tables gain observational columns without losing existing rows', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE agent_work_assignment (id INTEGER PRIMARY KEY, task_id INTEGER, attempt INTEGER, session_id TEXT, run_id TEXT, status TEXT, summary TEXT, started_at TEXT, finished_at TEXT)')
    db.exec("INSERT INTO agent_work_assignment (id,task_id,attempt,session_id,run_id,status,started_at) VALUES (17,9,1,'old-session','old-run','running','2026-01-01')")
    db.exec(DDL)
    migrate(db)
    migrate(db)
    const columns = db.prepare('PRAGMA table_info(agent_work_assignment)').all().map(x => x.name)
    assert.ok(columns.includes('host_end_at'))
    assert.ok(columns.includes('host_stop_reason'))
    assert.ok(columns.includes('review_feedback'))
    assert.ok(columns.includes('review_returned_at'))
    assert.ok(columns.includes('settlement_basis'))
    const old = db.prepare('SELECT * FROM agent_work_assignment WHERE id = 17').get()
    assert.equal(old.session_id, 'old-session')
    assert.equal(old.run_id, 'old-run')
    assert.equal(old.host_end_at, null)
    assert.equal(old.review_feedback, null)
    assert.equal(old.settlement_basis, null)
  } finally { db.close() }
})
