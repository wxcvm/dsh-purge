/* Explicit, offline per-asset review checklist; never infers completion from scans,
 * test_status, scores or observed access. Independent of redteam_next_action. */
export const COVERAGE_FIELDS = Object.freeze({
  external: Object.freeze(['surface', 'web', 'auth', 'cve', 'app']),
  internal: Object.freeze(['files', 'privesc', 'web', 'db', 'lateral']),
})

export const COVERAGE_STATES = Object.freeze(['untested', 'partial', 'done', 'blocked', 'not_applicable'])
const COMPLETE = new Set(['done', 'blocked', 'not_applicable'])

export function coveragePhase(phase) {
  if (!Object.hasOwn(COVERAGE_FIELDS, phase)) throw new TypeError('phase must be external or internal')
  return phase
}

export function coverageView(phase, row = null) {
  const fields = COVERAGE_FIELDS[coveragePhase(phase)]
  let saved = {}
  try {
    const parsed = JSON.parse(row?.checks_json || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed
  } catch { /* corrupt stored checklist never becomes a completed checklist */ }
  const checks = Object.fromEntries(fields.map(field => [field,
    COVERAGE_STATES.includes(saved[field]) ? saved[field] : 'untested']))
  const missing = fields.filter(field => !COMPLETE.has(checks[field]))
  const status = ['open', 'closed', 'blocked'].includes(row?.status) ? row.status : 'open'
  return { phase, status, checks, missing, ready_to_close: missing.length === 0,
    complete: status === 'closed' && missing.length === 0,
    blocked_reason: row?.blocked_reason || null, note: row?.note || '',
    updated_at: row?.updated_at || null, updated_by: row?.updated_by || null }
}

export function planCoverageUpdate(phase, current, updates, note) {
  const fields = COVERAGE_FIELDS[coveragePhase(phase)]
  if (!Array.isArray(updates) || updates.length > fields.length
    || (updates.length === 0 && note === undefined)) {
    throw new TypeError('updates must have 1..5 entries, or provide note')
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) {
    throw new TypeError('note must be text of at most 2000 characters')
  }
  const checks = { ...coverageView(phase, current).checks }
  const seen = new Set()
  for (const update of updates) {
    if (!update || typeof update !== 'object' || Array.isArray(update)
      || !fields.includes(update.field) || !COVERAGE_STATES.includes(update.state)) {
      throw new TypeError('unknown coverage field or state')
    }
    if (seen.has(update.field)) throw new TypeError('duplicate coverage field')
    seen.add(update.field)
    checks[update.field] = update.state
  }
  return { checks_json: JSON.stringify(checks),
    note: note === undefined ? current?.note || '' : note.trim() }
}

export function validateCoverageClose(phase, current, status, reason = '') {
  const view = coverageView(phase, current)
  if (!['closed', 'blocked'].includes(status)) throw new TypeError('status must be closed or blocked')
  if (typeof reason !== 'string' || reason.length > 2000) throw new TypeError('invalid reason')
  if (status === 'closed' && view.missing.length) {
    throw new Error('checklist incomplete: ' + view.missing.join(', '))
  }
  if (status === 'blocked' && !reason.trim()) throw new Error('blocked requires a reason')
  return { status, blocked_reason: status === 'blocked' ? reason.trim() : null }
}
