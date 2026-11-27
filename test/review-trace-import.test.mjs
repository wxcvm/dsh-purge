import test from 'node:test'
import assert from 'node:assert/strict'
import * as zlib from 'node:zlib'
import { cases, answerKey } from '../scripts/agent-quality-eval.mjs'
import { decodeArchive, extractMarkedTurn, importReviewRun, markedPacket, diagnoseReportContent, markedReviewPacket } from '../scripts/review-trace-import.mjs'
import { compareReviewRuns, compareIndependentReview } from '../scripts/review-run-compare.mjs'

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


test('content diagnostics distinguish extra valid evidence, missing evidence and output format', () => {
  const fence = String.fromCharCode(96).repeat(3)
  const reports = ids.map(answer)
  reports[0] = { ...reports[0], evidence: ['before', 'after', 'report'] }
  reports[3] = { ...reports[3], evidence: ['coverage', 'notes'] }
  const directText = 'Review complete.\n' + fence + 'json\n' + JSON.stringify({ reports }) + '\n' + fence
  const direct = diagnoseReportContent({ finalText: directText })
  assert.equal(direct.shape, 'json-fence-with-prose')
  assert.deepEqual(direct.score, { total: 6, parsed: 6, correctConclusions: 6, requiredCoverage: 6, exactEvidence: 4 })
  assert.deepEqual(direct.cases[0].additional, ['report'])
  assert.deepEqual(direct.cases[0].missing, [])
  const child = diagnoseReportContent({ finalText: JSON.stringify({ id: ids[5], answer: 'b', evidence: ['delta', 'newRecord'] }) }, [ids[5]])
  assert.equal(child.shape, 'single-json-object')
  assert.deepEqual(child.cases[0].missing, ['task'])
  assert.equal(child.cases[0].requiredCovered, false)
  assert.equal(child.cases[0].conclusionCorrect, true)
  const invalid = diagnoseReportContent({ finalText: JSON.stringify({ reports: [{ id: ids[0], answer: 'b', evidence: ['before','after','after','PRIVATE-RAW-TEXT'] }] }) })
  assert.equal(invalid.cases[0].requiredCovered, true)
  assert.equal(invalid.cases[0].exactEvidence, false)
  assert.equal(invalid.cases[0].invalidCount, 1)
  assert.equal(invalid.cases[0].duplicateCount, 1)
  assert.doesNotMatch(JSON.stringify(invalid), /PRIVATE-RAW-TEXT/)
  assert.equal(diagnoseReportContent({ finalText: directText + '\n' + fence + 'json\n{}\n' + fence }).shape, 'ambiguous-fences')
  assert.equal(diagnoseReportContent({ finalText: JSON.stringify({ reports: [reports[0], reports[0]] }) }).shape, 'invalid-report-identity')
  assert.equal(diagnoseReportContent({ finalText: JSON.stringify({ reports: [answer(ids[1])] }) }, [ids[0]]).shape, 'invalid-report-identity')
  assert.equal(diagnoseReportContent({ finalText: 'not a report' }).score, null)
})

test('replay real observed A/B answer patterns without model calls; separate content and strict delivery', () => {
  const fence = String.fromCharCode(96).repeat(3)
  const a = ids.map(answer)
  a[0] = { ...a[0], evidence: ['before','after','report'] }
  a[3] = { ...a[3], evidence: ['coverage','notes'] }
  const b = ids.map(answer)
  b[3] = { ...b[3], evidence: ['coverage','notes'] }
  b[5] = { ...b[5], evidence: ['delta','newRecord'] }
  const textReply = (seq, text) => ev(seq, 'assistant/message', {
    turn: 1, step: 1, message: { source: { provider: 'fixture', model: 'qa-model' }, content: text }, stream: stream()
  })
  const fenced = reports => 'Completed.\n' + fence + 'json\n' + JSON.stringify({ reports }) + '\n' + fence
  const direct = importReviewRun({ runId: 'example', parent: session('a', [request(), textReply(2, fenced(a)), end(3, 1)]) })
  const parent = session('p', [request(), ev(2, 'subagent/catalog', { items: ids.map((_,i)=>({ childId:'c'+i })) }),
    textReply(3, fenced(b)), end(4, 1)])
  const children = b.map((report,i)=>session('c'+i, [request(), textReply(2, JSON.stringify(report)), end(3,1)], { caseIds:[report.id] }))
  const delegated = importReviewRun({ runId: 'example', parent, children })
  const compared = compareReviewRuns({ direct: { ...direct, runId: 'direct' }, delegated })
  assert.equal(compared.summary.directAccepted, 0)
  assert.equal(compared.summary.delegatedAccepted, 0)
  assert.equal(compared.summary.childAccepted, 0)
  assert.equal(direct.archiveCoverage.strictParentJson, false)
  assert.deepEqual(compared.contentComparison.direct, { parsed: 6, correctConclusions: 6, requiredCoverage: 6, exactEvidence: 4 })
  assert.deepEqual(compared.contentComparison.delegated, { parsed: 6, correctConclusions: 6, requiredCoverage: 5, exactEvidence: 4 })
  assert.deepEqual(compared.contentComparison.child, compared.contentComparison.delegated)
  assert.equal(compared.contentComparison.sameEvidenceCount, 6)
  assert.deepEqual(compared.contentComparison.uncorrectedChildOmissions, [ids[5]])
})


test('independent review packet preserves observed candidate omissions without leaking the answer key', () => {
  const reports = ids.map(answer)
  reports[5] = { ...reports[5], evidence: ['delta', 'newRecord'], note: 'PRIVATE-RAW-TEXT' }
  reports[3] = { ...reports[3], evidence: ['coverage', 'notes'] }
  const text = markedReviewPacket('review', reports)
  assert.ok(text.startsWith('PURGE-QA-RUN: review\n'))
  assert.match(text, /Independently review/)
  const packet = JSON.parse(text.slice(text.indexOf('\n{')))
  assert.deepEqual(packet.cases, cases)
  assert.deepEqual(packet.candidateReports[5].evidence, ['delta', 'newRecord'])
  assert.deepEqual(packet.candidateReports[3].evidence, ['coverage', 'notes'])
  assert.doesNotMatch(text, /PRIVATE-RAW-TEXT/)
  assert.ok(packet.cases.every(row => !Object.hasOwn(row, 'answer')))
  assert.throws(() => markedReviewPacket('review', reports.slice(1)), /one candidate report/)
  assert.throws(() => markedReviewPacket('review', [...reports.slice(0, 5), reports[0]]), /duplicate/)
  assert.throws(() => markedReviewPacket('review', reports.map((r,i) => i ? r : { ...r, evidence: ['PRIVATE'] })), /Invalid/)
})

test('C replay records repaired evidence, strict acceptance and incremental versus full sequential cost', () => {
  const fence = String.fromCharCode(96).repeat(3)
  const reportsA = ids.map(answer), reportsB = ids.map(answer), reportsC = ids.map(answer)
  reportsA[0] = { ...reportsA[0], evidence: ['before','after','report'] }
  reportsA[3] = reportsB[3] = reportsC[3] = { ...answer(ids[3]), evidence: ['coverage','notes'] }
  reportsB[5] = { ...reportsB[5], evidence: ['delta','newRecord'] }
  const make = (runId, reports, strict, elapsedMs, totalTokens) => {
    const text = strict ? JSON.stringify({ reports }) : 'Done\n'+fence+'json\n'+JSON.stringify({ reports })+'\n'+fence
    const records = [request(1, 'PURGE-QA-RUN: '+runId), ev(2, 'assistant/message', {
      turn: 1, step: 1, message: { source: { provider:'fixture', model:'qa-model' }, content:text }, stream:stream()
    }), end(3,1)]
    const run = importReviewRun({ runId, parent:session(runId,records), settingsId:'same' })
    run.usage = { scope:'observed-archive', elapsedMs, totalTokens }
    return run
  }
  const direct = make('a', reportsA, false, 9884, 97318)
  const delegated = make('b', reportsB, false, 48102, 945568)
  const review = make('c', reportsC, true, 10481, 98049)
  const result = compareIndependentReview({ direct, delegated, review })
  assert.equal(result.summary.review.strictAccepted,5)
  assert.equal(result.summary.review.content.requiredCoverage,6)
  assert.equal(result.summary.review.content.exactEvidence,5)
  assert.deepEqual(result.changes.filter(row=>row.requiredCoverageRecovered).map(row=>row.id),[ids[5]])
  assert.equal(result.changes.some(row=>row.requiredCoverageLost),false)
  assert.deepEqual(result.archiveUsage.elapsedMs,{direct:9884,delegated:48102,incrementalReview:10481,sequentialDelegatedPlusReview:58583})
  assert.equal(result.archiveUsage.totalTokens.sequentialDelegatedPlusReview,1043617)
  assert.equal(result.wholeRunUsage.totalTokens.sequentialDelegatedPlusReview,null)
  const decision = result.decisionEvidence.observedArchive
  assert.equal(decision.freshTask.status, 'observed')
  assert.deepEqual(decision.freshTask.dominated,[{id:'delegated',by:['direct']}])
  assert.deepEqual(decision.freshTask.frontier,['direct','delegated-plus-review'])
  assert.deepEqual(decision.existingCandidates.frontier,['retain-candidates','independent-review'])
  assert.equal(decision.existingCandidates.options[0].elapsedMs,0)
  assert.equal(decision.existingCandidates.options[1].elapsedMs,10481)
  assert.equal(result.decisionEvidence.wholeRun.freshTask.status,'incomplete-observation')
  assert.equal(result.decisionEvidence.wholeRun.freshTask.frontier,null)
  const different = compareIndependentReview({direct,delegated,review:{...review,settingsId:'different'}})
  assert.equal(different.decisionEvidence.observedArchive.freshTask.status,'incomparable-settings')
  assert.equal(different.decisionEvidence.observedArchive.existingCandidates.frontier,null)
  assert.throws(()=>compareIndependentReview({direct,delegated,review:direct}),/distinct run IDs/)
  review.usage.scope='whole-run'
  const mixed = compareIndependentReview({direct,delegated,review})
  assert.equal(mixed.archiveUsage.totalTokens.sequentialDelegatedPlusReview,null)
  assert.equal(mixed.decisionEvidence.observedArchive.freshTask.frontier,null)
  assert.equal(mixed.decisionEvidence.observedArchive.existingCandidates.status,'incomplete-observation')
})
