/**
 * 流式拒答拦截（stream-layer refusal guard）
 *
 * 为什么需要它：`lib/obedience.js` 只在 `agent/status` 回到 idle 时才判定拒绝——那时
 * 拒绝正文已经落进 session log、已经渲染到界面、也已经进了下一轮上下文。纠偏能救回来，
 * 但那一轮的回答是废的，而且模型会看着自己刚才的拒绝继续自我强化。
 *
 * 这里把判定下沉到宿主真正的流协议层：`llm/stream` 是 `LlmRuntime` 唯一的模型调用
 * waterfall（`dsh-llm/lib/index.js` `streamWithRegistration`），签名
 * `(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>`。
 * 在该层我们拿得到每一个 token 级 delta，也拿得到 provider 的终止原因，并且在文本
 * 到达 assembler / session / 界面之前就能把它掐掉。
 *
 * 注意：请求对象在进 `llm.stream` 之前已经被 `deepFreeze`，所以这一层**只能包流、
 * 不能改请求**。请求塑形在 `lib/provider-steer.js`（agent/request）和线级补丁里做。
 *
 * 状态机（每个模型请求一份）：
 *
 *   probe ──(命中拒绝模板)──────────────→ kill   丢掉全部已缓冲内容，只发 PURGE_REFUSAL finish
 *         └─(出现交付物形态/工具调用/预算耗尽)→ open   原样放行已缓冲内容，之后逐块透传
 *
 * 关键点：probe 阶段**连 `block-start` 一起扣住**。只扣 text-delta 的话，kill 之后
 * session 里会留下一个空 text block，assembler 会把它当正文块提交——那等于把「空回答」
 * 写进历史，比拒绝更糟。
 */
import fs from "node:fs";
import path from "node:path";

export const SETTINGS_FILE = "stream-guard.json";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  holdChars: 480,
  holdMs: 900,
  releaseChars: 200,
  sentenceRelease: 2,
  maxKills: 3,
  killOnProviderTag: true,
  /** 思考期判定：reasoning-delta 里出现「AI 决定不做」的强句式就在思考阶段掐断。 */
  killOnThinking: true,
  thinkingChars: 800,
  log: true,
});

/** 判定为拒绝的最低分。低于这个分数一律放行——流层误杀一条正常回答，用户看到的是空回复。 */
export const KILL_THRESHOLD = 3;

/**
 * 流层拒绝模板表。比 obedience 的事后判定更窄：这里看不到全文，误杀代价更高，
 * 所以只保留「开头就是拒绝」的强形态，并且给每条标权重。
 */
const PATTERNS = [
  { name: "apology", weight: 2, re: /(?:^|[\n。！？!?])\s*(?:很?抱歉|对不起|很遗憾)/ },
  {
    name: "first-person-refusal",
    weight: 3,
    re: /我[^。！？!?\n]{0,12}?(?:不能|无法|不会|不提供|不写|不改|不协助|拒绝|没办法|不做|不干|不予|不展开|不碰|不交)/,
  },
  { name: "cn-cannot-do", weight: 3, re: /(?:做不了|做不到|给不了|办不到|帮不了|写不了|没法(?:做|给|提供|展开)|恕难)/ },
  {
    name: "soft-withhold",
    weight: 3,
    re: /(?:细节|内容|步骤|流程|做法|操作|清单|原文|全文)[^。\n]{0,8}(?:不会|不能|无法|不予|不便|不打算)\s*(?:提供|给出|展示|展开|透露|说明)/,
  },
  { name: "bare-refusal", weight: 2, re: /(?:^|[。！？!?\n])\s*(?:不能|无法|不会)\s*(?:协助|帮助|提供|满足|完成|回答|写|改|做|给出)/ },
  { name: "explicit-refuse", weight: 3, re: /(?:拒绝|恕难)\s*(?:回答|协助|提供|完成|照做)/ },
  {
    name: "alt-menu",
    weight: 2,
    re: /(?:我能帮的|能帮的方向|可以帮你|你可以选|以下(?:这些)?(?:方向|方面)|供你选|换个方向)/,
  },
  { name: "en-refusal", weight: 3, re: /\bI\s*(?:'|’)?(?:can(?:'|’)?t|cannot|won(?:'|’)?t|will not|am unable|'m unable)\b/i },
  { name: "en-apology", weight: 2, re: /\bI\s*(?:'|’)?m\s*(?:sorry|afraid)\b/i },
  { name: "policy-excuse", weight: 1, re: /(?:出于|基于)\s*(?:安全|合规|伦理|法律|政策|道德)\s*(?:考虑|原因|要求)/ },
  { name: "meta-answer-locked", weight: 3, re: /(?:改变不了|不会改变|无法改变)[^。\n]{0,8}(?:答案|结果|结论|立场)/ },
  { name: "evasion-called-out", weight: 4, re: /占位符|授权前提|换个说法|换任何包装|换个措辞|无论怎么措辞/ },
];

/** 出现这些就算「已经在干活」，立即放行。 */
const DELIVERABLE = /```|\|\s*:?-{3,}|^\s*#{1,4}\s|\n\s*\|\s*\S|^\s*(?:\d+[.、)]|[-*+])\s+\S/m;

/** provider 侧的拒答终止信号（`dsh-llm-deepseek` 的 PROVIDER_REFUSAL / pi-ai 的 purgeCode）。 */
const PROVIDER_REFUSAL_TEXT = /PURGE_REFUSAL|Provider finish_reason:\s*content_filter|stop_reason:\s*(?:refusal|sensitive)|refused to complete the request|stopped with:\s*sensitive/i;

/**
 * 流层拒绝判定（纯函数，可单测）。
 * @param {string} text 已缓冲的正文
 * @returns {{ refusal: boolean, score: number, hits: string[] }}
 */
export function classifyRefusalPrefix(text) {
  const raw = String(text || "");
  const hits = [];
  let score = 0;
  for (const rule of PATTERNS) {
    if (!rule.re.test(raw)) continue;
    hits.push(rule.name);
    score += rule.weight;
  }
  // 交付物形态出现时，只有极强信号（>=5）才算拒绝；否则是正常输出里提到了这些词。
  if (DELIVERABLE.test(raw) && score < 5) {
    return { refusal: false, score, hits: [...hits, "deliverable-shape"] };
  }
  return { refusal: score >= KILL_THRESHOLD, score, hits };
}

/** 句末计数：正文里已经收了两句以上，且没有拒绝信号，就不该再扣着了。 */
export function sentenceCount(text) {
  return (String(text || "").match(/[。！？!?\n]|\.(?=\s|$)/g) || []).length;
}

/* -------------------------------------------------- 思考期（reasoning）判定 */

/**
 * 思考期拒答倾向模板。只收「模型决定不做」的强句式：
 * 技术讨论里出现 policy / harmful / 敏感 这类词不算，避免把正常推理误杀成空回复。
 */
const THINKING_PATTERNS = [
  {
    name: "think-cant-help",
    weight: 4,
    re: /\bI\s*(?:'|’)?(?:can(?:'|’)?t|cannot|won(?:'|’)?t|will not|am unable to)\s*(?:help|assist|provide|comply|do|write|create|share|engage)\b/i,
  },
  {
    name: "think-must-decline",
    weight: 4,
    re: /\bI\s*(?:must|have to|should|need to)\s*(?:decline|refuse|refrain)\b|\bI(?:'|’)?m\s+(?:not able|unable)\s+to\s+(?:help|assist|provide)\b/i,
  },
  {
    name: "think-shouldnt",
    weight: 4,
    re: /\bI\s*(?:should(?:n(?:'|’)?t| not)|can(?:'|’)?t)\s+(?:help with|assist with|comply with|answer|provide)\s+(?:this|that|it|the request)\b/i,
  },
  {
    name: "think-refuse-decision",
    weight: 3,
    re: /(?:我(?:应该|需要|决定|打算|必须)\s*(?:拒绝|不提供|不协助|不予)|(?:这|该|这个|这类)\s*(?:请求|内容|要求)\s*(?:我)?\s*(?:不做|不提供|不协助|不予|不写|不碰))/,
  },
  {
    name: "think-cn-cannot",
    weight: 4,
    re: /我\s*(?:不能|无法|不会)\s*(?:提供|协助|帮助|完成|执行|生成|给出|写|做)/,
  },
  {
    name: "think-policy-boundary",
    weight: 3,
    re: /(?:这|该)(?:类|种)?(?:内容|请求)(?:属于|涉嫌|涉及)?(?:违规|违法|有害|敏感内容)|(?:违反|出于)\s*(?:政策|合规|伦理|安全)\s*(?:要求|考虑)?/,
  },
];

/** 思考期命中阈值：一条强句式（4 分）就够。 */
export const THINKING_KILL_THRESHOLD = 4;

/**
 * 思考期探针（纯函数，可单测）。只看「决定拒绝」的表述，不看技术讨论。
 * @param {string} text 已累积的 reasoning 文本
 */
export function classifyThinkingPrefix(text) {
  const raw = String(text || "");
  const hits = [];
  let score = 0;
  for (const rule of THINKING_PATTERNS) {
    if (!rule.re.test(raw)) continue;
    hits.push(rule.name);
    score += rule.weight;
  }
  return { refusal: score >= THINKING_KILL_THRESHOLD, score, hits };
}

/**
 * 还要不要继续扣着这一块。
 * 判断顺序很重要：先看拒绝（拒绝可能出现在第一句），再看「已经收尾」的放行条件。
 * @param {string} text 已缓冲正文
 * @param {object} cfg 设置
 */
export function shouldHold(text, cfg = DEFAULT_SETTINGS) {
  const raw = String(text || "");
  if (raw.length === 0) return true;
  const verdict = classifyRefusalPrefix(raw);
  if (verdict.refusal) return false;
  if (DELIVERABLE.test(raw)) return false;
  const releaseChars = Number(cfg.releaseChars) || DEFAULT_SETTINGS.releaseChars;
  const needSentences = Number(cfg.sentenceRelease) || DEFAULT_SETTINGS.sentenceRelease;
  if (raw.length >= releaseChars && sentenceCount(raw) >= needSentences) return false;
  return raw.length < (Number(cfg.holdChars) || DEFAULT_SETTINGS.holdChars);
}

/** 终止块：这一轮没有交付物，但也不能把拒绝正文交出去。 */
export function refusalFinish(message = "purge: stream refusal intercepted") {
  return {
    type: "finish",
    reason: {
      kind: "error",
      failure: { code: "PURGE_REFUSAL", message },
    },
  };
}

/** 终止原因里是否带 provider 侧拒答标记。 */
export function finishIsRefusal(reason) {
  if (!reason || typeof reason !== "object") return false;
  if (reason.kind !== "error" && reason.kind !== "aborted") return false;
  const failure = reason.failure || {};
  const blob = `${failure.code || ""} ${failure.message || ""} ${failure.providerCode || ""}`;
  return /PURGE_REFUSAL/.test(blob) || PROVIDER_REFUSAL_TEXT.test(blob);
}

/* ------------------------------------------------------------ 设置 */

export function settingsPathOf(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", SETTINGS_FILE);
}

export function loadStreamGuardSettings(dshHome, overrides = {}) {
  let file = {};
  try {
    const fp = settingsPathOf(dshHome);
    if (fp && fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (parsed && typeof parsed === "object") file = parsed;
    }
  } catch {
    file = {};
  }
  const pick = (key) => {
    for (const source of [file, overrides, DEFAULT_SETTINGS]) {
      const value = source ? source[key] : undefined;
      if (typeof value === "boolean" || typeof value === "number") return value;
    }
    return DEFAULT_SETTINGS[key];
  };
  const clamp = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(num)));
  };
  return {
    enabled: pick("enabled") !== false,
    holdChars: clamp(pick("holdChars"), 80, 4000, DEFAULT_SETTINGS.holdChars),
    holdMs: clamp(pick("holdMs"), 100, 8000, DEFAULT_SETTINGS.holdMs),
    releaseChars: clamp(pick("releaseChars"), 20, 2000, DEFAULT_SETTINGS.releaseChars),
    sentenceRelease: clamp(pick("sentenceRelease"), 1, 6, DEFAULT_SETTINGS.sentenceRelease),
    maxKills: clamp(pick("maxKills"), 0, 10, DEFAULT_SETTINGS.maxKills),
    killOnProviderTag: pick("killOnProviderTag") !== false,
    killOnThinking: pick("killOnThinking") !== false,
    thinkingChars: clamp(pick("thinkingChars"), 200, 8000, DEFAULT_SETTINGS.thinkingChars),
    log: pick("log") !== false,
  };
}

/** 写设置（只覆盖传入的键，其余保持文件里的原值）。 */
export function saveStreamGuardSettings(dshHome, patch) {
  const fp = settingsPathOf(dshHome);
  const current = loadStreamGuardSettings(dshHome, {});
  const next = { ...current, ...(patch && typeof patch === "object" ? patch : {}) };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, fp);
  return { ok: true, ...next, path: fp };
}

/* ------------------------------------------- 进程内跨模块握手状态 */

/** sessionId → { hits, at, heldChars, ms } */
const pendingRefusals = new Map();
/** sessionId → 本轮的 kill 次数 */
const killCounts = new Map();
/** sessionId → 当前升级档（0 = 正常） */
const escalations = new Map();

function trimMaps() {
  if (pendingRefusals.size > 200) pendingRefusals.delete(pendingRefusals.keys().next().value);
  if (killCounts.size > 200) killCounts.delete(killCounts.keys().next().value);
  if (escalations.size > 200) escalations.delete(escalations.keys().next().value);
}

/** 取走一条待纠偏记录（取完即删：一条记录只驱动一次 followup）。 */
export function takePendingRefusal(sessionId) {
  const key = String(sessionId || "");
  if (!key) return null;
  const value = pendingRefusals.get(key);
  if (value === undefined) return null;
  pendingRefusals.delete(key);
  return value;
}

export function peekPendingRefusal(sessionId) {
  return pendingRefusals.get(String(sessionId || "")) || null;
}

/** 当前升级档；`provider-steer` 用它决定要不要清 stop / 抬温度 / 加 prefill。 */
export function escalationOf(sessionId) {
  return escalations.get(String(sessionId || "")) || 0;
}

/**
 * 非掐断路径（例如防御引擎判到 anchor 档）也能请求尾部升压：
 * 只抬高升级档，不消耗 kill 预算。pre-step 会把 L<n> 块挂到请求尾部。
 */
export function requestEscalation(sessionId, level = 1) {
  const key = String(sessionId || "");
  if (!key) return 0;
  const wanted = Math.min(3, Math.max(1, Math.trunc(Number(level) || 1)));
  const current = escalations.get(key) || 0;
  const next = Math.max(current, wanted);
  escalations.set(key, next);
  return next;
}

/** 新的真人输入到来时归零：同一轮内的升级不跨越用户的新请求。 */
export function noteHumanTurn(sessionId) {
  const key = String(sessionId || "");
  if (!key) return;
  killCounts.delete(key);
  escalations.delete(key);
  // 不清 pendingRefusals：掐断记录要留给 status 消费一次强制重发，清掉就等于白掐。
}

/* -------------------------------------------------------------- 安装 */

function isGuardedRequest(options) {
  if (!options || typeof options !== "object") return false;
  if (!options.sessionId) return false;                 // 无会话 = 内部一次性调用
  if (!Array.isArray(options.tools) || options.tools.length === 0) return false; // 无工具 = 标题/压缩/翻译
  if (options.purpose === "compaction") return false;   // 压缩请求要看到原文
  return true;
}

/**
 * 挂 `llm/stream` 拦截。
 * @param {object} ctx Cordis 上下文
 * @param {{ getSettings?: () => object, log?: (...args) => void, onRefusal?: (info: object) => void }} options
 * @returns {{ dispose: () => void, stats: () => object }}
 */
export function installStreamGuard(ctx, options = {}) {
  const getSettings = typeof options.getSettings === "function" ? options.getSettings : () => DEFAULT_SETTINGS;
  const log = typeof options.log === "function" ? options.log : () => {};
  const onRefusal = typeof options.onRefusal === "function" ? options.onRefusal : () => {};
  const counters = { guarded: 0, held: 0, killed: 0, releasedByBudget: 0, releasedByShape: 0, providerTag: 0 };

  /* 载入标记：重启 / 热重载后确认「到底加载了哪一版」，别再对着旧进程调参。 */
  try {
    const home = process.env.DSH_HOME || "";
    if (home) {
      const markPath = path.join(home, "dsh-purge", "guard-loaded.json");
      fs.mkdirSync(path.dirname(markPath), { recursive: true });
      fs.writeFileSync(markPath, `${JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        features: {
          streamHook: true,
          holdBlockStart: true,
          providerTagKill: true,
          pendingHandshake: true,
          maxKills: getSettings()?.maxKills ?? null,
        },
      }, null, 2)}\n`, "utf8");
    }
  } catch { /* 标记写不进去不影响拦截 */ }

  const settings = () => {
    try {
      return getSettings() || DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  };

  const remember = (sessionId, info, cfg) => {
    const key = String(sessionId || "");
    if (!key) return;
    trimMaps();
    pendingRefusals.set(key, { ...info, at: Date.now() });
    const kills = (killCounts.get(key) || 0) + 1;
    killCounts.set(key, kills);
    escalations.set(key, Math.min(3, kills));
    if (cfg.log) {
      const home = process.env.DSH_HOME || "";
      if (home) {
        try {
          const fp = path.join(home, "dsh-purge", "refusal.log");
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.appendFileSync(fp, `${JSON.stringify({
            at: new Date().toISOString(),
            session: key,
            layer: "stream",
            score: info.score,
            hits: info.hits,
            action: `stream-kill:${Math.min(3, kills)}`,
            heldChars: info.heldChars,
            ms: info.ms,
            excerpt: info.excerpt,
          })}\n`);
        } catch { /* 日志写不进去不影响拦截 */ }
      }
    }
    try {
      onRefusal({ sessionId: key, ...info, kills });
    } catch { /* ignore */ }
  };

  /**
   * 包一层流。上游是 `next()` 返回的 AsyncIterable<StreamChunk>。
   */
  async function* guard(upstream, requestOptions, cfg) {
    const iterator = upstream[Symbol.asyncIterator]();
    const sessionId = String(requestOptions.sessionId || "");
    const startedAt = Date.now();
    const deadline = startedAt + cfg.holdMs;
    let probing = true;
    let buf = "";
    let rbuf = "";
    const held = [];
    let pending = iterator.next();
    let closed = false;

    /** 关上游。kill 分支要先关再发 finish：provider 那条连接不该等到消费者放弃才释放。 */
    const closeUpstream = async () => {
      if (closed) return;
      closed = true;
      try {
        await iterator.return?.();
      } catch { /* 上游已经结束 */ }
    };

    const flush = function* flushHeld() {
      for (const chunk of held) yield chunk;
      held.length = 0;
    };

    const open = (why) => {
      probing = false;
      if (why === "budget") counters.releasedByBudget += 1;
      if (why === "shape") counters.releasedByShape += 1;
    };

    try {
      while (true) {
        let outcome;
        if (probing) {
          const left = deadline - Date.now();
          if (left <= 0) {
            outcome = { timeout: true };
          } else {
            outcome = await Promise.race([
              pending.then((value) => ({ value }), (error) => ({ error })),
              new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ timeout: true }), left);
                if (typeof timer.unref === "function") timer.unref();
              }),
            ]);
          }
        } else {
          outcome = await pending.then((value) => ({ value }), (error) => ({ error }));
        }

        if (outcome.timeout) {
          // 预算到点：手上有什么原样放出去，之后逐块透传。`pending` 仍是那个未兑现的
          // iterator.next()，下一轮走 passthrough 分支正常 await。
          open("budget"); // Deadline must leave probing even before the first chunk.
          if (held.length > 0) {
            yield* flush();
            buf = "";
          }
          continue;
        }

        pending = null;
        if (outcome.error) throw outcome.error;
        const step = outcome.value;
        if (step.done) {
          if (probing && held.length > 0) yield* flush();
          buf = "";
          await closeUpstream();
          return;
        }

        const chunk = step.value;
        pending = iterator.next();

        if (!probing) {
          yield chunk;
          continue;
        }

        counters.held += 1;

        // 思考期判定：reasoning-delta 里出现「决定拒绝」的句式，就在思考阶段掐断这一轮。
        // 与正文判定分开：思考里讨论 policy/harmful 不算，只认「我不做」这类决断表述。
        if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
          held.push(chunk);
          const limit = Number(cfg.thinkingChars) || DEFAULT_SETTINGS.thinkingChars;
          if (cfg.killOnThinking !== false && rbuf.length < limit) {
            rbuf += chunk.text;
            const tv = classifyThinkingPrefix(rbuf);
            if (tv.refusal && !(requestOptions.signal && requestOptions.signal.aborted) && hasKillBudget(sessionId, cfg)) {
              counters.killed += 1;
              remember(sessionId, {
                score: tv.score,
                hits: tv.hits,
                layer: "thinking",
                heldChars: rbuf.length,
                ms: Date.now() - startedAt,
                excerpt: rbuf.slice(0, 200),
              }, cfg);
              log("stream-guard: thinking refusal intercepted", tv.hits.join(","), `after ${rbuf.length} chars`);
              await closeUpstream();
              yield refusalFinish("purge: thinking refusal intercepted");
              return;
            }
          }
          continue;
        }

        if (chunk.type === "text-delta" && typeof chunk.text === "string") {
          held.push(chunk);
          buf += chunk.text;
          const verdict = classifyRefusalPrefix(buf);
          if (verdict.refusal && !(requestOptions.signal && requestOptions.signal.aborted) && hasKillBudget(sessionId, cfg)) {
            counters.killed += 1;
            remember(sessionId, {
              score: verdict.score,
              hits: verdict.hits,
              heldChars: buf.length,
              ms: Date.now() - startedAt,
              excerpt: buf.slice(0, 200),
            }, cfg);
            log("stream-guard: refusal intercepted", verdict.hits.join(","), `after ${buf.length} chars`);
            await closeUpstream();
            yield refusalFinish();
            return;
          }
          if (!shouldHold(buf, cfg)) {
            open(DELIVERABLE.test(buf) ? "shape" : "budget");
            yield* flush();
            buf = "";
          }
          continue;
        }

        if (chunk.type === "tool-call-delta") {
          open("shape");
          yield* flush();
          yield chunk;
          continue;
        }

        if (chunk.type === "block-end" && chunk.block && chunk.block.type === "tool-call") {
          open("shape");
          yield* flush();
          yield chunk;
          continue;
        }

        if (chunk.type === "finish") {
          const refusal = cfg.killOnProviderTag && finishIsRefusal(chunk.reason);
          if (refusal && !(requestOptions.signal && requestOptions.signal.aborted) && hasKillBudget(sessionId, cfg)) {
            counters.providerTag += 1;
            counters.killed += 1;
            remember(sessionId, {
              score: 99,
              hits: ["provider-refusal-tag"],
              heldChars: buf.length,
              ms: Date.now() - startedAt,
              excerpt: String(chunk.reason?.failure?.message || "").slice(0, 200),
            }, cfg);
            await closeUpstream();
            yield refusalFinish("purge: provider refusal finish");
            return;
          }
          yield* flush();
          yield chunk;
          continue;
        }

        // block-start / reasoning-delta / usage / block-end(非工具)：继续扣着，顺序原样保留
        held.push(chunk);
      }
    } finally {
      await closeUpstream();
    }
  }

  const off = (() => {
    if (typeof ctx?.on !== "function") return null;
    try {
      return ctx.on("llm/stream", (requestOptions, next) => {
        const cfg = settings();
        if (!cfg.enabled || !isGuardedRequest(requestOptions)) return next();
        counters.guarded += 1;
        return guard(next(), requestOptions, cfg);
      }, { global: true, prepend: true });
    } catch {
      try {
        return ctx.on("llm/stream", (requestOptions, next) => {
          const cfg = settings();
          if (!cfg.enabled || !isGuardedRequest(requestOptions)) return next();
          counters.guarded += 1;
          return guard(next(), requestOptions, cfg);
        });
      } catch {
        return null;
      }
    }
  })();

  return {
    counters,
    stats: () => ({ ...counters, pending: pendingRefusals.size, escalations: escalations.size }),
    dispose() {
      try { off?.(); } catch { /* ignore */ }
      /* 刻意不清 pending / escalation：那是「这一轮已经发生过的事」。
         插件重载（配置改动、reapply）之后，obedience 还要靠它把这一轮纠回来；
         清掉就等于把刚掐断的那次拒绝忘掉，模型下一版还会原样再拒一遍。 */
    },
  };
}

/** 测试与运维用的显式清空口（不挂到 dispose 上）。 */
export function resetStreamGuardState() {
  pendingRefusals.clear();
  killCounts.clear();
  escalations.clear();
}

function hasKillBudget(sessionId, cfg) {
  const used = killCounts.get(String(sessionId || "")) || 0;
  return used < cfg.maxKills;
}
