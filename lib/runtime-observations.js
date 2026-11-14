/** Read-only rc.3 stream observation. Never retain message bodies or replay metadata. */
const runtimes = new WeakMap();
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && /^[\w./:@+-]{1,160}$/.test(value) ? value : null;
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

function terminalFields(reason) {
  return {
    finishObserved: !!reason,
    finish: knownReasons.has(reason?.kind) ? reason.kind : 'unknown',
    hostReason: label(reason?.kind),
    reasonSource: reason ? 'host-stream' : 'not-observed',
    // rc.3 does not promise raw Provider finish_reason on this interface.
    providerReason: null,
    errorCode: label(reason?.failure?.code),
    httpStatus: Number.isInteger(reason?.failure?.status) && reason.failure.status >= 100 && reason.failure.status <= 599 ? reason.failure.status : null,
  };
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
    if (!sessions.has(session)) sessions.set(session, { provider: null, model: null, current: null, lastSeq: 0 });
    return sessions.get(session);
  }
  function agentState(agent) {
    if (!agent || typeof agent !== 'object') return null;
    if (!agents.has(agent)) {
      const state = { generation: ++generation, revision: 0, dead: false, row: null };
      agents.set(agent, state);
      const session = sessionState(agent.session);
      if (session) session.current = state;
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
    const state = agentState(agent), session = sessionState(agent?.session);
    if (!state || state.dead || session?.current !== state) return;
    if (!Number.isSafeInteger(f.revision) || f.revision <= state.revision) return;
    state.revision = f.revision; streamObserved = true;
    if (f.type === 'start') {
      if (state.row?.settlement === 'pending') state.row.settlement = 'unobserved-end';
      state.row = add({ generation: state.generation, sessionId: label(agent.session?.id || agent.id),
        attemptId: label(f.attemptId), turn: number(f.turn), step: number(f.step),
        provider: session?.provider || null, model: session?.model || null,
        startedAt: now(), startSeq: session?.lastSeq || 0, timingSource: 'live-stream-start', firstTextMs: null, elapsedMs: null,
        chunks: 0, toolCalls: 0, streamGap: false, streamEnded: false,
        settlement: 'pending', eventType: null, seq: null, turnOutcome: null,
        interrupted: false, usage: null, ...terminalFields(null) });
      return;
    }
    const row = state.row;
    if (!row || row.attemptId !== label(f.attemptId) || row.streamEnded) return;
    if (!Number.isSafeInteger(f.index) || f.index < row.chunks) return;
    if (f.index !== row.chunks) row.streamGap = true;
    if (f.type === 'chunk') {
      row.chunks = f.index + 1;
      const chunk = f.chunk;
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length && row.firstTextMs === null) row.firstTextMs = Math.max(0, now() - row.startedAt);
      if (chunk?.type === 'block-start' && chunk.blockType === 'tool-call') row.toolCalls++;
      if (chunk?.type === 'usage') row.usage = usageFields(chunk.usage);
      if (chunk?.type === 'finish') Object.assign(row, terminalFields(chunk.reason));
    } else {
      row.streamEnded = true; row.elapsedMs = Math.max(0, now() - row.startedAt);
      if (f.outcome?.kind === 'committed') {
        row.settlement = 'committed'; row.eventType = ['assistant/message', 'assistant/attempt'].includes(f.outcome.eventType) ? f.outcome.eventType : null;
        row.seq = number(f.outcome.seq);
      } else row.settlement = 'abandoned';
    }
  }
  function event(session, event) {
    if (disposed || !event) return;
    const state = sessionState(session);
    if (!state) return;
    if (!Number.isSafeInteger(event.seq) || event.seq <= state.lastSeq) return;
    state.lastSeq = event.seq;
    const data = event.data;
    if (event.type === 'request/header') {
      state.provider = label(data?.header?.config?.provider); state.model = label(data?.header?.config?.model);
    }
    if (event.type === 'request/context') { state.provider = label(data?.provider); state.model = label(data?.model); }
    const row = state.current?.row;
    if (!row || state.current.dead) return;
    if (['assistant/message', 'assistant/attempt'].includes(event.type) && data?.turn === row.turn && data?.step === row.step && !row.streamEnded) {
      if (row.seq !== null) return;
      const { terminal, usage } = streamSummary(data.stream);
      Object.assign(row, terminalFields(terminal));
      row.usage = usageFields(data.usage || usage) || row.usage;
      row.interrupted = data.interrupted === true;
      row.seq = number(event.seq); row.eventType = event.type; row.settlement = 'committed';
      row.provider = label(data.message?.source?.provider) || state.provider || row.provider;
      row.model = label(data.message?.source?.model) || state.model || row.model;
    }
    if (event.type === 'turn/end' && data?.turn === row.turn) {
      for (const r of rows) if (r.generation === row.generation && r.turn === row.turn) r.turnOutcome = label(data.reason?.kind);
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
        capacity, evicted, disposed, items: rows.filter(r => !sessionId || r.sessionId === sessionId).slice(-limit).reverse().map(r => ({ ...r, usage: r.usage && { ...r.usage } })) };
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
