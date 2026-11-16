import { taskKey } from './score-triage.js'

/**
 * Build one batch of independent, read-only record reviews.
 *
 * Only explicitly marked tasks with their own record key and no declared
 * dependency/shared-state/evidence prerequisite may be grouped. Unknown task
 * shapes remain sequential. Only the highest-priority tier can be batched.
 * This planner never starts agents or writes records.
 */
export function planParallelReviewBatch(actions = [], maxParallel = 3) {
  const requested = Math.floor(Number(maxParallel))
  const limit = Number.isSafeInteger(requested) && requested > 0 ? requested : 3
  const input = Array.isArray(actions) ? actions : []
  // Match nextTaskCard's priority semantics. Lower-priority records stay in
  // the normal queue; deferred batches must not jump ahead of the next focus.
  const priorityOf = action => Number.isFinite(Number(action?.priority)) ? Number(action.priority) : 99
  const firstPriority = input.reduce((best, action) => Math.min(best, priorityOf(action)), Infinity)
  const eligible = []
  const sequential = []
  const seenTargets = new Set()

  for (const action of input) {
    const spec = action?.parallelReview
    const targetKey = typeof spec?.targetKey === 'string' ? spec.targetKey.trim() : ''
    const isIndependentReadOnly = spec?.operation === 'read-only-record-review'
      && spec.readOnly === true
      && targetKey !== ''
      && Array.isArray(spec.dependencies) && spec.dependencies.length === 0
      && Array.isArray(spec.sharedStateKeys) && spec.sharedStateKeys.length === 0
      && Array.isArray(spec.evidencePrerequisites) && spec.evidencePrerequisites.length === 0
    if (priorityOf(action) !== firstPriority || !isIndependentReadOnly || seenTargets.has(targetKey)) {
      sequential.push(action)
      continue
    }
    seenTargets.add(targetKey)
    eligible.push({ ...action, task_key: taskKey(action), target_key: targetKey })
  }

  const batch = eligible.slice(0, limit)
  if (batch.length < 2) {
    return {
      status: 'sequential',
      max_parallel: limit,
      batch: [],
      deferred: [],
      sequential: input,
      requires_parent_reconciliation: false,
      child_writes_allowed: false,
    }
  }

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
