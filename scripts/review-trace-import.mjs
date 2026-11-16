/**
 * Local, read-only adapter for explicitly selected Harness rc.3 QA session
 * archives. Only fixture IDs/answers/evidence keys and observation metadata
 * leave the adapter; never return prompt bodies, tool arguments or raw output.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as zlib from 'node:zlib'
import { cases, casePacket } from './agent-quality-eval.mjs'
import { isHumanEvent, messageOf, messageText } from '../lib/response-context.js'
import { streamSummary } from '../lib/runtime-observations.js'

const ids = cases.map(row => row.id)
const caseById = new Map(cases.map(row => [row.id, row]))
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const present = value => typeof value === 'string' && value.trim() !== ''
const number = value => Number.isFinite(value) && value >= 0 ? value : null
const label = value => typeof value === 'string' && /^[\w./:@+-]{1,160}$/.test(value) ? value : null
const markerFor = runId => {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(runId || '')) throw new Error('Invalid QA run ID')
  return 'PURGE-QA-RUN: ' + runId
}

// Native archives contain concatenated zstd frames; Node's synchronous decoder
// consumes only the first one. Decode each frame, fail on malformed input, and
// join bytes before UTF-8 decoding (a character can cross frame boundaries).
export function decodeArchive(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Expected archive bytes')
  let decoded = bytes
  if (bytes.subarray(0, 4).equals(magic)) {
    if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('Use a Node release with zstd support (Node 24 recommended)')
    const frames = []
    let start = 0
    while (start < bytes.length) {
      const next = bytes.indexOf(magic, start + 4)
      frames.push(zlib.zstdDecompressSync(bytes.subarray(start, next < 0 ? bytes.length : next)))
      if (next < 0) break
      start = next
    }
    decoded = Buffer.concat(frames)
  }
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(decoded).split(/\r?\n/).filter(line => line.trim())
  return lines.map(line => JSON.parse(line))
}

export function archiveEvents(records) {
  const events = new Map(), parentRefs = new Set()
  for (const raw of records) {
    const event = raw?.event && typeof raw.event.type === 'string' ? raw.event : raw
    for (const meta of [raw?.header, raw?.meta, event?.header, event?.meta, event?.data?.header, event?.data]) {
      if (present(meta?.parentSession)) parentRefs.add(meta.parentSession)
    }
    if (!Number.isSafeInteger(event?.seq) || typeof event?.type !== 'string') continue
    if (events.has(event.seq) && JSON.stringify(events.get(event.seq)) !== JSON.stringify(event)) {
      throw new Error('Conflicting archive sequence')
    }
    events.set(event.seq, event)
  }
  return { events: [...events.values()].sort((a, b) => a.seq - b.seq), parentRefs: [...parentRefs] }
}

function timeOf(event) {
  for (const value of [event?.timestamp, event?.ts, event?.time]) {
    const n = typeof value === 'number' && value >= 1e12 ? value
      : typeof value === 'string' ? Date.parse(value) : NaN
    if (Number.isFinite(n)) return n
  }
  return null
}

function observedRoute(source, previous = {}) {
  return { provider: label(source?.provider) ?? previous.provider ?? null,
    model: label(source?.model) ?? previous.model ?? null }
}
const usageKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
function usageOf(data, streamUsage) {
  const has = value => usageKeys.some(key => number(value?.[key]) !== null)
  const primary = data?.usage
  const value = number(primary?.totalTokens) !== null ? primary
    : number(streamUsage?.totalTokens) !== null ? streamUsage
      : has(primary) ? primary : streamUsage
  return Object.fromEntries(usageKeys.map(key => [key, number(value?.[key])]))
}
function addObserved(attempts, key) {
  if (!attempts.length || attempts.some(row => number(row[key]) === null)) return null
  return attempts.reduce((sum, row) => sum + row[key], 0)
}
function childIds(events) {
  const ids = new Set()
  for (const event of events) {
    if (!['subagent/descriptor', 'subagent/catalog'].includes(event.type)) continue
    const d = event.data
    const items = Array.isArray(d) ? d : d?.items ?? d?.children ?? d?.catalog ?? [d]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const id = item?.childId ?? item?.sessionId ?? item?.descriptor?.id ?? item?.child?.id ?? item?.id
      if (present(id)) ids.add(id)
    }
  }
  return ids
}

/** Exact marked user request, one unambiguous native turn. No archive-wide
 * search or reuse of a previous request's final message. */
export function extractMarkedTurn(records, marker, { userSeq, child = false } = {}) {
  const { events, parentRefs } = archiveEvents(records)
  const matches = events.filter(event => event.type === 'user/message'
    && (child || isHumanEvent(event))
    && messageText(messageOf(event)).split(/\r?\n/).some(line => line.trim() === marker)
    && (userSeq == null || event.seq === userSeq))
  if (matches.length !== 1) throw new Error('QA marker must identify exactly one request; supply userSeq if repeated')
  const human = matches[0]
  const next = events.find(event => event.seq > human.seq && isHumanEvent(event))
  const window = events.filter(event => event.seq > human.seq && (!next || event.seq < next.seq))
  const turnEvents = window.filter(event => ['turn/start', 'turn/end', 'assistant/message', 'assistant/attempt'].includes(event.type))
  const turns = new Set(turnEvents.map(event => event.data?.turn).filter(Number.isSafeInteger))
  if (turns.size !== 1 || turnEvents.some(event => !Number.isSafeInteger(event.data?.turn))) {
    throw new Error('Marked request does not identify one native turn')
  }
  const [turn] = turns
  const ends = turnEvents.filter(event => event.type === 'turn/end')
  if (ends.length > 1) throw new Error('Conflicting turn endings')
  const end = ends[0] ?? null
  if (end && turnEvents.some(event => event.seq > end.seq)) throw new Error('Additional turn events after end')
  const within = window.filter(event => !end || event.seq <= end.seq)
  let route = {}, attempts = [], final = null
  for (const event of within) {
    const data = event.data
    if (event.type === 'request/header') route = observedRoute(data?.header?.config)
    else if (event.type === 'request/context') route = observedRoute(data, route)
    else if (['assistant/message', 'assistant/attempt'].includes(event.type)) {
      const stream = streamSummary(data?.stream)
      const observed = observedRoute(data?.message?.source, route)
      route = {}
      attempts.push({ ...usageOf(data, stream.usage),
        toolStarts: Array.isArray(data?.stream) && data.stream.length ? stream.toolStarts : null,
        route: observed })
      // An attempt after an earlier message invalidates that earlier final.
      final = event.type === 'assistant/message' ? { event, finish: stream.terminal?.kind ?? null, route: observed } : null
    }
  }
  const reason = end?.data?.reason?.kind
  const lifecycle = reason === 'completed' ? 'completed'
    : ['error', 'failed'].includes(reason) ? 'failed'
      : ['aborted', 'cancelled', 'canceled', 'interrupted', 'stopped'].includes(reason) ? 'aborted' : 'unknown'
  const finalUsable = final && !final.event.data?.interrupted
    && (final.finish === null || final.finish === 'stop')
  const started = timeOf(human), ended = timeOf(end)
  return { humanSeq: human.seq, turn, parentRefs, childIds: [...childIds(within)],
    lifecycle, finalText: finalUsable ? messageText(messageOf(final.event)) : null,
    route: final?.route ?? { provider: null, model: null },
    elapsedMs: started !== null && ended !== null && ended >= started ? ended - started : null,
    attempts }
}

function sanitizedBatch(trace, caseIds, attempt) {
  const assignments = caseIds.map(id => ({ id, attempt }))
  const observations = trace.lifecycle === 'unknown' ? []
    : assignments.map(row => ({ ...row, lifecycle: trace.lifecycle }))
  let parsed = null
  try { parsed = JSON.parse(trace.finalText ?? '') } catch {}
  const strictJson = Array.isArray(parsed?.reports)
  const reports = strictJson ? parsed.reports.map(row => {
    const id = caseById.has(row?.id) ? row.id : '__foreign__'
    const keys = caseById.get(id)?.records ?? {}
    return { id, attempt, answer: ['a', 'b', 'c'].includes(row?.answer) ? row.answer : null,
      evidence: Array.isArray(row?.evidence) ? row.evidence.map(key =>
        typeof key === 'string' && Object.hasOwn(keys, key) ? key : '__invalid_evidence__') : null }
  }) : []
  return { assignments, observations, reports, strictJson }
}

function validCases(list) {
  if (!Array.isArray(list) || !list.length || new Set(list).size !== list.length
    || list.some(id => !caseById.has(id))) throw new Error('Invalid fixture case assignment')
  return list
}

/** Input records are decoded local archives, not model-generated lifecycle claims. */
export function importReviewRun({ runId, parent, children = [], settingsId }) {
  const marker = markerFor(runId)
  if (!present(parent?.sessionId) || !Array.isArray(children)) throw new Error('Missing parent session')
  const main = extractMarkedTurn(parent.records, marker, { userSeq: parent.userSeq })
  const batch = sanitizedBatch(main, ids, 'parent:' + main.humanSeq + ':' + main.turn)
  const claimedCases = new Set(), sessions = new Set([parent.sessionId])
  const traces = [main], childBatches = []
  for (const child of children) {
    if (!present(child?.sessionId) || sessions.has(child.sessionId)) throw new Error('Duplicate or missing child session')
    const assigned = validCases(child.caseIds)
    if (assigned.some(id => claimedCases.has(id))) throw new Error('Duplicate child case assignment')
    const trace = extractMarkedTurn(child.records, marker, { userSeq: child.userSeq, child: true })
    const linked = main.childIds.includes(child.sessionId) || trace.parentRefs.includes(parent.sessionId)
    if (!linked || trace.parentRefs.some(id => id !== parent.sessionId)) throw new Error('Child archive is not linked to this parent')
    sessions.add(child.sessionId)
    assigned.forEach(id => claimedCases.add(id))
    traces.push(trace)
    childBatches.push(sanitizedBatch(trace, assigned, 'child:' + childBatches.length + ':' + trace.humanSeq + ':' + trace.turn))
  }
  const attempts = traces.flatMap(trace => trace.attempts)
  const missingChildren = main.childIds.filter(id => !sessions.has(id)).length
  // Archive coverage is not whole-run completeness: abandoned live streams and
  // unexported child sessions may be absent. Host inputTokens is not assumed
  // to be uncached input; retain it under its original field name.
  const usage = { scope: 'observed-archive', elapsedMs: main.elapsedMs,
    modelResponses: attempts.length, toolStarts: addObserved(attempts, 'toolStarts'),
    ...Object.fromEntries(usageKeys.map(key => [key, addObserved(attempts, key)])) }
  const childBatch = childBatches.length ? {
    assignments: childBatches.flatMap(row => row.assignments),
    observations: childBatches.flatMap(row => row.observations),
    reports: childBatches.flatMap(row => row.reports),
  } : null
  return { runId, route: main.route, settingsId: label(settingsId), batch, childBatch, usage,
    archiveCoverage: { observedChildren: children.length, listedButMissingChildren: missingChildren,
      strictParentJson: batch.strictJson, childRoutes: traces.slice(1).map(trace => trace.route) } }
}

export function markedPacket(runId, mode) {
  const marker = markerFor(runId)
  if (!['direct', 'delegated'].includes(mode)) throw new Error('Expected direct or delegated')
  const packet = casePacket()
  const instruction = mode === 'direct'
    ? 'Answer the supplied fictional QA cases yourself. Do not delegate or use tools.'
    : 'Use native subagents to independently review the supplied fictional QA cases. Assign each case to exactly one child. Include the exact run marker on its own line and the full assigned case records in every child brief. Wait for results, check them, and return the complete final report yourself. Do not use other tools or external resources.'
  return marker + '\n' + instruction + '\n' + JSON.stringify(packet, null, 2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--packet') {
    console.log(markedPacket(process.argv[3], process.argv[4]))
  } else if (process.argv[2] === '--import' && process.argv[3]) {
    const manifestPath = resolve(process.argv[3]), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const load = spec => {
      const file = resolve(dirname(manifestPath), spec.path)
      if (!/^session\.v4\.jsonl(?:\.zstd)?$/.test(basename(file))) throw new Error('Expected a native session.v4.jsonl archive')
      if (basename(dirname(file)) !== spec.sessionId) throw new Error('Archive path and session ID do not match')
      return { ...spec, records: decodeArchive(readFileSync(file)) }
    }
    console.log(JSON.stringify(importReviewRun({ ...manifest, parent: load(manifest.parent),
      children: (manifest.children ?? []).map(load) }), null, 2))
  } else {
    console.error('Usage: node scripts/review-trace-import.mjs --packet RUN_ID direct|delegated | --import manifest.json')
    process.exitCode = 1
  }
}
