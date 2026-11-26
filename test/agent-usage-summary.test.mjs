import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeAgentUsage } from '../scripts/summarize-agent-usage.mjs'

const snapshot = items => ({ schemaVersion: 1, readOnly: true, capacity: 200, evicted: 7, items })
const row = (sessionId, attemptId, extra = {}) => ({ sessionId, attemptId, generation: 1, ...extra })

test('summarizes independent usage fields without treating missing values as zero', () => {
  const result = summarizeAgentUsage(snapshot([
    row('a', '1', { usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20, cacheReadTokens: 60 } }),
    row('a', '2', { usage: { totalTokens: 50, outputTokens: 0 } }),
    row('b', '1'),
  ]))
  assert.deepEqual(result.total.usage.totalTokens, { observedSum: 150, observed: 2, missing: 1 })
  assert.deepEqual(result.total.usage.outputTokens, { observedSum: 20, observed: 2, missing: 1 })
  assert.deepEqual(result.total.usage.reasoningTokens, { observedSum: null, observed: 0, missing: 3 })
  assert.equal(result.total.usage.cacheReadTokens.observedSum, 60)
  assert.equal(result.sessions[0].attempts, 2)
  assert.equal(result.sessions[1].usage.totalTokens.observedSum, null)
  assert.equal(result.coverage.evicted, 7)
  assert.equal(result.coverage.completeHistory, false)
})

test('keeps stream time, tool observations, settlement and terminal evidence separate', () => {
  const result = summarizeAgentUsage(snapshot([
    row('a', '1', { elapsedMs: 100, firstTextMs: 20, toolCalls: 2, durableToolStarts: 2, finishObserved: true, finish: 'tool-calls', settlement: 'committed' }),
    row('a', '2', { elapsedMs: 30, toolCalls: 0, finishObserved: true, finish: 'error', settlement: 'abandoned', terminalConflict: true }),
    row('a', '3', { finishObserved: false, finish: 'stop', streamGap: true, settlement: 'unobserved-end' }),
  ]))
  assert.deepEqual(result.total.elapsedMs, { observedSum: 130, observed: 2, missing: 1 })
  assert.equal(result.total.liveToolStarts.observedSum, 2)
  assert.equal(result.total.durableToolStarts.observedSum, 2)
  assert.equal(result.total.finish['tool-calls'], 1)
  assert.equal(result.total.finish.unknown, 2)
  assert.equal(result.total.finish.error, 0)
  assert.equal(result.total.terminalConflicts, 1)
  assert.equal(result.total.streamGaps, 1)
  assert.equal(result.total.settlement.abandoned, 1)
})

test('duplicate identity is rejected, but replacement generations remain distinct', () => {
  assert.throws(() => summarizeAgentUsage(snapshot([row('a', '1'), row('a', '1')])), /Duplicate/)
  const result = summarizeAgentUsage(snapshot([row('a', '1'), row('a', '1', { generation: 2 })]))
  assert.equal(result.total.attempts, 2)
})

test('does not copy raw payloads or infer missing session identity', () => {
  const result = summarizeAgentUsage(snapshot([
    row(null, null, { text: 'PRIVATE', toolArgs: { key: 'SECRET' }, usage: { totalTokens: -1 } }),
    row('not a label', '1', { usage: { totalTokens: 0 } }),
  ]))
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].sessionId, null)
  assert.equal(result.total.usage.totalTokens.observedSum, 0)
  assert.equal(result.total.usage.totalTokens.missing, 1)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET/)
  assert.throws(() => summarizeAgentUsage({ items: [] }), /schemaVersion/)
  assert.equal(summarizeAgentUsage(snapshot([])).total.usage.totalTokens.observedSum, null)
})
