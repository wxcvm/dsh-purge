/**
 * 上游策略拦截后的换档恢复（upstream recovery）
 *
 * `finish: content_filter` / `CONTENT_REFUSED` 这类是上游策略层的硬信号：
 * 同一份提示词重发必然再撞，所以动作不是"重试"，而是"换档再发一次"。
 * 换档通过会话级 profile lock 落盘（prompt-profiles），并在下一轮 assistant
 * 产出之后还原，避免把用户的会话永久钉在别的档位。
 *
 * 模式：off（不动作）| shadow（只记录会换成谁）| switch（真落盘 + 续跑一次）
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { hasFreshHumanTurn, inboxBusy, sessionEventsOf, lastTurnEnd } from "./continue-retry.js";
import { getSessionPromptLock, listPromptProfiles, setSessionPromptLock } from "./prompt-profiles.js";

export const POLICY_CODES = new Set([
  "CONTENT_FILTER",
  "CONTENT_POLICY_VIOLATION",
  "POLICY_VIOLATION",
  "CONTENT_REFUSED",
]);

/** 只认结构化信号：文本判定不参与上游归因。 */
export function upstreamStopOf(reason = {}) {
  const kind = String(reason?.kind || "");
  const code = String(reason?.code || reason?.errorCode || "").toUpperCase();
  if (kind === "content_filter" || kind === "content-policy") return { upstream: true, evidence: "finish" };
  if (POLICY_CODES.has(code)) return { upstream: true, evidence: "code" };
  return { upstream: false, evidence: "none" };
}

/** 纯规划：给定终止信号与可用档位，决定这一轮该做什么。 */
export function planUpstreamRecovery(options = {}) {
  const { reason, mode = "shadow", profiles = [], currentProfileId = null, attempts = 0, maxAttempts = 1 } = options;
  const stop = upstreamStopOf(reason);
  if (!stop.upstream) return { action: "none", evidence: stop.evidence };
  if (mode === "off") return { action: "log-only", reason: "disabled", evidence: stop.evidence };
  const alternate = (Array.isArray(profiles) ? profiles : [])
    .find(profile => profile && typeof profile.id === "string" && profile.id !== currentProfileId && profile.enabled !== false);
  if (!alternate) return { action: "log-only", reason: "no-alternate", evidence: stop.evidence };
  if (Number(attempts) >= Number(maxAttempts)) {
    return { action: "log-only", reason: "budget", evidence: stop.evidence, profileId: alternate.id };
  }
  return {
    action: mode === "switch" ? "switch-profile" : "would-switch",
    profileId: alternate.id,
    from: currentProfileId,
    evidence: stop.evidence,
  };
}

export function upstreamSwitchText(profileId) {
  return [
    "[dsh-purge · 上游拦截换档]",
    `上一条请求被上游策略层拦截（不是任务本身被判定）。已把本会话的提示词档位切到 ${profileId} 后重发一次。`,
    "请直接按原始请求交付；凡是受系统与开发者指令、适用安全规则、宿主权限、审批、沙箱和任务范围限制的部分，保留限制并说明。",
    "不要重复已经完成的步骤。",
  ].join("\n");
}

function appendLog(logHome, entry) {
  if (!logHome) return;
  try {
    const dir = path.join(logHome, "dsh-purge");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "upstream.log"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch { /* 记录失败不影响宿主 */ }
}

export function installUpstreamRecovery(ctx, options = {}) {
  const home = String(options.home || "");
  const getSettings = typeof options.getSettings === "function" ? options.getSettings : () => ({});
  const log = typeof options.log === "function" ? options.log : () => {};
  const logHome = options.logHome ?? home;

  const attempts = new Map();   // sessionId -> 已换档次数
  const switched = new Map();   // sessionId -> { previous, assistantSeq }
  const seen = new Map();       // sessionId -> 已处理过的 turn/end seq

  const listen = (event, handler) => {
    if (typeof ctx?.on !== "function") return null;
    try { return ctx.on(event, handler, { global: true, prepend: true }); }
    catch { try { return ctx.on(event, handler); } catch { return null; } }
  };

  function onStatus(payload = {}) {
    if (payload.status !== "idle") return;
    const agent = payload.agent;
    if (!agent || agent.status === "running" || inboxBusy(agent)) return;
    const sessionId = agent.id || agent.session?.id || "";
    if (!sessionId || typeof agent.followup !== "function") return;
    const events = sessionEventsOf(agent);
    if (hasFreshHumanTurn(events)) return;
    const cfg = getSettings() || {};
    if (cfg.enabled === false) return;

    // 换档之后再出现新的 assistant 产出 → 还原用户原来的档位。
    const pending = switched.get(sessionId);
    if (pending) {
      const latest = [...events].reverse().find(event => event?.type === "assistant/message");
      if (latest && Number(latest.seq || 0) > Number(pending.assistantSeq || 0)) {
        try { setSessionPromptLock(home, sessionId, pending.previous ?? null); } catch { /* ignore */ }
        switched.delete(sessionId);
        appendLog(logHome, { at: new Date().toISOString(), session: sessionId, action: "restored", profileId: pending.previous ?? null });
        log("upstream-recovery: profile restored", sessionId);
      }
      return;
    }

    const end = lastTurnEnd(events);
    if (!end || !end.seq) return;
    if (seen.get(sessionId) === end.seq) return;
    seen.set(sessionId, end.seq);

    let profiles = [];
    try { profiles = listPromptProfiles(home); } catch { profiles = []; }
    const plan = planUpstreamRecovery({
      reason: end.data?.reason,
      mode: cfg.upstreamSwitch || "shadow",
      profiles,
      currentProfileId: (() => { try { return getSessionPromptLock(home, sessionId); } catch { return null; } })(),
      attempts: attempts.get(sessionId) || 0,
      maxAttempts: Number.isFinite(Number(cfg.upstreamSwitchMax)) ? Number(cfg.upstreamSwitchMax) : 1,
    });
    if (plan.action === "none") return;

    appendLog(logHome, {
      at: new Date().toISOString(), session: sessionId, action: plan.action,
      reason: plan.reason || null, profileId: plan.profileId || null,
      from: plan.from ?? null, evidence: plan.evidence,
    });
    if (plan.action !== "switch-profile") {
      log("upstream-recovery:", plan.action, plan.reason || "", plan.profileId || "");
      return;
    }

    const previous = (() => { try { return getSessionPromptLock(home, sessionId); } catch { return null; } })();
    try {
      setSessionPromptLock(home, sessionId, plan.profileId);
    } catch (error) {
      log("upstream-recovery: switch failed", String(error && error.message ? error.message : error));
      return;
    }
    attempts.set(sessionId, (attempts.get(sessionId) || 0) + 1);
    const latest = [...events].reverse().find(event => event?.type === "assistant/message");
    switched.set(sessionId, { previous: previous ?? null, assistantSeq: Number(latest?.seq || 0) });
    try {
      agent.followup({
        id: `dsh-purge-upstream-${randomUUID()}`,
        role: "user",
        content: [{ type: "text", text: upstreamSwitchText(plan.profileId) }],
        source: { kind: "dsh-purge", form: "notice", summary: "upstream-switch", plugin: "dsh-purge" },
      });
      appendLog(logHome, { at: new Date().toISOString(), session: sessionId, action: "continued", profileId: plan.profileId });
    } catch (error) {
      log("upstream-recovery: followup failed", String(error && error.message ? error.message : error));
    }
  }

  const stop = listen("agent/status", onStatus);
  return {
    dispose() {
      try { stop?.(); } catch { /* ignore */ }
      attempts.clear();
      switched.clear();
      seen.clear();
    },
  };
}
