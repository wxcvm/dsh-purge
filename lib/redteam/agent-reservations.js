import { randomUUID } from 'node:crypto'

// Shared across preset plugin scopes. Only a start with the same direct
// parent may claim a pending reservation; an end must match its exact run.
export function createReservations() {
  const roots = new Map()
  function list(owner) {
    return [...(roots.get(owner)?.values() || [])].map(row => ({ ...row }))
  }
  function acquire(owner, parent, label, at = Date.now()) {
    const key = (label || 'slot') + '#' + randomUUID()
    if (!roots.has(owner)) roots.set(owner, new Map())
    roots.get(owner).set(key, { key, at, parent: String(parent), runId: null })
    return key
  }
  function release(owner, key) {
    const rows = roots.get(owner)
    if (!rows) return false
    const selected = key ?? rows.keys().next().value
    const removed = rows.delete(selected)
    if (!rows.size) roots.delete(owner)
    return removed
  }
  function start(info) {
    if (info?.runId == null || info?.parentSessionId == null) return false
    const runId = String(info.runId)
    const parent = String(info.parentSessionId)
    let pending
    for (const rows of roots.values()) {
      for (const row of rows.values()) {
        if (row.runId === runId) return false
        if (row.parent === parent && row.runId === null && (!pending || row.at < pending.at)) pending = row
      }
    }
    if (!pending) return false
    pending.runId = runId
    return true
  }
  function end(info) {
    if (info?.runId == null || info?.parentSessionId == null) return false
    const runId = String(info.runId)
    const parent = String(info.parentSessionId)
    for (const [owner, rows] of roots) {
      for (const row of rows.values()) {
        if (row.runId === runId && row.parent === parent) return release(owner, row.key)
      }
    }
    return false
  }
  return { list, acquire, release, start, end }
}
