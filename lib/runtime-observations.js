/** Read-only rc.3 stream observation. Never retain message bodies or replay metadata. */
import { assessResponse, assessmentSummary } from './response-assessment.js';
import { isHumanEvent, messageOf, messageText } from './response-context.js';
import { toolEventId, toolResultKind, requestedTools, toolEvidence } from './tool-lifecycle.js';
import { createSubagentObservations } from './subagent-observations.js';
const runtimes = new WeakMap();
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && /^[\w./:@+-]{1,160}$/.test(value) ? value : null;
const positiveTokens = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const emptyRoute = () => ({ provider: null, model: null, providerSource: 'not-observed', modelSource: 'not-observed',
  contextWindow: null, contextWindowSource: 'not-observed', requestMaxTokens: null, requestMaxTokensSource: 'not-observed',
  requestHeaderSeq: null, requestContextSeq: null });
function clearCapacity(route) {
  return { ...route, contextWindow: null, contextWindowSource: 'not-observed', requestContextSeq: null };
}
function headerRoute(config, seq, previous) {
  const route = routeFields(config, 'request-header');
  // A header is a whole envelope. A changed route must not inherit another model's capacity.
  const same = route.provider !== null && route.model !== null &&
    route.provider === previous.provider && route.model === previous.model;
  if (same) {
    route.contextWindow = previous.contextWindow;
    route.contextWindowSource = previous.contextWindowSource;
    route.requestContextSeq = previous.requestContextSeq;
  }
  route.requestHeaderSeq = seq;
  route.requestMaxTokens = positiveTokens(config?.maxTokens);
  route.requestMaxTokensSource = route.requestMaxTokens === null ? 'not-observed' : 'request-header';
  return route;
}
function contextRoute(data, seq, previous) {
  const route = routeFields(data, 'request-context', clearCapacity(previous));
  // A context event may resolve a different route without a new header.
  if (['provider', 'model'].some(key => previous[key] !== null && route[key] !== previous[key])) {
    route.requestMaxTokens = null;
    route.requestMaxTokensSource = 'not-observed';
    route.requestHeaderSeq = null;
  }
  route.contextWindow = positiveTokens(data?.contextWindow);
  route.contextWindowSource = route.contextWindow === null ? 'not-observed' : 'request-context';
  route.requestContextSeq = seq;
  return route;
}
function contextBudget(row) {
  const window = row.contextWindow, output = row.requestMaxTokens;
  const budget = window !== null && output !== null ? window - output : null;
  // Official usage semantics: uncached input plus cache reads/writes, no output.
  const usage = row.usage;
  const input = usage?.inputTokens;
  const prompt = Number.isSafeInteger(input) && input >= 0
    && [usage.cacheReadTokens, usage.cacheWriteTokens].every(n => n === null || (Number.isSafeInteger(n) && n >= 0))
    ? input + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) : null;
  const promptTokens = Number.isSafeInteger(prompt) ? prompt : null;
  return { contextWindow: window, requestMaxTokens: output, messageBudgetTokens: budget,
    promptTokens, promptTokensSource: promptTokens === null ? 'not-observed' : row.usageSource,
    status: budget !== null && budget <= 0 ? 'no-message-budget'
      : window !== null && promptTokens !== null && promptTokens > window ? 'observed-prompt-over-window'
      : budget !== null && promptTokens !== null && promptTokens > budget ? 'observed-prompt-over-budget'
      : budget !== null && promptTokens !== null ? 'within-declared-budget' : 'insufficient-evidence',
    interpretation: 'recorded-route-capacity-and-observed-usage-not-next-request-estimate' };
}
function routeFields(value, source, previous = emptyRoute()) {
  const result = { ...previous };
  for (const key of ['provider', 'model']) {
    const observed = label(value?.[key]);
    if (observed !== null) { result[key] = observed; result[key + 'Source'] = source; }
  }
  return result;
}
const knownReasons = new Set(['stop', 'tool-calls', 'max-tokens', 'error', 'aborted', 'content_filter']);

export function streamSummary(stream) {
  let terminal = null, usage = null, toolStarts = 0, textObserved = false;
  let reasoningBlockStarts = 0, reasoningDeltaChunks = 0, reasoningDeltaChars = 0;
  let compactReasoningRecords = 0, compactReasoningChunks = 0, compactReasoningChars = 0, compactTextChunks = 0, compactInvalidRecords = 0;
  for (const record of Array.isArray(stream) ? stream : []) {
    // Native Desktop archives batch adjacent deltas into top-level *-chunks records.
    // Count strings only; archive time0/dt never substitutes for observed live timing.
    if (record?.type === 'reasoning-chunks' || record?.type === 'text-chunks') {
      if (!Array.isArray(record.texts) || record.texts.some(t => typeof t !== 'string')) compactInvalidRecords++;
      else {
        const texts = record.texts.filter(t => t.length);
        if (record.type === 'reasoning-chunks') {
          compactReasoningRecords++; compactReasoningChunks += texts.length;
          compactReasoningChars += texts.reduce((sum, t) => sum + t.length, 0);
        } else { compactTextChunks += texts.length; if (texts.length) textObserved = true; }
      }
      continue;
    }
    const chunk = record?.chunk;
    if (chunk?.type === 'finish' && typeof chunk.reason?.kind === 'string' && chunk.reason.kind) terminal = chunk.reason;
    if (chunk?.type === 'usage' && usageFields(chunk.usage)) usage = chunk.usage;
    if (chunk?.type === 'block-start' && chunk.blockType === 'tool-call') toolStarts++;
    if (chunk?.type === 'block-start' && chunk.blockType === 'reasoning') reasoningBlockStarts++;
    if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text.length) {
      reasoningDeltaChunks++; reasoningDeltaChars += chunk.text.length;
    }
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length) textObserved = true;
  }
  return { terminal, usage, toolStarts, textObserved, reasoningBlockStarts, reasoningDeltaChunks, reasoningDeltaChars,
    compactReasoningRecords, compactReasoningChunks, compactReasoningChars, compactTextChunks, compactInvalidRecords };
}

// Real Desktop archives may contain a committed reasoning block without
// any recognized reasoning-delta. Only retain counts; never replay or expose text.
export function reasoningBlockSummary(message) {
  if (!Array.isArray(message?.content)) return null;
  let blocks = 0, textBlocks = 0, chars = 0;
  for (const block of message.content) {
    if (block?.type !== 'reasoning') continue;
    blocks++;
    if (typeof block.text === 'string' && block.text.length) {
      textBlocks++; chars += block.text.length;
    }
  }
  return { blocks, textBlocks, chars };
}
function terminalFields(reason, source = 'host-stream') {
  return {
    finishObserved: !!reason,
    finish: knownReasons.has(reason?.kind) ? reason.kind : 'unknown',
    hostReason: label(reason?.kind),
    reasonSource: reason ? source : 'not-observed',
    // rc.3 does not promise raw Provider finish_reason on this interface.
    providerReason: null,
    errorCode: label(reason?.failure?.code),
    httpStatus: Number.isInteger(reason?.failure?.status) && reason.failure.status >= 100 && reason.failure.status <= 599 ? reason.failure.status : null,
  };
}

// A durable event may omit the live finish or arrive before the stream/end frame.
// Preserve actual live evidence; flag contradictory observed metadata without
// substituting a fabricated provider terminal or retaining the error message.
function observeTerminal(row, reason, source) {
  if (typeof reason?.kind !== 'string' || !reason.kind) return;
  const next = terminalFields(reason, source);
  if (row.finishObserved) {
    for (const key of ['hostReason', 'errorCode', 'httpStatus']) {
      if (row[key] !== null && next[key] !== null && row[key] !== next[key]) row.terminalConflict = true;
    }
    if (row.reasonSource === 'host-stream' && source !== 'host-stream') return;
    if (row.reasonSource === source) return;
  }
  Object.assign(row, next);
}

function usageFields(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const fields = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, number(usage[key])]));
  return Object.values(fields).some(value => value !== null) ? fields : null;
}

// Never combine fields from independent usage snapshots. A durable summary
// with no total must not erase a measured live total, and an empty snapshot
// is not evidence of zero tokens. Prefer a usable durable final total.
function observeUsage(row, usage, source) {
  const fields = usageFields(usage);
  if (!fields) return;
  if (source === 'host-stream') row.liveUsage = fields;
  else row.durableUsage = fields;
  const durable = row.durableUsage, live = row.liveUsage;
  const useDurable = durable && (durable.totalTokens !== null || live?.totalTokens == null);
  row.usage = useDurable ? durable : live;
  row.usageSource = useDurable ? 'durable-stream' : 'host-stream';
}

// Read the existing session view without retaining or modifying its messages.
function sessionSnapshot(session) {
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : session?.events;
    if (Array.isArray(events)) return events;
  } catch { /* older or unavailable session view */ }
  return null;
}

// On a late observer mount, recover only a human request with no later observed
// turn end. Do not borrow a previous completed task from the transcript.
function recoverActiveHuman(session, observedEndSeq = 0) {
  const events = sessionSnapshot(session);
  if (!events) return 0;
  let humanSeq = 0, endSeq = observedEndSeq;
  for (const event of events) {
    if (!Number.isSafeInteger(event?.seq) || event.seq <= 0) continue;
    if (isHumanEvent(event)) humanSeq = Math.max(humanSeq, event.seq);
    if (event.type === 'turn/end') endSeq = Math.max(endSeq, event.seq);
  }
  return humanSeq > endSeq ? humanSeq : 0;
}

// The text classifier is observational only. A complete turn does not make every
// intermediate or failed attempt in that turn a complete assistant answer.
function observedAssessment(row, rows) {
  const base = row.responseAssessment || assessmentSummary(null);
  const uncertain = code => ({ ...base, decision: 'uncertain', scope: 'none', reasonCodes: [code] });
  if (row.terminalConflict) return uncertain('terminal-conflict');
  if (row.interrupted || row.turnOutcome !== 'completed') return uncertain('noncompleted-lifecycle');
  if (!row.finishObserved) return uncertain('missing-stream-terminal');
  if (row.finish !== 'stop' || row.errorCode || row.httpStatus >= 400) return uncertain('nonfinal-stream-terminal');
  if (row.eventType !== 'assistant/message' || row.settlement !== 'committed') return uncertain('missing-committed-response');
  if (rows.slice(rows.indexOf(row) + 1).some(other => other.generation === row.generation && other.turn === row.turn)) {
    return uncertain('superseded-attempt');
  }
  return row.responseAssessment ? base : uncertain('missing-task-context');
}

export function createRuntimeObservations({ now = Date.now, capacity = 200 } = {}) {
  capacity = Math.max(1, Math.min(200, Math.trunc(capacity) || 200));
  const agents = new WeakMap(), sessions = new WeakMap(), toolsByRow = new WeakMap();
  const subagents = createSubagentObservations({ capacity });
  let rows = [], generation = 0, evicted = 0, disposed = false, streamObserved = false;
  function sessionState(session) {
    if (!session || typeof session !== 'object') return null;
    if (!sessions.has(session)) sessions.set(session, { route: emptyRoute(), current: null, lastSeq: 0, humanSeq: 0, endSeq: 0, compactionSeq: 0 });
    return sessions.get(session);
  }
  function agentState(agent) {
    if (!agent || typeof agent !== 'object') return null;
    if (!agents.has(agent)) {
      const state = { generation: ++generation, revision: 0, dead: false, row: null, attemptId: null };
      agents.set(agent, state);
      const session = sessionState(agent.session);
      if (session) {
        const previous = session.current;
        if (previous?.row?.settlement === 'pending') previous.row.settlement = 'unobserved-end';
        session.current = state;
      }
    }
    return agents.get(agent);
  }
  function add(row) {
    if (rows.length >= capacity) {
      const ended = rows.findIndex(r => r.settlement !== 'pending');
      rows.splice(ended < 0 ? 0 : ended, 1); evicted++;
    }
    rows.push(row); return row;
  }
  function frame({ agent, frame: f } = {}) {
    if (disposed || !f || !['start', 'chunk', 'end'].includes(f.type)) return;
    // A stray chunk/end from an unseen Agent must not claim a live session.
    const state = f.type === 'start' ? agentState(agent) : agents.get(agent);
    const session = sessionState(agent?.session);
    if (!state || state.dead || session?.current !== state) return;
    if (!Number.isSafeInteger(f.revision) || f.revision <= state.revision) return;
    if (f.type === 'start') {
      if (typeof f.attemptId !== 'string' || !f.attemptId || f.attemptId === state.attemptId) return;
      state.revision = f.revision; streamObserved = true;
      state.attemptId = f.attemptId;
      if (state.row?.settlement === 'pending') state.row.settlement = 'unobserved-end';
      const route = session ? session.route : emptyRoute();
      // rc.3 logs header/context only on change; unchanged requests inherit the latest
      // recorded envelope and route. Each row keeps its own immutable scalar snapshot.
      const observedHuman = session?.humanSeq || 0;
      const humanSeq = observedHuman || recoverActiveHuman(agent?.session, session?.endSeq || 0);
      state.row = add({ generation: state.generation, sessionId: label(agent.session?.id || agent.id),
        attemptId: label(f.attemptId), turn: number(f.turn), step: number(f.step),
        ...route,
        startedAt: now(), startSeq: Math.max(session?.lastSeq || 0, humanSeq), humanSeqAtStart: humanSeq,
        humanSourceAtStart: observedHuman ? 'session-event' : humanSeq ? 'session-snapshot' : 'not-observed',
        compactionSeqAtStart: session?.compactionSeq || null, compactionSeqAtResponse: null,
        taskContextAtResponse: 'not-observed', timingSource: 'live-stream-start', firstTextMs: null, elapsedMs: null,
        chunks: 0, observedChunks: 0, reasoningChunks: 0, reasoningChars: 0, reasoningBlockStarts: 0, durableReasoningBlockStarts: null, durableReasoningDeltaChunks: null, durableReasoningDeltaChars: null, durableReasoningBlocks: null, durableReasoningTextBlocks: null, durableReasoningChars: null, durableCompactReasoningRecords: null, durableCompactReasoningChunks: null, durableCompactReasoningChars: null, durableCompactTextChunks: null, durableCompactInvalidRecords: null, firstReasoningMs: null, lastReasoningMs: null, reasoningAfterText: false, firstToolMs: null, toolCalls: 0, durableToolStarts: null, durableTextObserved: null, streamGap: false, streamEnded: false, terminalConflict: false,
        settlement: 'pending', eventType: null, seq: null, turnOutcome: null, turnEndedAt: null,
        interrupted: false, usage: null, usageSource: 'not-observed', liveUsage: null, durableUsage: null, assessment: assessmentSummary(null), ...terminalFields(null) });
      return;
    }
    const row = state.row;
    if (!row || state.attemptId !== f.attemptId || row.streamEnded) return;
    if (!Number.isSafeInteger(f.index) || f.index < row.chunks) return;
    state.revision = f.revision; streamObserved = true;
    if (f.index !== row.chunks) row.streamGap = true;
    if (f.type === 'chunk') {
      row.chunks = f.index + 1;
      row.observedChunks++;
      const chunk = f.chunk;
      if (chunk?.type === 'block-start' && chunk.blockType === 'reasoning') row.reasoningBlockStarts++;
      if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text.length) {
        row.reasoningChunks++;
        row.reasoningChars += chunk.text.length;
        const elapsed = Math.max(0, now() - row.startedAt);
        if (row.firstReasoningMs === null) row.firstReasoningMs = elapsed;
        row.lastReasoningMs = elapsed;
        if (row.firstTextMs !== null) row.reasoningAfterText = true;
      }
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length && row.firstTextMs === null) row.firstTextMs = Math.max(0, now() - row.startedAt);
      if (chunk?.type === 'block-start' && chunk.blockType === 'tool-call') {
        row.toolCalls++;
        if (row.firstToolMs === null) row.firstToolMs = Math.max(0, now() - row.startedAt);
      }
      if (chunk?.type === 'usage') observeUsage(row, chunk.usage, 'host-stream');
      if (chunk?.type === 'finish') observeTerminal(row, chunk.reason, 'host-stream');
    } else {
      row.streamEnded = true; row.elapsedMs = Math.max(0, now() - row.startedAt);
      if (f.outcome?.kind === 'committed') {
        row.settlement = 'committed';
        row.eventType = row.eventType || (['assistant/message', 'assistant/attempt'].includes(f.outcome.eventType) ? f.outcome.eventType : null);
        row.seq = row.seq ?? number(f.outcome.seq);
      } else if (row.settlement !== 'committed') row.settlement = 'abandoned';
    }
  }
  function event(session, event) {
    if (disposed || !event) return;
    const state = sessionState(session);
    if (!state) return;
    if (!Number.isSafeInteger(event.seq) || event.seq <= state.lastSeq) return;
    state.lastSeq = event.seq;
    const data = event.data;
    if (isHumanEvent(event)) state.humanSeq = event.seq;
    if (event.type === 'turn/end') {
      state.endSeq = event.seq;
      // Completed requests cannot be borrowed by a later autonomous turn.
      // The attempt row already holds its own immutable task sequence.
      state.humanSeq = 0;
    }
    if (event.type === 'compaction/end') state.compactionSeq = event.seq;
    if (event.type === 'request/header') {
      state.route = headerRoute(data?.header?.config, event.seq, state.route);
    }
    if (event.type === 'request/context') state.route = contextRoute(data, event.seq, state.route);
    const current = state.current;
    if (!current?.row || current.dead) return;
    if (['assistant/message', 'assistant/attempt'].includes(event.type)) {
      const matches = r => r.generation === current.generation && data?.turn === r.turn && data?.step === r.step && event.seq > r.startSeq;
      // Late persistence may follow stream/end. Only attach it by its exact
      // committed sequence, never by turn/step alone after a newer attempt starts.
      const exact = rows.find(r => matches(r) && r.seq === event.seq);
      const active = current.row;
      const row = exact || (matches(active) && !active.streamEnded && active.seq === null ? active : null);
      if (!row) return;
      const { terminal, usage, toolStarts, textObserved, reasoningBlockStarts, reasoningDeltaChunks, reasoningDeltaChars,
        compactReasoningRecords, compactReasoningChunks, compactReasoningChars, compactTextChunks, compactInvalidRecords } = streamSummary(data.stream);
      // Keep live and durable evidence separate. Never infer live timing from a transcript,
      // sum overlapping tool starts, or interpret a tool start as execution success.
      if (Array.isArray(data.stream) && data.stream.length) {
        row.durableToolStarts = toolStarts;
        row.durableTextObserved = textObserved;
        row.durableReasoningBlockStarts = reasoningBlockStarts;
        row.durableReasoningDeltaChunks = reasoningDeltaChunks;
        row.durableReasoningDeltaChars = reasoningDeltaChars;
        row.durableCompactReasoningRecords = compactReasoningRecords;
        row.durableCompactReasoningChunks = compactReasoningChunks;
        row.durableCompactReasoningChars = compactReasoningChars;
        row.durableCompactTextChunks = compactTextChunks;
        row.durableCompactInvalidRecords = compactInvalidRecords;
      }
      const reasoning = reasoningBlockSummary(data.message);
      if (reasoning) {
        row.durableReasoningBlocks = reasoning.blocks;
        row.durableReasoningTextBlocks = reasoning.textBlocks;
        row.durableReasoningChars = reasoning.chars;
      }
      observeTerminal(row, terminal, 'durable-stream');
      // A sparse top-level usage object must not hide a richer durable stream snapshot.
      const eventUsage = usageFields(data.usage), streamUsage = usageFields(usage);
      const durableUsage = eventUsage?.totalTokens != null ? eventUsage : streamUsage?.totalTokens != null ? streamUsage : eventUsage || streamUsage;
      observeUsage(row, durableUsage, 'durable-stream');
      row.interrupted = data.interrupted === true;
      row.seq = number(event.seq); row.eventType = event.type; row.settlement = 'committed';
      // Only the matched assistant event can refine this attempt's route.
      // A later header/context may belong to an entirely different request.
      for (const key of ['provider', 'model']) {
        const observed = label(data.message?.source?.[key]);
        if (observed !== null) {
          if (row[key] !== null && row[key] !== observed) {
            // Conflicting actual route evidence cannot establish the old route's capacity.
            row.contextWindow = null;
            row.contextWindowSource = 'not-observed';
            row.requestContextSeq = null;
            row.requestMaxTokens = null;
            row.requestMaxTokensSource = 'not-observed';
            row.requestHeaderSeq = null;
          }
          row[key] = observed; row[key + 'Source'] = 'assistant-event';
        }
      }
      if (event.type === 'assistant/message') {
        row.compactionSeqAtResponse = state.compactionSeq || null;
        const tools = requestedTools(data.message);
        if (tools) toolsByRow.set(row, tools);
      }
      if (event.type === 'assistant/message' && row.humanSeqAtStart && row.humanSeqAtStart < event.seq) {
        // Match the human request captured at start, not a newer request.
        const events = sessionSnapshot(session);
        const human = events?.find(e => e?.seq === row.humanSeqAtStart && isHumanEvent(e));
        row.taskContextAtResponse = human ? 'present' : events ? 'missing' : 'unavailable';
        if (human) {
          // Retain only the projected classification, never the source text.
          row.responseAssessment = assessmentSummary(assessResponse(messageText(messageOf(event)), {
            taskText: messageText(messageOf(human)),
          }));
        }
      }
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      const id = toolEventId(event);
      if (!id) return;
      // Tool execution follows the committed assistant request. Use its exact
      // turn, step and call identity; never attach a late result to a different attempt.
      const candidates = rows.filter(r => r.generation === current.generation &&
        r.turn === data?.turn && r.step === data?.step && r.seq !== null &&
        event.seq > r.seq && toolsByRow.get(r)?.has(id));
      if (candidates.length !== 1) return;
      const tool = toolsByRow.get(candidates[0]).get(id);
      if (event.type === 'tool/call') {
        if (tool.recorded || tool.result !== null) tool.conflict = true;
        tool.recorded = true;
      } else {
        if (tool.result !== null) tool.conflict = true;
        else tool.result = toolResultKind(data);
      }
    }
    if (event.type === 'turn/end') {
      const endedAt = now();
      for (const r of rows) if (r.generation === current.generation && r.turn === data?.turn && event.seq > r.startSeq) {
        r.turnOutcome = label(data.reason?.kind);
        if (r.turnEndedAt === null) r.turnEndedAt = endedAt;
        if (r.settlement === 'pending') r.settlement = 'unobserved-end';
      }
    }
  }
  function agentDisposed({ agent } = {}) {
    const state = agents.get(agent);
    if (!state) return;
    state.dead = true;
    if (state.row?.settlement === 'pending') state.row.settlement = 'unobserved-end';
  }
  return { frame, event, created: ({ agent } = {}) => { if (!disposed) agentState(agent); }, agentDisposed,
    subagentStart: subagents.start, subagentEnd: subagents.end,
    snapshot({ sessionId, limit = 50 } = {}) {
      limit = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 50));
      const matched = rows.filter(r => !sessionId || r.sessionId === sessionId);
      return { ok: true, schemaVersion: 1, readOnly: true, streamSupport: streamObserved ? 'observed' : 'not-observed',
        capacity, evicted, disposed, matchedCount: matched.length, returnedCount: Math.min(limit, matched.length), subagents: subagents.snapshot({ parentSessionId: sessionId }), items: matched.slice(-limit).reverse().map(row => {
          const { responseAssessment, liveUsage, durableUsage, ...r } = row;
          const a = observedAssessment(row, rows);
          return { ...r, toolEvidence: toolEvidence(toolsByRow.get(row)), contextBudget: contextBudget(row), usage: r.usage && { ...r.usage }, liveUsage: liveUsage && { ...liveUsage }, durableUsage: durableUsage && { ...durableUsage }, assessment: { ...a, reasonCodes: [...a.reasonCodes] } };
        }) };
    },
    dispose() { disposed = true; rows = []; subagents.dispose(); },
  };
}

export function installRuntimeObservations(ctx, options) {
  runtimes.get(ctx)?.dispose();
  const observer = createRuntimeObservations(options), off = [];
  for (const [name, handler] of [['agent/created', observer.created], ['agent/disposed', observer.agentDisposed], ['agent/assistant-stream', observer.frame], ['session/event', observer.event], ['subagent/start', observer.subagentStart], ['subagent/end', observer.subagentEnd]]) {
    try { off.push(ctx.on(name, (...args) => { try { handler(...args); } catch { /* observation must not interrupt the host */ } }, { global: true })); } catch { /* older hosts remain usable */ }
  }
  const runtime = { snapshot: observer.snapshot, dispose() { for (const stop of off.splice(0)) { try { stop?.(); } catch {} } observer.dispose(); if (runtimes.get(ctx) === runtime) runtimes.delete(ctx); } };
  runtimes.set(ctx, runtime);
  return runtime;
}

export function runtimeObservations(ctx, query) {
  return runtimes.get(ctx)?.snapshot(query) || { ok: true, schemaVersion: 1, readOnly: true, streamSupport: 'not-observed', capacity: 200, evicted: 0, matchedCount: 0, returnedCount: 0, subagents: createSubagentObservations().snapshot({ parentSessionId: query?.sessionId }), items: [] };
}
