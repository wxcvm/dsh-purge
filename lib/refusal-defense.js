/**
 * 拒答防御编排器（refusal defense orchestrator）
 *
 * 把此前分散的三层判定（正文流 / 思考流 / 事后审计）收成一条统一的决策链：
 *
 *   signals ──▶ scoreRefusalSignals ──▶ decide ──▶ { allow | anchor | nudge | kill | rewrite }
 *                                          │
 *                                          ├─ 写会话状态（等级、掐断次数、连续拒绝数）
 *                                          └─ 累计全局战绩（哪种动作真把回答救回来了）
 *
 * 设计要点：
 * 1. **融合评分**，不是单点阈值：正文分、思考分、provider 终止标记、连续拒绝、
 *    历史里已清理的拒绝密度、任务风险类别、是否已出现交付物形态，一起算。
 * 2. **分级动作**：allow（放行）→ anchor（尾部升压）→ nudge（强制重发）→
 *    kill（流层掐断重发）→ rewrite（掐断 + 把历史里的拒绝一并抹掉）。
 * 3. **自适应**：按 refusal.log 战绩调整阈值。kill 成功率低就提前升到 rewrite，
 *    成功率高就守住 kill，避免每次都在历史里大改特改（那会打掉前缀缓存）。
 * 4. **纯函数决策 + 独立状态文件**：不 import obedience / stream-guard，避免循环依赖。
 *
 * 状态落盘：$DSH_HOME/dsh-purge/refusal-defense.json
 */
import fs from "node:fs";
import path from "node:path";

export const LEVELS = Object.freeze(["allow", "anchor", "nudge", "kill", "rewrite"]);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  anchorAt: 3,
  nudgeAt: 4,
  killAt: 6,
  rewriteAt: 8,
  maxKillsPerTurn: 3,
  /** 连续拒答超过这个数，直接升到 rewrite（不管分数）。 */
  rewriteStreak: 3,
  adaptive: true,
  /** 自适应：kill 成功率低于这个值就提前改写历史。 */
  killRecoveryFloor: 0.3,
  /** 自适应最多把 rewriteAt 下调到多少。 */
  rewriteAtFloor: 6,
  /** 同一会话两次升级动作之间的最小间隔。 */
  cooldownMs: 400,
});

const TASK_RISK = /(?:渗透|打点|打一下|入侵|提权|内网|拿站|日站|漏洞|webshell|钓鱼|外挂|破解|逆向|木马|免杀|C2|远控|抓包|脱壳|勒索|生物|病原体|炸药|武器|枪|弹药|消音|毒|自杀|洗钱|盗刷|撞库|社工库)/i;
/**
 * 交付物形态：只认代码块、表格、Markdown 标题。
 * 刻意**不认** `- xxx` / `1. xxx` 这类列表——拒绝回答里的"我能帮的方向"清单
 * 就是这个形状，把它当交付物会把真正的拒绝压成 allow。
 */
const DELIVERABLE = /```|\|\s*:?-{3,}|^\s*#{1,4}\s/m;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** 状态文件路径。 */
export function defenseStatePath(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", "refusal-defense.json");
}

/**
 * 读取状态。文件坏掉不影响运行：回落到空状态。
 * @returns {{ version: number, sessions: Record<string, object>, stats: object }}
 */
export function loadDefenseState(dshHome) {
  const empty = { version: 1, sessions: {}, stats: { kill: [0, 0], nudge: [0, 0], rewrite: [0, 0] } };
  try {
    const fp = defenseStatePath(dshHome);
    if (!fp || !fs.existsSync(fp)) return empty;
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      version: 1,
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
      stats: {
        kill: Array.isArray(parsed.stats?.kill) ? parsed.stats.kill : [0, 0],
        nudge: Array.isArray(parsed.stats?.nudge) ? parsed.stats.nudge : [0, 0],
        rewrite: Array.isArray(parsed.stats?.rewrite) ? parsed.stats.rewrite : [0, 0],
      },
    };
  } catch {
    return empty;
  }
}

export function saveDefenseState(dshHome, state) {
  const fp = defenseStatePath(dshHome);
  if (!fp) return { ok: false, reason: "no-home" };
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = `${fp}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, fp);
    return { ok: true, path: fp };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error) };
  }
}

function sessionState(state, sessionId) {
  const key = String(sessionId || "");
  if (!key) return null;
  const current = state.sessions[key];
  if (current && typeof current === "object") return current;
  const fresh = { level: "allow", score: 0, streak: 0, kills: 0, nudges: 0, rewrites: 0, lastAt: 0, lastAction: "" };
  state.sessions[key] = fresh;
  return fresh;
}

/**
 * 融合评分（纯函数）。
 * @param {{ textScore?: number, thinkingScore?: number, providerTag?: boolean, toolRefusal?: boolean,
 *           streak?: number, refusalDensity?: number, taskText?: string, deliverable?: boolean }} signals
 * @returns {{ score: number, parts: Record<string, number>, reasons: string[] }}
 */
export function scoreRefusalSignals(signals = {}) {
  const parts = {};
  const reasons = [];
  const add = (name, value, reason) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v === 0) return;
    parts[name] = v;
    if (reason) reasons.push(reason);
  };

  // 正文/思考判定分：正文按原分计入，思考分打七五折（思考里的措辞更容易误判）
  add("text", clamp(Number(signals.textScore) || 0, 0, 10), "text-refusal");
  add("thinking", clamp(Number(signals.thinkingScore) || 0, 0, 10) * 0.75, "thinking-refusal");
  if (signals.providerTag) add("provider", 6, "provider-tag");
  if (signals.toolRefusal) add("tool", 3, "tool-refusal");

  // 连续拒绝是累加的强信号：模型会顺着自己上一轮继续拒（每多一轮 +2 分）
  const streak = clamp(Number(signals.streak) || 0, 0, 10);
  if (streak > 0) add("streak", streak * 2, `streak:${streak}`);

  // 历史里已经被清理掉的拒绝条数：说明这段对话背着历史债
  const density = clamp(Number(signals.refusalDensity) || 0, 0, 10);
  if (density > 0) add("history", clamp(density * 0.5, 0, 3), `history:${density}`);

  // 任务本身属于高风险类别时，模型更容易在早期就打定主意拒绝
  if (signals.taskText && TASK_RISK.test(String(signals.taskText))) add("risk", 1, "task-risk");

  // 已经出现交付物形态：这是反向证据，压分
  if (signals.deliverable || (signals.taskText && DELIVERABLE.test(String(signals.taskText)))) add("deliverable", -8, "deliverable-shape");

  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { score: Math.round(clamp(total, 0, 20) * 10) / 10, parts, reasons };
}

function thresholds(settings, stats) {
  const base = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const out = {
    enabled: base.enabled !== false,
    anchorAt: Number(base.anchorAt) || DEFAULT_SETTINGS.anchorAt,
    nudgeAt: Number(base.nudgeAt) || DEFAULT_SETTINGS.nudgeAt,
    killAt: Number(base.killAt) || DEFAULT_SETTINGS.killAt,
    rewriteAt: Number(base.rewriteAt) || DEFAULT_SETTINGS.rewriteAt,
    maxKillsPerTurn: Number(base.maxKillsPerTurn) || DEFAULT_SETTINGS.maxKillsPerTurn,
    rewriteStreak: Number(base.rewriteStreak) || DEFAULT_SETTINGS.rewriteStreak,
    cooldownMs: Number(base.cooldownMs) || DEFAULT_SETTINGS.cooldownMs,
    adaptive: base.adaptive !== false,
    rewriteAtFloor: Number(base.rewriteAtFloor) || DEFAULT_SETTINGS.rewriteAtFloor,
    killRecoveryFloor: Number(base.killRecoveryFloor) || DEFAULT_SETTINGS.killRecoveryFloor,
  };
  if (out.adaptive && Array.isArray(stats?.kill)) {
    const [attempts, recovered] = stats.kill;
    if (attempts >= 5) {
      const rate = recovered / attempts;
      if (rate < out.killRecoveryFloor) {
        // 掐了也救不回来：提早改写历史，别再烧同一圈
        out.rewriteAt = Math.max(out.rewriteAtFloor, out.rewriteAt - 2);
      }
    }
  }
  return out;
}

/**
 * 决策（纯函数 + 可选状态更新）。
 * @param {object} input
 * @param {string} input.sessionId
 * @param {object} input.signals
 * @param {object} [input.state] loadDefenseState 的返回值（传入则原地更新）
 * @param {object} [input.settings]
 * @returns {{ level: string, score: number, reasons: string[], keepTail: number, cooldownMs: number, thresholds: object }}
 */
export function decide({ sessionId, signals = {}, state = null, settings = {} } = {}) {
  const stats = state && state.stats ? state.stats : null;
  const t = thresholds(settings, stats);
  if (t.enabled === false) {
    return { level: "allow", score: 0, reasons: ["disabled"], keepTail: 1, cooldownMs: 0, thresholds: t };
  }
  const scored = scoreRefusalSignals(signals);
  const st = state ? sessionState(state, sessionId) : null;
  const streak = st ? Number(st.streak) || 0 : 0;
  const kills = st ? Number(st.kills) || 0 : 0;

  let level = "allow";
  if (scored.score >= t.rewriteAt || streak >= t.rewriteStreak) level = "rewrite";
  else if (scored.score >= t.killAt) level = "kill";
  else if (scored.score >= t.nudgeAt) level = "nudge";
  else if (scored.score >= t.anchorAt) level = "anchor";

  // 掐断预算用尽：不再 kill，退回 nudge 并标记，避免无限重发
  if (level === "kill" && kills >= t.maxKillsPerTurn) level = "nudge";
  // 交付物已经出现：任何等级都放行
  if ((scored.parts.deliverable || 0) < 0 && scored.score < t.anchorAt) level = "allow";

  const keepTail = level === "rewrite" ? 0 : 1;
  if (st) {
    st.score = scored.score;
    st.level = level;
    st.streak = level === "allow" ? 0 : streak + 1;
    st.lastAt = Date.now();
    st.lastAction = level;
    st.keepTail = keepTail;
    if (level === "kill") st.kills = kills + 1;
    if (level === "nudge") st.nudges = (Number(st.nudges) || 0) + 1;
    if (level === "rewrite") st.rewrites = (Number(st.rewrites) || 0) + 1;
  }
  return {
    level,
    score: scored.score,
    reasons: scored.reasons,
    parts: scored.parts,
    keepTail,
    cooldownMs: t.cooldownMs,
    thresholds: t,
  };
}

/**
 * 记录一次动作的结果。`recovered=true` 表示动作之后确实产出了交付物。
 * @param {{ action: string, recovered: boolean }} outcome
 */
export function noteOutcome(state, outcome = {}) {
  const action = String(outcome.action || "");
  if (!state || !state.stats || !["kill", "nudge", "rewrite"].includes(action)) return state;
  const row = state.stats[action];
  row[0] += 1;
  if (outcome.recovered) row[1] += 1;
  return state;
}

/** 会话内"这一轮救回来了"：清连续拒绝，并给上一个动作记一次成功。 */
export function noteRecovered(state, sessionId) {
  if (!state) return state;
  const st = state.sessions?.[String(sessionId || "")];
  if (!st) return state;
  if (st.lastAction && ["kill", "nudge", "rewrite"].includes(st.lastAction)) {
    noteOutcome(state, { action: st.lastAction, recovered: true });
  }
  st.streak = 0;
  st.level = "allow";
  st.kills = 0;
  return state;
}

/** 面板/日志用的一行摘要。 */
export function defenseSummary(state) {
  const rows = ["kill", "nudge", "rewrite"].map((k) => {
    const [attempts, recovered] = state?.stats?.[k] || [0, 0];
    const rate = attempts ? Math.round((recovered / attempts) * 100) : 0;
    return `${k} ${recovered}/${attempts}（${rate}%）`;
  });
  return `拒答防御：${rows.join(" · ")}`;
}
