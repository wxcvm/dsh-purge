import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'

// Shared across preset plugin scopes. Only a start with the same direct
// parent may claim a pending reservation; an end must match its exact run.
export function createReservations() {
  const roots = new Map()
  // Completed delegations have no active reservation. Keep a bounded,
  // process-local handoff index, not the child's output or a verified task state.
  const recentHandoffs = new Map()
  const loadedFiles = new Set(), ownerFiles = new Map(), fileErrors = new Map()
  const journalName = 'agent-handoffs.json'
  const reasons = new Set(['completed', 'aborted', 'error', 'max-tokens', 'refusal', 'unknown'])
  const messages = new Set(['present', 'empty', 'not-observed'])
  const journalRow = row => row && typeof row.owner === 'string' && row.owner.length > 0
    && typeof row.key === 'string' && row.key.length > 0
    && reasons.has(row.stopReason) && messages.has(row.finalMessage)
  const indexOf = row => JSON.stringify([row.owner, row.key])
  function persist(owner) {
    const file = ownerFiles.get(owner)
    if (!file || !loadedFiles.has(file)) return
    const records = [...recentHandoffs.values()].filter(row => ownerFiles.get(row.owner) === file)
    try {
      atomicWriteFileSync(file, JSON.stringify({ schemaVersion: 1, handoffs: records }))
      fileErrors.delete(file)
    } catch {
      // A failed disk write never interrupts a child lifecycle event.
      fileErrors.set(file, 'write-failed')
    }
  }
  function useHandoffDirectory(owner, root) {
    if (typeof owner !== 'string' || !owner || typeof root !== 'string' || !root) return
    const file = join(root, journalName)
    ownerFiles.set(owner, file)
    if (!loadedFiles.has(file)) {
      let saved
      try { saved = JSON.parse(readFileSync(file, 'utf8')) }
      catch (error) {
        if (error.code !== 'ENOENT') { fileErrors.set(file, 'read-failed'); return }
      }
      if (saved !== undefined && (saved?.schemaVersion !== 1 || !Array.isArray(saved.handoffs)
        || saved.handoffs.length > 200 || !saved.handoffs.every(journalRow))) {
        fileErrors.set(file, 'invalid-journal')
        return
      }
      loadedFiles.add(file)
      for (const row of saved?.handoffs ?? []) {
        if (ownerFiles.has(row.owner) && ownerFiles.get(row.owner) !== file) continue
        ownerFiles.set(row.owner, file)
        if (!recentHandoffs.has(indexOf(row))) recentHandoffs.set(indexOf(row), { ...row })
      }
      while (recentHandoffs.size > 200) recentHandoffs.delete(recentHandoffs.keys().next().value)
      fileErrors.delete(file)
    }
    ownerFiles.set(owner, file)
  }
  function handoffStorage(owner) {
    const file = ownerFiles.get(owner)
    return file ? fileErrors.get(file) ?? 'ready' : 'not-configured'
  }
  function handoffs(owner) {
    return [...recentHandoffs.values()].filter(row => row.owner === owner)
      .map(({ owner: _owner, ...row }) => ({ ...row }))
  }
  function list(owner) {
    return [...(roots.get(owner)?.values() || [])].map(row => ({ ...row }))
  }
  function acquire(owner, parent, label, at = Date.now(), requestedKey) {
    const key = requestedKey ?? (label || 'slot') + '#' + randomUUID()
    if (!roots.has(owner)) roots.set(owner, new Map())
    if (!roots.get(owner).has(key)) {
      roots.get(owner).set(key, { key, at, parent: String(parent), runId: null, childId: null })
      // A fresh dispatch with the same task key supersedes its previous handoff.
      if (recentHandoffs.delete(JSON.stringify([owner, key]))) persist(owner)
    }
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
    const childId = info.id == null ? null : String(info.id)
    if (childId !== null) {
      for (const rows of roots.values()) for (const row of rows.values()) {
        if (row.childId === childId && row.parent === parent) {
          if (row.runId === runId) return false
          row.runId = runId
          return true
        }
      }
    }
    let pending
    for (const rows of roots.values()) {
      for (const row of rows.values()) {
        if (row.runId === runId && row.parent === parent) return false
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
        if (row.runId === runId && row.parent === parent) {
          const key = row.key
          if (!release(owner, key)) return false
          const stopReason = ['completed', 'aborted', 'error', 'max-tokens', 'refusal'].includes(info.stopReason)
            ? info.stopReason : 'unknown'
          const finalMessage = !Array.isArray(info.lastAssistantMessage) ? 'not-observed'
            : info.lastAssistantMessage.length ? 'present' : 'empty'
          const index = JSON.stringify([owner, key])
          recentHandoffs.delete(index)
          recentHandoffs.set(index, { owner, key, stopReason, finalMessage })
          if (recentHandoffs.size > 200) recentHandoffs.delete(recentHandoffs.keys().next().value)
          persist(owner)
          return true
        }
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
  return { list, handoffs, handoffStorage, useHandoffDirectory, acquire, release, start, end, clearPending }
}

// Union the observed running count with outstanding reservations by child ID.
// An unbound reservation or an unobserved bound child occupies an extra slot.
export function reservedUsage(live, rows) {
  const ids = new Set(live.running_ids || [])
  return Math.max(live.running, ids.size + rows.filter(row => row.childId == null || !ids.has(row.childId)).length)
}

// Shared process-local ledger; UI reads the same reservations as the tool.
export const reservationBook = createReservations()

export function withReservationUsage(status, book = reservationBook) {
  const per_root = status.per_root.map(root => {
    const rows = book.list(root.owner)
    const occupied = reservedUsage({ running: root.used ?? 0, running_ids: root.running_ids }, rows)
    return { ...root, occupied, reserved_unobserved: occupied - (root.used ?? 0),
      free: root.available ? Math.max(0, status.max - occupied) : null }
  })
  return { ...status, per_root,
    free: status.available && per_root.length === 1 ? per_root[0].free : null }
}
