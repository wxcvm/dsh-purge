/**
 * Durable, explicitly recorded SuperAgent work items. An assignment records a
 * claimed session/run, NOT proof that a Harness worker was started or stopped.
 * The agent_attention queue and the native Agent Teams board remain authoritative
 * for their respective concepts; this module never dispatches a child or tool.
 */
import { redactCredentialText } from './report-shareable.js'

const OUTCOMES = new Set(['waiting', 'ready', 'blocked', 'failed', 'interrupted'])
const OPEN_FOR_ASSIGNMENT = new Set(['queued', 'waiting', 'blocked', 'failed', 'interrupted'])
const STATUS_FILTERS = new Set(['queued', 'running', ...OUTCOMES, 'done', 'dropped'])
const selectItem = 'SELECT id, task_key, role, objective, status, attempt, revision, last_outcome, created_at, updated_at FROM agent_work_item'
const selectRun = 'SELECT id, task_id, attempt, session_id, run_id, status, summary, started_at, finished_at, host_end_at, host_stop_reason, review_feedback, review_returned_at FROM agent_work_assignment'

function string(value, field, max, { multiline = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(field + ' must be text')
  const text = value.trim()
  if (!text || text.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
      || (!multiline && /[\r\n]/.test(text))) {
    throw new TypeError(field + ' must be 1..' + max + ' characters' + (multiline ? '' : ' on one line'))
  }
  return text
}
function idOf(value, field = 'task_id') {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(field + ' must be a positive integer')
  return n
}
function reviewRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('expected_revision must be a nonnegative integer')
  return value
}
function safeSummary(value, field, max = 2000) {
  if (typeof value !== 'string') throw new TypeError(field + ' must be text')
  const txt = string(value, field, max, { multiline: true })
  return redactCredentialText(txt)
}
function page(options = {}) {
  const limit = options.limit === undefined ? 30 : Number(options.limit)
  const offset = options.offset === undefined ? 0 : Number(options.offset)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit must be 1..100')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('offset must be nonnegative')
  return { limit, offset }
}
function atomic(db, callback) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* retain original failure */ }
    throw error
  }
}
function itemById(db, taskId) { return db.prepare(selectItem + ' WHERE id = ?').get(taskId) || null }
function latestAssignment(db, taskId) {
  return db.prepare(selectRun + ' WHERE task_id = ? ORDER BY attempt DESC LIMIT 1').get(taskId) || null
}
function workView(db, task) {
  if (!task) return null
  const assignment = latestAssignment(db, task.id)
  return { ...task, assignment,
    // A persisted running flag cannot establish whether the original host still runs.
    host_activity: assignment?.host_end_at ? 'end-observed' : task.status === 'running' ? 'unverified' : 'not-observed',
    needs_host_check: task.status === 'running' && !assignment?.host_end_at,
    needs_settlement: task.status === 'running' && Boolean(assignment?.host_end_at),
    execution_verified: false,
  }
}

/** Duplicate registration is idempotent and never silently overwrites task metadata. */
export function createWorkItem(db, input = {}) {
  const key = string(input.task_key, 'task_key', 180)
  const role = string(input.role, 'role', 64)
  const objective = safeSummary(input.objective, 'objective', 2000)
  return atomic(db, () => {
    const previous = db.prepare(selectItem + ' WHERE task_key = ?').get(key)
    if (previous) return { created: false, item: workView(db, previous) }
    const now = new Date().toISOString()
    const row = db.prepare('INSERT INTO agent_work_item(task_key, role, objective, status, attempt, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)')
      .run(key, role, objective, 'queued', now, now)
    return { created: true, item: workView(db, itemById(db, Number(row.lastInsertRowid))) }
  })
}

/** Explicitly bind a known Harness session and run to one task attempt. */
export function assignWorkItem(db, input = {}) {
  const taskId = idOf(input.task_id)
  const session = string(input.session_id, 'session_id', 256)
  const run = string(input.run_id, 'run_id', 256)
  return atomic(db, () => {
    const task = itemById(db, taskId)
    if (!task) throw new Error('work item not found')
    const latest = latestAssignment(db, taskId)
    if (latest?.session_id === session && latest?.run_id === run) {
      return { assigned: false, reason: 'duplicate-run', item: workView(db, task) }
    }
    if (!OPEN_FOR_ASSIGNMENT.has(task.status)) throw new Error('cannot assign work item in ' + task.status + ' state')
    const claimedElsewhere = db.prepare('SELECT task_id FROM agent_work_assignment WHERE session_id = ? AND run_id = ? LIMIT 1').get(session, run)
    if (claimedElsewhere) throw new Error('session/run already belongs to another work item')
    const now = new Date().toISOString()
    const next = task.attempt + 1
    db.prepare('INSERT INTO agent_work_assignment(task_id, attempt, session_id, run_id, status, started_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(taskId, next, session, run, 'running', now)
    db.prepare('UPDATE agent_work_item SET status = ?, attempt = ?, revision = revision + 1, last_outcome = NULL, updated_at = ? WHERE id = ?')
      .run('running', next, now, taskId)
    return { assigned: true, item: workView(db, itemById(db, taskId)) }
  })
}

/** Exact-run, one-shot settlement: a delayed previous run cannot change a new one. */
export function reportWorkItem(db, input = {}) {
  const taskId = idOf(input.task_id)
  const session = string(input.session_id, 'session_id', 256)
  const run = string(input.run_id, 'run_id', 256)
  const status = String(input.status || '')
  if (!OUTCOMES.has(status)) throw new TypeError('invalid assignment outcome')
  const summary = safeSummary(input.summary, 'summary')
  return atomic(db, () => {
    const task = itemById(db, taskId)
    if (!task) throw new Error('work item not found')
    const latest = latestAssignment(db, taskId)
    if (!latest || latest.session_id !== session || latest.run_id !== run) {
      return { recorded: false, reason: 'stale-or-unknown-run', item: workView(db, task) }
    }
    if (latest.status !== 'running') {
      return { recorded: false, reason: 'already-settled', item: workView(db, task) }
    }
    if (task.status !== 'running' || latest.attempt !== task.attempt) {
      throw new Error('inconsistent item and assignment state')
    }
    // Host-end is authoritative about the run lifecycle. Without it, only an
    // explicit operator attestation can settle this attempt; a model report is
    // not evidence that the worker actually stopped.
    if (!latest.host_end_at && input.host_checked !== true) {
      throw new Error('unobserved run requires an explicit operator host check')
    }
    const now = new Date().toISOString()
    db.prepare('UPDATE agent_work_assignment SET status = ?, summary = ?, finished_at = ? WHERE id = ? AND status = ?')
      .run(status, summary, now, latest.id, 'running')
    db.prepare('UPDATE agent_work_item SET status = ?, last_outcome = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(status, summary, now, taskId)
    return { recorded: true, item: workView(db, itemById(db, taskId)) }
  })
}

/** Record a genuine host end event only for a previously assigned exact session/run.
 * This is not a tool-callable operation. It never guesses task completion or
 * mutates the task outcome; a structured report or operator must settle it.
 */
export function observeWorkItemEnd(db, input = {}) {
  const session = string(input.session_id, 'session_id', 256)
  const run = string(input.run_id, 'run_id', 256)
  const reasons = new Set(['completed', 'aborted', 'error', 'max-tokens', 'refusal'])
  const reason = reasons.has(input.stop_reason) ? input.stop_reason : 'unknown'
  return atomic(db, () => {
    const row = db.prepare('SELECT id, task_id, attempt, host_end_at FROM agent_work_assignment WHERE session_id = ? AND run_id = ?').get(session, run)
    if (!row) return { observed: false, reason: 'unmatched-run' }
    if (row.host_end_at) return { observed: false, reason: 'already-observed', task_id: row.task_id, attempt: row.attempt }
    const now = new Date().toISOString()
    db.prepare('UPDATE agent_work_assignment SET host_end_at = ?, host_stop_reason = ? WHERE id = ? AND host_end_at IS NULL')
      .run(now, reason, row.id)
    return { observed: true, task_id: row.task_id, attempt: row.attempt, stop_reason: reason }
  })
}

/** Return one reviewed attempt for changes without rewriting its result or starting a worker. */
export function requestWorkItemChanges(db, input = {}) {
  const taskId = idOf(input.task_id)
  const revision = reviewRevision(input.expected_revision)
  const feedback = safeSummary(input.reason, 'reason', 1000)
  return atomic(db, () => {
    const task = itemById(db, taskId)
    if (!task) throw new Error('work item not found')
    if (task.revision !== revision) return { returned: false, reason: '任务版本已变化', item: workView(db, task) }
    if (task.status !== 'ready') return { returned: false, reason: '任务不在待验收状态', item: workView(db, task) }
    const attempt = latestAssignment(db, taskId)
    if (attempt?.status !== 'ready' || attempt.attempt !== task.attempt || attempt.review_returned_at) {
      throw new Error('inconsistent item and assignment state')
    }
    const now = new Date().toISOString()
    db.prepare('UPDATE agent_work_assignment SET review_feedback = ?, review_returned_at = ? WHERE id = ?')
      .run(feedback, now, attempt.id)
    db.prepare('UPDATE agent_work_item SET status = ?, last_outcome = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run('waiting', feedback, now, taskId)
    return { returned: true, item: workView(db, itemById(db, taskId)) }
  })
}

/** Final approval is a separate explicit action, not inferred from model prose. */
export function closeWorkItem(db, input = {}) {
  const taskId = idOf(input.task_id)
  const outcome = String(input.outcome || '')
  if (!['done', 'dropped'].includes(outcome)) throw new TypeError('outcome must be done or dropped')
  const reason = safeSummary(input.reason, 'reason', 1000)
  const revision = input.expected_revision === undefined ? undefined : reviewRevision(input.expected_revision)
  return atomic(db, () => {
    const task = itemById(db, taskId)
    if (!task) throw new Error('work item not found')
    if (revision !== undefined && task.revision !== revision) return { closed: false, reason: '任务版本已变化', item: workView(db, task) }
    if (task.status === outcome) return { closed: false, reason: 'already-closed', item: workView(db, task) }
    if (['done', 'dropped'].includes(task.status)) throw new Error('work item is already closed')
    if (task.status === 'running') throw new Error('cannot close an active assignment; settle it first')
    if (outcome === 'done' && task.status !== 'ready') throw new Error('done requires a ready report for review')
    const now = new Date().toISOString()
    db.prepare('UPDATE agent_work_item SET status = ?, last_outcome = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(outcome, reason, now, taskId)
    return { closed: true, item: workView(db, itemById(db, taskId)) }
  })
}

export function getWorkItem(db, id) {
  const taskId = idOf(id)
  const item = itemById(db, taskId)
  return item ? { ...workView(db, item), history: db.prepare(selectRun + ' WHERE task_id = ? ORDER BY attempt DESC LIMIT 100').all(taskId) } : null
}

export function listWorkItems(db, options = {}) {
  const { limit, offset } = page(options)
  const status = options.status == null || options.status === '' ? null : String(options.status)
  if (status !== null && !STATUS_FILTERS.has(status)) throw new TypeError('invalid status filter')
  const where = status ? ' WHERE status = ?' : ''
  const args = status ? [status] : []
  const total = db.prepare('SELECT COUNT(*) AS n FROM agent_work_item' + where).get(...args).n
  const items = db.prepare(selectItem + where + ' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(...args, limit, offset).map(row => workView(db, row))
  return { total, limit, offset, items, hasMore: offset + items.length < total }
}

/** Running records are candidates for registry confirmation, never proof of crashed workers. */
export function workRecoveryCandidates(db, options = {}) {
  const result = listWorkItems(db, { ...page(options), status: 'running' })
  const needsCheck = result.items.some(item => item.needs_host_check)
  const needsSettlement = result.items.filter(item => item.needs_settlement).length
  const hasHostEnd = result.items.some(item => item.host_activity === 'end-observed')
  return { ...result,
    proof: hasHostEnd ? 'stored-assignments-and-host-end-events' : 'stored-assignments-only',
    needs_host_check: needsCheck,
    needs_settlement: needsSettlement,
    note: 'An observed host end is not task completion. Verify unresolved sessions before recording interruption or retry.' }
}
