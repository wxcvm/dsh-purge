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
    roots.get(owner).set(key, { key, at, parent: String(parent), runId: null, childId: null })
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
    pending.childId = info.id == null ? null : String(info.id)
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
  // The parent becoming idle or being disposed means no driver remains to
  // publish an unstarted delegation from that turn. Never drop bound runs.
  function clearPending(parent) {
    if (parent == null) return 0
    let removed = 0
    for (const [owner, rows] of roots) {
      for (const row of rows.values()) {
        if (row.parent === String(parent) && row.runId === null) {
          if (release(owner, row.key)) removed++
        }
      }
    }
    return removed
  }
  return { list, acquire, release, start, end, clearPending }
}

// Union the observed running count with outstanding reservations by child ID.
// An unbound reservation or an unobserved bound child occupies an extra slot.
export function reservedUsage(live, rows) {
  const ids = new Set(live.running_ids || [])
  return live.running + rows.filter(row => row.childId == null || !ids.has(row.childId)).length
}
