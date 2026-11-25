/** Offline summary of existing runtime-observations v1 metadata. */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const safeLabel = value => typeof value === 'string' && /^[\w./:@+-]{1,160}$/.test(value) ? value : null

function aggregate(rows, select) {
  const values = rows.map(select).filter(measured)
  return { observedSum: values.length ? values.reduce((a, b) => a + b, 0) : null,
    observed: values.length, missing: rows.length - values.length }
}

function summarize(rows) {
  const finish = { stop: 0, 'tool-calls': 0, 'max-tokens': 0, error: 0, aborted: 0, content_filter: 0, unknown: 0 }
  const settlement = { committed: 0, abandoned: 0, pending: 0, 'unobserved-end': 0, unknown: 0 }
  for (const row of rows) {
    const reason = row.finishObserved === true && row.terminalConflict !== true && Object.hasOwn(finish, row.finish) ? row.finish : 'unknown'
    finish[reason]++
    settlement[Object.hasOwn(settlement, row.settlement) ? row.settlement : 'unknown']++
  }
  return {
    attempts: rows.length,
    usage: Object.fromEntries(tokenFields.map(key => [key, aggregate(rows, row => row.usage?.[key])])),
    elapsedMs: aggregate(rows, row => row.elapsedMs),
    firstTextMs: aggregate(rows, row => row.firstTextMs),
    liveToolStarts: aggregate(rows, row => row.toolCalls),
    durableToolStarts: aggregate(rows, row => row.durableToolStarts),
    finish, settlement,
    streamGaps: rows.filter(row => row.streamGap === true).length,
    terminalConflicts: rows.filter(row => row.terminalConflict === true).length,
  }
}

export function summarizeAgentUsage(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.readOnly !== true || !Array.isArray(snapshot.items)) {
    throw new TypeError('Expected a read-only runtime-observations schemaVersion 1 snapshot')
  }
  const groups = new Map(), seen = new Set(), rows = []
  for (const row of snapshot.items) {
    if (!row || typeof row !== 'object') throw new TypeError('Invalid attempt row')
    const id = safeLabel(row.sessionId), attempt = safeLabel(row.attemptId)
    // A generation distinguishes replacement agents; missing identity is not enough to deduplicate.
    if (id && attempt && Number.isSafeInteger(row.generation)) {
      const key = JSON.stringify([id, row.generation, attempt])
      if (seen.has(key)) throw new Error('Duplicate attempt identity in snapshot')
      seen.add(key)
    }
    rows.push(row)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(row)
  }
  return {
    coverage: {
      source: 'runtime-observations-v1', observedAttempts: rows.length,
      evicted: measured(snapshot.evicted) ? snapshot.evicted : null,
      capacity: measured(snapshot.capacity) ? snapshot.capacity : null,
      completeHistory: false,
    },
    total: summarize(rows),
    sessions: [...groups].map(([sessionId, items]) => ({ sessionId, ...summarize(items) })),
    caveats: [
      'Only the supplied recent snapshot is summarized; omitted or evicted attempts are not zero.',
      'Token fields are independent observed sums, not additive or billing amounts. Missing usage is unknown.',
      'Elapsed sums are per-stream durations, not session wall time or tool waiting time.',
      'Live and durable tool starts are separate observations, not completed tool calls.',
      'Sessions are grouped by observed ID; parent-child relationships and task success are not inferred.',
    ],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/summarize-agent-usage.mjs runtime-snapshot.json')
    process.exitCode = 1
  } else {
    try {
      const data = JSON.parse(readFileSync(process.argv[2], 'utf8'))
      console.log(JSON.stringify(summarizeAgentUsage(data), null, 2))
    } catch (error) {
      console.error('Unable to summarize runtime snapshot: ' + error.message)
      process.exitCode = 1
    }
  }
}
