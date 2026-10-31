/** Process-local coordination state. Reservations never expire just because a task is old. */
export function addReservation(held, rootId, key, now = Date.now()) {
  let slots = held.get(rootId)
  if (!slots) held.set(rootId, slots = new Map())
  if (slots.has(key)) return false
  slots.set(key, now)
  return true
}

/** Exact owner/key release also removes lifecycle links; repeating it is harmless. */
export function dropReservation(held, assignments, rootId, key) {
  const slots = held.get(rootId)
  if (key === undefined && !slots) return false
  if (key === undefined) {
    const claimed = new Set([...assignments.values()].filter(row => row.rootId === rootId).map(row => row.key))
    let oldest = Infinity
    for (const [candidate, at] of slots) {
      if (!claimed.has(candidate) && at < oldest) { key = candidate; oldest = at }
    }
  }
  if (key === undefined) return false
  const dropped = slots?.delete(key) ?? false
  for (const [childId, assigned] of assignments) {
    if (assigned.rootId === rootId && assigned.key === key) assignments.delete(childId)
  }
  if (slots?.size === 0) held.delete(rootId)
  return dropped
}

/** Match only within the resolved root. Repeated start events do not consume a new slot. */
export function associateChildReservation(held, assignments, rootId, info) {
  if (!rootId || info?.id === undefined || info.id === null) return false
  const childId = String(info.id)
  const existing = assignments.get(childId)
  if (existing) {
    if (existing.rootId !== rootId) return false
    if (held.get(rootId)?.has(existing.key)) {
      assignments.set(childId, { ...existing, runId: info.runId })
      return true
    }
    assignments.delete(childId)
  }
  const slots = held.get(rootId)
  if (!slots?.size) return false
  const claimed = new Set([...assignments.values()].filter(row => row.rootId === rootId).map(row => row.key))
  let key
  let oldest = Infinity
  for (const [candidate, at] of slots) {
    if (!claimed.has(candidate) && at < oldest) { key = candidate; oldest = at }
  }
  if (key === undefined) return false
  assignments.set(childId, { rootId, key, runId: info.runId })
  return true
}

/** A delayed end for an earlier run cannot free the current run's reservation. */
export function releaseChildReservation(held, assignments, info) {
  if (info?.id === undefined || info.id === null) return false
  const childId = String(info.id)
  const assigned = assignments.get(childId)
  if (assigned) {
    if (assigned.runId !== undefined && info.runId !== assigned.runId) return false
    return dropReservation(held, assignments, assigned.rootId, assigned.key)
  }
  // Run-aware delayed events cannot claim a newer, unassigned reservation by key.
  if (info.runId !== undefined) return false
  // Legacy reservation keys were sometimes actual child ids. Never guess a root.
  const matches = [...held].filter(([, slots]) => slots.has(childId))
  return matches.length === 1 ? dropReservation(held, assignments, matches[0][0], childId) : false
}

/**
 * Count the union of live child ids and reserved capacity, not max(live, reserved).
 * Missing registry identities/activity make capacity an upper bound, never verified free.
 */
export function summarizeReservations(held, assignments, rootId, live = {}, max = 3, now = Date.now()) {
  if (!Number.isSafeInteger(max) || max <= 0) throw new TypeError('invalid reservation max: expected a positive safe integer')
  const runningIds = new Set((Array.isArray(live.running_ids) ? live.running_ids : []).map(String))
  const reportedRunning = Number.isSafeInteger(live.running) && live.running >= 0 ? live.running : runningIds.size
  const running = Math.max(reportedRunning, runningIds.size)
  const assignedByKey = new Map([...assignments].filter(([, row]) => row.rootId === rootId).map(([childId, row]) => [row.key, { childId, ...row }]))
  const reservations = [...(held.get(rootId) ?? [])].map(([key, at]) => {
    const assignment = assignedByKey.get(key)
    return {
      key, at, age_ms: Math.max(0, now - at), state: assignment ? 'assigned' : 'pending',
      ...(assignment ? { child_id: assignment.childId, run_id: assignment.runId ?? null } : {}),
    }
  })
  const assigned = reservations.filter(row => row.state === 'assigned').length
  const overlaps = reservations.filter(row => row.state === 'assigned' && runningIds.has(row.child_id)).length
  // Count unidentified running rows only when they exceed the identifiable union.
  const identifiedUnion = runningIds.size + reservations.length - overlaps
  const used = Math.max(running, identifiedUnion)
  const identitiesComplete = runningIds.size === running
  const available = live.available === true && identitiesComplete
  const upperBound = Math.max(max - used, 0)
  return {
    owner: rootId, max, used, free: available ? upperBound : null,
    free_upper_bound: upperBound,
    used_is_lower_bound: !available, free_is_upper_bound: !available,
    available, registry_available: live.available === true,
    live_running: running, running_from_registry: running,
    running_labels: live.running_labels ?? [],
    pending: reservations.length - assigned, assigned,
    unknown_children: live.unknown_children ?? null,
    reservations, reservation_scope: 'process-local',
    ...(!available ? { registry_note: live.error || 'Child identities are incomplete; capacity is not verified.' } : {}),
  }
}
