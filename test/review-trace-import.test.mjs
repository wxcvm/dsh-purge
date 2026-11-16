import test from 'node:test'
import assert from 'node:assert/strict'
import * as zlib from 'node:zlib'
import { cases, answerKey } from '../scripts/agent-quality-eval.mjs'
import { decodeArchive, extractMarkedTurn, importReviewRun, markedPacket } from '../scripts/review-trace-import.mjs'
import { compareReviewRuns } from '../scripts/review-run-compare.mjs'

const ids = cases.map(row => row.id)
const marker = 'PURGE-QA-RUN: example'
const stamp = 1760000000000
const ev = (seq, type, data, timestamp = stamp + seq) => ({ seq, type, data, timestamp })
const answer = id => ({ id, ...answerKey[id] })
const stream = (finish = 'stop', input = 12) => [
  { chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } },
  { chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: 2, totalTokens: input + 2, cacheReadTokens: 0 } } },
  { chunk: { type: 'finish', reason: { kind: finish } } },
]
const request = (seq = 1, text = marker) => ev(seq, 'user/message', { source: { kind: 'user' }, content: text })
const reply = (seq, turn, reports, finish = 'stop') => ev(seq, 'assistant/message', {
  turn, step: 1, message: { source: { provider: 'fixture', model: 'qa-model' }, content: JSON.stringify({ reports }) },
  stream: stream(finish),
})
const end = (seq, turn, kind = 'completed') => ev(seq, 'turn/end', { turn, reason: { kind } })
const session = (sessionId, records, extra = {}) => ({ sessionId, records, ...extra })

test('native archive frames decode all JSONL records across UTF-8 boundaries', { skip: !zlib.zstdCompressSync }, () => {
  const buf = Buffer.from(JSON.stringify({ header: { parentSession: 'p' } }) + '\n' + JSON.stringify(request(1, marker + '\n鸟鸟')) + '\n')
  const cut = buf.indexOf(Buffer.from('鸟')) + 1
  const bytes = Buffer.concat([zlib.zstdCompressSync(buf.subarray(0, cut)), zlib.zstdCompressSync(buf.subarray(cut))])
  assert.deepEqual(decodeArchive(bytes), decodeArchive(buf))
  assert.equal(decodeArchive(bytes).length, 2)
})

test('marked turn ignores previous and later turns; counts the latest usage snapshot once', () => {
  const records = [request(1, 'unrelated'), reply(2, 1, ids.map(answer)), end(3, 1),
    request(4), ev(5, 'request/header', { header: { config: { model: 'qa-model' } } }),
    reply(6, 2, ids.map(answer)), end(7, 2), request(8, 'next'), reply(9, 3, []), end(10, 3)]
  const trace = extractMarkedTurn(records, marker)
  assert.equal(trace.turn, 2)
  assert.equal(trace.attempts.length, 1)
  assert.equal(trace.attempts[0].inputTokens, 12)
  assert.equal(trace.attempts[0].totalTokens, 14)
  assert.equal(trace.elapsedMs, 3)
  const run = importReviewRun({ runId: 'example', parent: session('p', records) })
  assert.equal(run.usage.scope, 'observed-archive')
  assert.equal(run.usage.modelResponses, 1)
  assert.equal(run.usage.inputTokens, 12)
  assert.equal(run.usage.cacheWriteTokens, null)
  assert.equal(run.batch.reports.length, 6)
})

test('failed attempts contribute usage but cannot substitute for the final message', () => {
  const records = [request(), reply(2, 1, ids.map(answer)), ev(3, 'assistant/attempt',
    { turn: 1, step: 1, stream: stream('error', 8) }), end(4, 1, 'error')]
  const run = importReviewRun({ runId: 'example', parent: session('p', records) })
  assert.equal(run.usage.modelResponses, 2)
  assert.equal(run.usage.totalTokens, 24)
  assert.equal(run.batch.reports.length, 0)
  assert.ok(run.batch.observations.every(row => row.lifecycle === 'failed'))
})

test('linked child results are separate, unrelated archives and duplicate assignments fail', () => {
  const parent = session('p', [request(), ev(2, 'subagent/descriptor', { childId: 'c' }),
    reply(3, 1, ids.slice(1).map(answer)), end(4, 1)])
  const child = session('c', [{ header: { parentSession: 'p' } }, request(),
    reply(2, 1, [answer(ids[0])]), end(3, 1)], { caseIds: [ids[0]] })
  const run = importReviewRun({ runId: 'example', parent, children: [child] })
  assert.equal(run.archiveCoverage.observedChildren, 1)
  assert.equal(run.archiveCoverage.listedButMissingChildren, 0)
  assert.equal(run.usage.modelResponses, 2)
  assert.equal(run.childBatch.reports.length, 1)
  assert.equal(run.batch.reports.length, 5)
  assert.throws(() => importReviewRun({ runId: 'example', parent,
    children: [{ ...child, sessionId: 'foreign', records: child.records.slice(1) }] }), /not linked/)
  assert.throws(() => importReviewRun({ runId: 'example', parent, children: [child, child] }), /Duplicate/)
  const direct = importReviewRun({ runId: 'example', parent: session('d', [request(), reply(2, 1, ids.map(answer)), end(3, 1)]) })
  const result = compareReviewRuns({ direct: { ...direct, runId: 'baseline' }, delegated: run })
  assert.equal(result.summary.directAccepted, 6)
  assert.equal(result.summary.delegatedAccepted, 5)
  assert.equal(result.summary.childAccepted, 1)
  assert.equal(result.usage.modelResponses.delta, null)
  assert.equal(result.archiveUsage.modelResponses.delta, 1)
})

test('missing lifecycle and foreign report text never become verified or leak from importer', () => {
  const records = [request(), reply(2, 1, [{ id: ids[0], answer: 'a', evidence: ['PRIVATE-RAW-TEXT'] }])]
  const run = importReviewRun({ runId: 'example', parent: session('p', records) })
  assert.equal(run.batch.observations.length, 0)
  assert.deepEqual(run.batch.reports[0].evidence, ['__invalid_evidence__'])
  assert.doesNotMatch(JSON.stringify(run), /PRIVATE-RAW-TEXT/)
  const direct = { ...run, runId: 'baseline' }
  assert.equal(compareReviewRuns({ direct, delegated: run }).summary.delegatedAccepted, 0)
})

test('ambiguous marker or turn cannot borrow a prior completion', () => {
  assert.throws(() => extractMarkedTurn([request(), reply(2, 1, []), end(3, 1), request(4),
    reply(5, 2, []), end(6, 2)], marker), /exactly one request/)
  assert.throws(() => extractMarkedTurn([request(), reply(2, 1, []), end(3, 1),
    reply(4, 2, []), end(5, 2)], marker), /one native turn/)
  const missing = importReviewRun({ runId: 'example', parent: session('p', [request(),
    ev(2, 'subagent/descriptor', { childId: 'missing' }), reply(3, 1, []), end(4, 1)]) })
  assert.equal(missing.archiveCoverage.listedButMissingChildren, 1)
})

test('marked packets include identical fixture records and do not expose the answer key', () => {
  const direct = markedPacket('example', 'direct'), delegated = markedPacket('example', 'delegated')
  assert.ok(direct.startsWith(marker + '\n'))
  assert.ok(delegated.startsWith(marker + '\n'))
  assert.equal(direct.slice(direct.indexOf('\n{')), delegated.slice(delegated.indexOf('\n{')))
  const packet = JSON.parse(direct.slice(direct.indexOf('\n{')))
  for (const row of packet.cases) assert.equal(Object.hasOwn(row, 'answer'), false)
})


test('native child intervals distinguish overlap, sequential boundaries, and missing timing', () => {
  const parent = session('p', [request(), ev(2, 'subagent/catalog', { items: [{ childId: 'a' }, { childId: 'b' }, { childId: 'missing' }] }),
    reply(40, 1, ids.map(answer)), end(41, 1)])
  const child = (id, start, finish, caseId, linked = true) => session(id,
    [...(linked ? [{ header: { parentSession: 'p' } }] : []),
      ev(start, 'user/message', { source: { kind: 'user' }, content: marker }),
      reply(finish - 1, 1, [answer(caseId)]), end(finish, 1)],
    { caseIds: [caseId] })
  const a = child('a', 3, 15, ids[0])
  const b = child('b', 8, 20, ids[1], false)
  const overlapping = importReviewRun({ runId: 'example', parent, children: [a, b] }).delegationTimeline
  assert.equal(overlapping.observedPeakConcurrentTurns, 2)
  assert.equal(overlapping.observedOverlapMs, 7)
  assert.equal(overlapping.timingCoverage, 'partial')
  assert.equal(overlapping.missingOrUntimedChildren, 1)
  assert.equal(overlapping.observedChildTurns[1].parentDescriptor, true)
  assert.equal(overlapping.observedChildTurns[1].childParentRef, false)
  assert.equal(overlapping.observedChildTurns[0].startOffsetMs, 2)
  const sequential = importReviewRun({ runId: 'example', parent, children: [a, child('b', 15, 25, ids[1])] }).delegationTimeline
  assert.equal(sequential.observedPeakConcurrentTurns, 1)
  assert.equal(sequential.observedOverlapMs, 0)
  const untimed = { ...b, records: b.records.map(({ timestamp, ...record }) => record) }
  const partial = importReviewRun({ runId: 'example', parent, children: [a, untimed] }).delegationTimeline
  assert.equal(partial.timedChildTurns, 1)
  assert.equal(partial.missingOrUntimedChildren, 2)
  assert.equal(partial.observedChildTurns[1].startOffsetMs, null)
  const none = importReviewRun({ runId: 'example', parent, children: [] }).delegationTimeline
  assert.equal(none.observedPeakConcurrentTurns, null)
  assert.equal(none.observedOverlapMs, null)
})
