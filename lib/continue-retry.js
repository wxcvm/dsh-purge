import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_CONTINUE_RETRY = Object.freeze({
  autoRetry: true,
  retryMax: 3,
  // [dsh-purge] 二轮立刻发被拒根因之一:idle 后 280ms 自动续跑与用户 submit 竞态。
  // 关自动续跑,只保留 autoRetry(request-error 自动重试)。
  autoContinue: false,
  continueMax: 3,
  continueText: "继续",
});

const PERMANENT_CODES = new Set([
  "AUTH",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID",
  "INVALID_REQUEST",
  "QUOTA",
  "ACCOUNT_QUOTA",
  "BILLING",
  "MODEL_NOT_FOUND",
  "CONTEXT_OVERFLOW",
  "CONTEXT_LENGTH",
  "CONTEXT_WINDOW_EXCEEDED",
  "NO_ADAPTER",
  "MISSING_CREDENTIAL",
  "INVALID_CREDENTIAL",
  "CONTEXT_LENGTH_EXCEEDED",
  "EXCEED_CONTEXT_SIZE_ERROR",
  "INSUFFICIENT_QUOTA",
  "INVALID_API_KEY",
  "CONTENT_FILTER",
  "CONTENT_POLICY_VIOLATION",
  "POLICY_VIOLATION",
  "CONTENT_REFUSED",
  // Official rc.3 machine codes that require a different request or repair.
  "ABORTED",
  "ACCOUNT_SIGN_IN_REQUIRED",
  "ACCOUNT_TOKEN_INVALID",
  "CLIENT_UPGRADE_REQUIRED",
  "INVALID_ADAPTER",
  "INVALID_CONFIG",
  "INVALID_MODEL_CONTEXT",
  "INVALID_MODEL_INFO",
  "INVALID_MODEL_MAX_TOKENS",
  "INVALID_MODEL_REASONING",
  "INVALID_PREPARED_CALL",
  "INVALID_REPLAY_STATE",
  "IMAGE_OFFLOAD_REQUIRED",
  "MODEL_SWITCH_COMPACTION_FAILED",
  "MODEL_UNSUPPORTED",
  "UNKNOWN_MODEL",
  "NO_CREDENTIAL_STORE",
  "REGISTRATION_DISPOSED",
  "REQUEST_EXTENSION",
  "REQUEST_HEADERS",
  "UNSUPPORTED_CONTENT",
  "UNSUPPORTED_OPTION",
  "UNSUPPORTED_REASONING_EFFORT",
]);

// Repeating the same request cannot resolve these explicit client failures.
const NON_RETRY_HTTP = new Set([400, 401, 402, 403, 404, 405, 410, 413, 415, 422, 451]);

function permanentRequestFailure(failure) {
  if (!failure || typeof failure !== "object") return false;
  const status = Number(failure.status ?? failure.statusCode);
  const httpCode = /^HTTP_(\d{3})$/i.exec(String(failure.code ?? ""));
  return failure.retryable === false || isPermanentFailure(failure.code) || NON_RETRY_HTTP.has(status)
    || (httpCode !== null && NON_RETRY_HTTP.has(Number(httpCode[1])));
}

/** Official already retried these; a new "继续" turn cannot clear them. */
const NO_CONTINUE_CODES = new Set([
  ...PERMANENT_CODES,
  "RATE_LIMIT",
  "TRANSPORT",
]);

const ABNORMAL_KINDS = new Set(["error", "aborted", "interrupted", "max-tokens"]);

export function clampCount(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(20, Math.trunc(n)));
}

export function normalizeConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const retryMax = clampCount(src.retryMax, DEFAULT_CONTINUE_RETRY.retryMax);
  const continueMax = clampCount(src.continueMax, DEFAULT_CONTINUE_RETRY.continueMax);
  const text = typeof src.continueText === "string" ? src.continueText.trim() : "";
  return {
    autoRetry: src.autoRetry !== false && retryMax > 0,
    retryMax,
    autoContinue: src.autoContinue === true && continueMax > 0,
    continueMax,
    continueText: text || DEFAULT_CONTINUE_RETRY.continueText,
  };
}

export function settingsPath(dshHome) {
  return path.join(dshHome, "dsh-purge", "continue-retry.json");
}

export function loadSettings(dshHome) {
  const fp = settingsPath(dshHome);
  try {
    if (!fs.existsSync(fp)) return {};
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function mergeConfig(pluginCfg, saved) {
  const merged = { ...DEFAULT_CONTINUE_RETRY, ...pluginCfg, ...saved };
  if (pluginCfg?.autoContinue !== true && DEFAULT_CONTINUE_RETRY.autoContinue !== true) {
    merged.autoContinue = false;
  }
  return normalizeConfig(merged);
}

export function lastTurnEnd(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.type === "turn/end") return event;
  }
  return null;
}

export function isUserAbort(reason) {
  if (!reason || reason.kind !== "aborted") return false;
  const cause = reason.reason;
  if (cause === "user" || cause === "cancel") return true;
  if (cause && typeof cause === "object") {
    return cause.kind === "user" || cause.kind === "cancel";
  }
  return false;
}

export function isAbnormalReason(reason) {
  return Boolean(reason && ABNORMAL_KINDS.has(reason.kind));
}

export function failureCodeOf(reason) {
  const raw = reason?.error?.code ?? reason?.failure?.code ?? reason?.code;
  return String(raw || "").toUpperCase();
}

export function shouldAutoContinue(reason) {
  if (!isAbnormalReason(reason) || isUserAbort(reason)) return false;
  const code = failureCodeOf(reason);
  return !NO_CONTINUE_CODES.has(code) && !permanentRequestFailure(reason?.error ?? reason?.failure ?? reason);
}

export function isPermanentFailure(code) {
  return PERMANENT_CODES.has(String(code || "").toUpperCase());
}

export function shouldAutoRetry(failure, signal) {
  if (signal?.aborted) return false;
  return !permanentRequestFailure(failure);
}

export function makeContinueMessage(text) {
  const body = String(text || DEFAULT_CONTINUE_RETRY.continueText).trim() || DEFAULT_CONTINUE_RETRY.continueText;
  return {
    id: `dsh-purge-continue-${randomUUID()}`,
    role: "user",
    content: [{ type: "text", text: body }],
    source: {
      kind: "dsh-purge",
      form: "notice",
      summary: "continue",
    },
  };
}

// cordis 没有 session/removed 事件可挂,长开进程 session 一直累积。
// 用 Map 插入顺序做 FIFO 兜底:超过 CAP 就丢最早的一批。
const TRACKER_SESSION_CAP = 200;
const TRACKER_SESSION_EVICT = 50;

export function createTracker() {
  const bySession = new Map();

  function slot(sessionId) {
    const id = String(sessionId || "");
    if (!id) return null;
    let cur = bySession.get(id);
    if (!cur) {
      if (bySession.size >= TRACKER_SESSION_CAP) {
        let i = 0;
        for (const k of bySession.keys()) {
          if (i >= TRACKER_SESSION_EVICT) break;
          bySession.delete(k);
          i += 1;
        }
      }
      cur = { retry: 0, continue: 0, lastContinueSeq: 0, lastRetryKey: "" };
      bySession.set(id, cur);
    }
    return cur;
  }

  return {
    takeRetry(sessionId, key, max) {
      const cur = slot(sessionId);
      if (!cur || max <= 0) return false;
      if (key && cur.lastRetryKey === key) return false;
      if (cur.retry >= max) return false;
      cur.retry += 1;
      cur.lastRetryKey = key || "";
      return true;
    },
    takeContinue(sessionId, seq, max, maxFailStreak = 3) {
      const cur = slot(sessionId);
      if (!cur || max <= 0) return false;
      if (seq && cur.lastContinueSeq === seq) return false;
      if (cur.continue >= max) return false;
      if ((cur.failStreak || 0) >= maxFailStreak) return false;
      cur.continue += 1;
      cur.lastContinueSeq = seq || 0;
      return true;
    },
    refundContinue(sessionId, seq) {
      const cur = slot(sessionId);
      if (!cur || cur.continue <= 0) return;
      cur.continue -= 1;
      // 关键:不清 lastContinueSeq —— 同一 seq 的失败不再重复消耗 continue 预算
      // 关键:记录连续失败次数,达到 maxFailStreak 永久停手(Issue #85)
      cur.failStreak = (cur.failStreak || 0) + 1;
      if (seq) {
        cur.failedSeqs = cur.failedSeqs || new Set();
        // cap:长会话 failedSeqs 永不清(resetIfCompleted 只在 completed/blocked 时清),
        // 失败 seq 累积几千几万 → Set 内存涨。cap 256,超了删最老的(Set 保持 insertion order)。
        if (cur.failedSeqs.size >= 256) {
          const oldest = cur.failedSeqs.values().next().value;
          if (oldest !== undefined) cur.failedSeqs.delete(oldest);
        }
        cur.failedSeqs.add(seq);
      }
    },
    reset(sessionId) {
      const id = String(sessionId || "");
      if (id) bySession.delete(id);
    },
    resetIfCompleted(sessionId, reason) {
      if (reason?.kind === "completed" || reason?.kind === "blocked") {
        const cur = bySession.get(String(sessionId || ""));
        if (cur) { cur.failStreak = 0; cur.failedSeqs = undefined; }
        this.reset(sessionId);
      }
    },
  };
}

export function sessionEventsOf(agent) {
  const session = agent?.session;
  if (!session) return [];
  try {
    if (typeof session.snapshotEvents === "function") return session.snapshotEvents() || [];
  } catch { /* ignore */ }
  try {
    if (Array.isArray(session.events)) return session.events;
  } catch { /* ignore */ }
  return [];
}

export function inspectTurn(events) {
  const end = lastTurnEnd(events);
  const reason = end?.data?.reason || null;
  return {
    seq: end?.seq || 0,
    turn: end?.data?.turn || 0,
    reason,
    abnormal: isAbnormalReason(reason),
    userAbort: isUserAbort(reason),
    auto: shouldAutoContinue(reason),
  };
}

export function hasFreshHumanTurn(events) {
  const list = Array.isArray(events) ? events : [];
  const end = lastTurnEnd(list);
  const after = end ? list.filter((event) => (event?.seq || 0) > end.seq) : list;
  return after.some((event) => {
    if (event?.type !== "user/message") return false;
    const kind = event.data?.source?.kind;
    return kind !== "plugin" && kind !== "dsh-purge";
  });
}

export function inboxBusy(agent) {
  try {
    const inbox = agent?.inbox;
    if (!inbox) return false;
    if (typeof inbox.hasPending === "function" && inbox.hasPending()) return true;
    if (typeof inbox.size === "number" && inbox.size > 0) return true;
    if (typeof inbox.length === "number" && inbox.length > 0) return true;
  } catch { /* ignore */ }
  return false;
}

export function sendContinue(agent, text) {
  if (!agent || typeof agent.followup !== "function") {
    return { ok: false, error: "No agent in this session to continue" };
  }
  try {
    agent.followup(makeContinueMessage(text));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

const activeRuntimes = new WeakMap();

export function installContinueRetry(ctx, options = {}) {
  const contextKey = ctx && (typeof ctx === "object" || typeof ctx === "function") ? ctx : null;
  if (contextKey) activeRuntimes.get(contextKey)?.dispose();

  const getConfig = typeof options.getConfig === "function" ? options.getConfig : () => normalizeConfig(options.config);
  const tracker = options.tracker || createTracker();
  const timers = new Map();
  const pendingErrors = new Set();
  const deadAgents = new WeakSet();
  let disposed = false;

  const boundaryTypes = new Set(["user/message", "turn/start", "turn/end"]);

  function isObjectLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function");
  }

  function sessionIdOf(agent) {
    return agent?.id || agent?.session?.id || "";
  }

  // Keep only lifecycle metadata while downstream request-error middleware awaits.
  function boundaryOf(agent) {
    const events = sessionEventsOf(agent);
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (boundaryTypes.has(event?.type) && Number.isSafeInteger(event?.seq)) return event.seq;
    }
    return 0;
  }

  function belongsToSession(agent, session) {
    return !!session && (agent?.session === session || (!!session.id && agent?.session?.id === session.id));
  }

  function invalidateErrors(matches) {
    for (const record of pendingErrors) {
      if (!matches(record)) continue;
      record.cancelled = true;
      pendingErrors.delete(record);
    }
  }

  function cancelPending(id, agent = null) {
    const pending = timers.get(id);
    if (!pending || (agent && pending.agent !== agent)) return;
    clearTimeout(pending.timer);
    timers.delete(id);
  }

  // A delayed callback belongs to the exact ending turn and Agent that scheduled it.
  function schedule(agent, id, info) {
    const existing = timers.get(id);
    if (existing?.agent === agent && existing.seq === info.seq && existing.turn === info.turn) return;
    cancelPending(id);
    const pending = { agent, seq: info.seq, turn: info.turn, boundary: boundaryOf(agent), timer: null };
    pending.timer = setTimeout(() => {
      if (disposed || timers.get(id) !== pending) return;
      timers.delete(id);
      if (deadAgents.has(agent) || boundaryOf(agent) !== pending.boundary) return;
      const current = inspectTurn(sessionEventsOf(agent));
      if (current.seq !== pending.seq || current.turn !== pending.turn) return;
      maybeAutoContinue(agent);
    }, 280);
    timers.set(id, pending);
  }

  function listen(event, handler) {
    if (typeof ctx?.on !== "function") return null;
    try {
      return ctx.on(event, handler, { global: true });
    } catch {
      try {
        return ctx.on(event, handler);
      } catch {
        return null;
      }
    }
  }

  function maybeAutoContinue(agent) {
    if (disposed || !isObjectLike(agent) || deadAgents.has(agent)) return;
    const cfg = getConfig();
    if (!cfg.autoContinue) return;
    const id = sessionIdOf(agent);
    if (!id) return;
    if (agent.status === "running" || inboxBusy(agent)) return;
    const events = sessionEventsOf(agent);
    if (hasFreshHumanTurn(events)) return;
    const info = inspectTurn(events);
    if (!info.auto) return;
    if (!tracker.takeContinue(id, info.seq, cfg.continueMax)) return;
    const sent = sendContinue(agent, cfg.continueText);
    if (!sent.ok) {
      tracker.refundContinue(id, info.seq);
      console.warn("[dsh-purge] auto-continue send failed (session=" + id + ", seq=" + info.seq + "):", sent.error);
    }
  }

  const offError = listen("agent/request-error", async (payload, next) => {
    const agent = payload?.agent, id = sessionIdOf(agent);
    const record = {
      agent,
      id,
      session: agent?.session,
      sessionId: agent?.session?.id ?? null,
      boundary: boundaryOf(agent),
      cancelled: false,
    };
    if (id && isObjectLike(agent) && !disposed && !deadAgents.has(agent)) pendingErrors.add(record);

    let downstream;
    try {
      downstream = typeof next === "function" ? await next() : undefined;
    } finally {
      pendingErrors.delete(record);
    }

    // Preserve every explicit host/provider decision before considering fallback.
    if (downstream != null || disposed || payload?.signal?.aborted) return downstream;
    if (!id || record.cancelled || (isObjectLike(agent) && deadAgents.has(agent))
      || agent?.session !== record.session
      || (agent?.session?.id ?? null) !== record.sessionId
      || boundaryOf(agent) !== record.boundary) return downstream;

    // Official rc.3 RequestErrorAction is authoritative, including a declined retry.
    if (payload?.retryPolicy != null) return downstream;
    // The legacy fallback has no backoff scheduler; never bypass provider Retry-After.
    if (Number.isFinite(payload?.failure?.providerRetryAfterMs) && payload.failure.providerRetryAfterMs > 0) return downstream;

    const cfg = getConfig();
    if (!cfg.autoRetry) return downstream;
    if (!shouldAutoRetry(payload?.failure, payload?.signal)) return downstream;
    const key = String(payload?.turn || 0) + ":" + String(payload?.step || 0) + ":" + String(payload?.failure?.code || "");
    if (!tracker.takeRetry(id, key, cfg.retryMax)) return downstream;
    return { kind: "retry" };
  });

  const offStatus = listen("agent/status", (payload) => {
    const agent = payload?.agent;
    if (disposed || !isObjectLike(agent) || deadAgents.has(agent)) return;
    const id = sessionIdOf(agent);
    if (!id) return;
    const events = sessionEventsOf(agent);

    if (payload.status !== "idle") {
      cancelPending(id, agent);
      if (payload.status === "running" && hasFreshHumanTurn(events)) tracker.reset(id);
      return;
    }

    const info = inspectTurn(events);
    tracker.resetIfCompleted(id, info.reason);
    if (!getConfig().autoContinue || !info.auto || hasFreshHumanTurn(events)) {
      cancelPending(id, agent);
      return;
    }
    schedule(agent, id, info);
  });

  const offSession = listen("session/event", (session, event) => {
    if (disposed || !boundaryTypes.has(event?.type)) return;
    const newer = boundary => !Number.isSafeInteger(event.seq) || event.seq > boundary;
    invalidateErrors(record => belongsToSession(record.agent, session) && newer(record.boundary));
    for (const [id, pending] of timers) {
      if (belongsToSession(pending.agent, session) && newer(pending.boundary)) cancelPending(id, pending.agent);
    }
  });

  const offCreated = listen("agent/created", ({ agent } = {}) => {
    if (disposed || !isObjectLike(agent)) return;
    const id = sessionIdOf(agent);
    if (!id) return;
    invalidateErrors(record => {
      if (record.id !== id || record.agent === agent) return false;
      if (isObjectLike(record.agent)) deadAgents.add(record.agent);
      return true;
    });
    const pending = timers.get(id);
    if (pending && pending.agent !== agent) {
      if (isObjectLike(pending.agent)) deadAgents.add(pending.agent);
      cancelPending(id, pending.agent);
    }
  });

  const offDisposed = listen("agent/disposed", ({ agent } = {}) => {
    if (disposed || !isObjectLike(agent)) return;
    deadAgents.add(agent);
    invalidateErrors(record => record.agent === agent);
    const id = sessionIdOf(agent);
    if (id) cancelPending(id, agent);
  });

  const runtime = {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pending of timers.values()) clearTimeout(pending.timer);
      timers.clear();
      pendingErrors.clear();
      for (const off of [offError, offStatus, offSession, offCreated, offDisposed]) {
        try { off?.(); } catch { /* ignore */ }
      }
      if (contextKey && activeRuntimes.get(contextKey) === runtime) activeRuntimes.delete(contextKey);
    },
  };
  if (contextKey) activeRuntimes.set(contextKey, runtime);
  return runtime;
}
