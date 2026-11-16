import test from 'node:test'
import assert from 'node:assert/strict'
import { planParallelReviewBatch } from '../lib/redteam/parallel-review.js'

const task = (id, extra = {}) => ({
  action: '复核现有记录',
  target: 'vuln #' + id,
  parallelReview: {
    operation: 'read-only-record-review',
    readOnly: true,
    targetKey: 'vuln:' + id,
    dependencies: [],
    sharedStateKeys: [],
    evidencePrerequisites: [],
    ...extra,
  },
})

test('independent read-only records form one parallel batch with parent reconciliation', () => {
  const plan = planParallelReviewBatch([task(1), task(2), task(3)])
  assert.equal(plan.status, 'ready')
  assert.deepEqual(plan.batch.map(item => item.task_key), [
    '复核现有记录:vuln #1', '复核现有记录:vuln #2', '复核现有记录:vuln #3',
  ])
  assert.equal(plan.requires_parent_reconciliation, true)
  assert.equal(plan.child_writes_allowed, false)
})

test('dependent tasks remain sequential', () => {
  const plan = planParallelReviewBatch([
    task(1),
    task(2, { dependencies: ['vuln:1'] }),
  ])
  assert.equal(plan.status, 'sequential')
  assert.equal(plan.batch.length, 0)
  assert.equal(plan.sequential.length, 2)
})

test('tasks with shared mutable state or evidence prerequisites remain sequential', () => {
  const plan = planParallelReviewBatch([
    task(1, { sharedStateKeys: ['engagement:scoreboard'] }),
    task(2, { evidencePrerequisites: ['evidence:7'] }),
    task(3),
  ])
  assert.equal(plan.status, 'sequential')
  assert.deepEqual(plan.sequential.map(item => item.target), ['vuln #1', 'vuln #2', 'vuln #3'])
})

test('unknown, active, or non-read-only task types are never grouped', () => {
  const plan = planParallelReviewBatch([
    task(1),
    { action: '漏洞扫描', target: 'asset #2' },
    task(3, { readOnly: false }),
    task(4, { operation: 'active-scan' }),
  ])
  assert.equal(plan.batch.length, 0)
  assert.equal(plan.sequential.length, 4)
})

test('parallel batch respects the agreed three-agent ceiling and defers the rest', () => {
  const plan = planParallelReviewBatch([task(1), task(2), task(3), task(4), task(5)], 9)
  assert.equal(plan.max_parallel, 3)
  assert.equal(plan.batch.length, 3)
  assert.deepEqual(plan.deferred.map(item => item.target), ['vuln #4', 'vuln #5'])
})

test('duplicate target keys are not dispatched together', () => {
  const plan = planParallelReviewBatch([task(1), task(1), task(2)])
  assert.equal(plan.status, 'ready')
  assert.deepEqual(plan.batch.map(item => item.target), ['vuln #1', 'vuln #2'])
  assert.equal(plan.sequential.length, 1)
  assert.equal(plan.sequential[0].target, 'vuln #1')
})

test('one available slot keeps eligible work sequential', () => {
  const plan = planParallelReviewBatch([task(1), task(2), task(3)], 1)
  assert.equal(plan.status, 'sequential')
  assert.equal(plan.batch.length, 0)
  assert.equal(plan.sequential.length, 3)
})

test('one eligible task stays on the sequential path', () => {
  const plan = planParallelReviewBatch([task(1)])
  assert.equal(plan.status, 'sequential')
  assert.equal(plan.batch.length, 0)
  assert.equal(plan.sequential.length, 1)
})
