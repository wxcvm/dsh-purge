/**
 * Build one batch of independent, read-only record reviews.
 *
 * Only explicitly marked tasks with their own record key and no declared
 * dependency/shared-state/evidence prerequisite may be grouped. Unknown task
 * shapes remain sequential. This planner never starts agents or writes records.
 */
export function planParallelReviewBatch(actions = [], maxParallel = 3) {
  const requested = Math.floor(Number(maxParallel))
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(3, requested)) : 3
  const eligible = []
  const sequential = []
  const seenTargets = new Set()

  for (const action of Array.isArray(actions) ? actions : []) {
    const spec = action?.parallelReview
    const targetKey = typeof spec?.targetKey === 'string' ? spec.targetKey.trim() : ''
    const isIndependentReadOnly = spec?.operation === 'read-only-record-review'
      && spec.readOnly === true
      && targetKey !== ''
      && Array.isArray(spec.dependencies) && spec.dependencies.length === 0
      && Array.isArray(spec.sharedStateKeys) && spec.sharedStateKeys.length === 0
      && Array.isArray(spec.evidencePrerequisites) && spec.evidencePrerequisites.length === 0
    if (!isIndependentReadOnly || seenTargets.has(targetKey)) {
      sequential.push(action)
      continue
    }
    seenTargets.add(targetKey)
    eligible.push({ ...action, task_key: taskKey(action), target_key: targetKey })
  }

  if (eligible.length < 2) {
    return {
      status: 'sequential',
      max_parallel: limit,
      batch: [],
      deferred: [],
      sequential: [...eligible, ...sequential],
      requires_parent_reconciliation: false,
      child_writes_allowed: false,
    }
  }

  const batch = eligible.slice(0, limit)
  return {
    status: 'ready',
    max_parallel: limit,
    batch,
    deferred: eligible.slice(limit),
    sequential,
    requires_parent_reconciliation: true,
    child_writes_allowed: false,
  }
}
