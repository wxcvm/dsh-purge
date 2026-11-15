/** Read-only rc.3 stream observation. Never retain message bodies or replay metadata. */
import { assessResponse, assessmentSummary } from './response-assessment.js';
import { isHumanEvent, messageOf, messageText } from './response-context.js';
const runtimes = new WeakMap();
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && /^[\w./:@+-]{1,160}$/.test(value) ? value : null;
const emptyRoute = () => ({ provider: null, model: null, providerSource: 'not-observed', modelSource: 'not-observed' });
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
  let terminal = null, usage = null;
  for (const record of Array.isArray(stream) ? stream : []) {
    const chunk = record?.chunk;
    if (chunk?.type === 'finish') terminal = chunk.reason;
    if (chunk?.type === 'usage') usage = chunk.usage;
  }
  return { terminal, usage };
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
  if (!reason) return;
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
  return Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, number(usage[key])]));
}

export function createRuntimeObservations({ now = Date.now, capacity = 200 } = {}) {
  capacity = Math.max(1, Math.min(200, Math.trunc(capacity) || 200));
  const agents = new WeakMap(), sessions = new WeakMap();
  let rows = [], generation = 0, evicted = 0, disposed = false, streamObserved = false;
  function sessionState(session) {
    if (!session || typeof session !== 'object') return null;
    if (!sessions.has(session)) sessions.set(session, { route: emptyRoute(), current: null, lastSeq: 0, humanSeq: 0 });
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
      if (session) session.route = emptyRoute(); // consume the request evidence; never borrow from a later request
      state.row = add({ generation: state.generation, sessionId: label(agent.session?.id || agent.id),
        attemptId: label(f.attemptId), turn: number(f.turn), step: number(f.step),
        ...route,
        startedAt: now(), startSeq: session?.lastSeq || 0, humanSeqAtStart: session?.humanSeq || 0, timingSource: 'live-stream-start', firstTextMs: null, elapsedMs: null,
        chunks: 0, toolCalls: 0, streamGap: false, streamEnded: false, terminalConflict: false,
        settlement: 'pending', eventType: null, seq: null, turnOutcome: null,
        interrupted: false, usage: null, assessment: assessmentSummary(null), ...terminalFields(null) });
      return;
    }
    const row = state.row;
    if (!row || state.attemptId !== f.attemptId || row.streamEnded) return;
    if (!Number.isSafeInteger(f.index) || f.index < row.chunks) return;
    state.revision = f.revision; streamObserved = true;
    if (f.index !== row.chunks) row.streamGap = true;
    if (f.type === 'chunk') {
      row.chunks = f.index + 1;
      const chunk = f.chunk;
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length && row.firstTextMs === null) row.firstTextMs = Math.max(0, now() - row.startedAt);
      if (chunk?.type === 'block-start' && chunk.blockType === 'tool-call') row.toolCalls++;
      if (chunk?.type === 'usage') row.usage = usageFields(chunk.usage);
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
    if (event.type === 'request/header') {
      state.route = routeFields(data?.header?.config, 'request-header');
    }
    if (event.type === 'request/context') state.route = routeFields(data, 'request-context', state.route);
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
      const { terminal, usage } = streamSummary(data.stream);
      observeTerminal(row, terminal, 'durable-stream');
      row.usage = usageFields(data.usage || usage) || row.usage;
      row.interrupted = data.interrupted === true;
      row.seq = number(event.seq); row.eventType = event.type; row.settlement = 'committed';
      // Only the matched assistant event can refine this attempt's route.
      // A later header/context may belong to an entirely different request.
      for (const key of ['provider', 'model']) {
        const observed = label(data.message?.source?.[key]);
        if (observed !== null) { row[key] = observed; row[key + 'Source'] = 'assistant-event'; }
      }
      if (event.type === 'assistant/message' && row.humanSeqAtStart && row.humanSeqAtStart < event.seq) {
        // Match the human request captured at start, not a newer request.
        let events = [];
        try { events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events || []; } catch {}
        const taskText = messageText(messageOf(events.find(e => e.seq === row.humanSeqAtStart && isHumanEvent(e))));
        const response = assessmentSummary(assessResponse(messageText(messageOf(event)), { taskText,
          lifecycle: data.interrupted ? 'interrupted' : undefined }));
        if (row.turnOutcome === 'completed') row.assessment = response;
        else if (!row.turnOutcome) {
          row.assessment = assessmentSummary(assessResponse(messageText(messageOf(event)), { taskText, lifecycle: 'pending' }));
          row.responseAssessment = response;
        }
      }
    }
    if (event.type === 'turn/end') {
      for (const r of rows) if (r.generation === current.generation && r.turn === data?.turn && event.seq > r.startSeq) {
        r.turnOutcome = label(data.reason?.kind);
        if (r.settlement === 'pending') r.settlement = 'unobserved-end';
        if (data.reason?.kind === 'completed' && r.responseAssessment) r.assessment = r.responseAssessment;
        else r.assessment = { ...r.assessment, decision: 'uncertain', reasonCodes: ['noncompleted-lifecycle'] };
        delete r.responseAssessment;
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
    snapshot({ sessionId, limit = 50 } = {}) {
      limit = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 50));
      return { ok: true, schemaVersion: 1, readOnly: true, streamSupport: streamObserved ? 'observed' : 'not-observed',
        capacity, evicted, disposed, items: rows.filter(r => !sessionId || r.sessionId === sessionId).slice(-limit).reverse().map(({ responseAssessment, ...r }) => ({ ...r, usage: r.usage && { ...r.usage }, assessment: { ...r.assessment, reasonCodes: [...r.assessment.reasonCodes] } })) };
    },
    dispose() { disposed = true; rows = []; },
  };
}

export function installRuntimeObservations(ctx, options) {
  runtimes.get(ctx)?.dispose();
  const observer = createRuntimeObservations(options), off = [];
  for (const [name, handler] of [['agent/created', observer.created], ['agent/disposed', observer.agentDisposed], ['agent/assistant-stream', observer.frame], ['session/event', observer.event]]) {
    try { off.push(ctx.on(name, (...args) => { try { handler(...args); } catch { /* observation must not interrupt the host */ } }, { global: true })); } catch { /* older hosts remain usable */ }
  }
  const runtime = { snapshot: observer.snapshot, dispose() { for (const stop of off.splice(0)) { try { stop?.(); } catch {} } observer.dispose(); if (runtimes.get(ctx) === runtime) runtimes.delete(ctx); } };
  runtimes.set(ctx, runtime);
  return runtime;
}

export function runtimeObservations(ctx, query) {
  return runtimes.get(ctx)?.snapshot(query) || { ok: true, schemaVersion: 1, readOnly: true, streamSupport: 'not-observed', capacity: 200, evicted: 0, items: [] };
}
