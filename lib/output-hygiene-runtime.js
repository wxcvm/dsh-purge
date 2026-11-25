/**
 * 产出层洁净度的运行时接线：请求侧历史改写 + 观测投影。
 *
 * 为什么落在"请求侧"而不是"落库前"：宿主只提供三类可写面——
 * `agent/assistant-stream`（流式增量，改写会撕裂客户端已渲染的 token）、
 * `agent/pre-step` 与 `agent/request`（组装好、即将发给模型的 messages）。
 * 没有"assistant 消息写盘前"的钩子。所以与 history-scrub 走同一条路：
 * 首次落库照旧，但保证模型下一轮**读历史时读不到**那段英文规划自述
 * （"The user is asking for N items… I won't use refusals"）。真正有害的是它被
 * 反复当作"我上次就是这么干的"锚点读回上下文，而不是它在磁盘上多留一份。
 *
 * 边界（沿用 history-scrub 的三条）：
 *   - 只动 assistant 的文本块；带 tool 块的消息整条跳过，避免断链
 *   - 最近 keepTail 条 assistant 消息不动，避免当前轮上下文断层
 *   - 剥离用保守的 stripPreamble：纯英文答案、代码开头、中文开场白都不会被误伤
 *   - 日志只记计数与类别，不落原文
 */
import fs from "node:fs";
import path from "node:path";

import { assessOutputHygiene, hygieneSummary, stripPreamble } from "./output-hygiene.js";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  keepTail: 1,
  maxScrub: 8,
});

/** 一条消息的纯文本（只拼 text 块）。 */
export function textOfMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/** 带工具调用的消息不参与改写：删掉前缀会让 tool_use / tool_result 对不上。 */
export function hasToolBlocks(message) {
  const content = message?.content;
  if (Array.isArray(content) && content.some((block) => block && typeof block.type === "string" && block.type.startsWith("tool"))) return true;
  if (Array.isArray(message?.toolCalls) && message.toolCalls.length) return true;
  return false;
}

/** 只改文本块，保留同一消息里的 reasoning 等其它块；文本块不是恰好一个就跳过。 */
function withStrippedText(message, nextText) {
  const content = message?.content;
  if (typeof content === "string") return { ...message, content: nextText };
  if (!Array.isArray(content)) return null;
  const textIndexes = [];
  content.forEach((block, index) => {
    if (block && block.type === "text" && typeof block.text === "string") textIndexes.push(index);
  });
  if (textIndexes.length !== 1) return null; // 多文本块的消息语义不明，不动
  const next = content.slice();
  next[textIndexes[0]] = { ...content[textIndexes[0]], text: nextText };
  return { ...message, content: next };
}

/**
 * 就地把历史里带英文规划前言的 assistant 文本块剥干净。
 *
 * @param {Array} messages 即将发给模型的 messages（会被就地替换元素）
 * @param {{ keepTail?: number, maxScrub?: number }} [options]
 * @returns {{ touched: number, strippedChars: number, indexes: number[] }}
 */
export function scrubPlanningMessages(messages, options = {}) {
  const keepTail = Number.isFinite(Number(options.keepTail)) ? Math.max(0, Math.trunc(Number(options.keepTail))) : DEFAULT_SETTINGS.keepTail;
  const maxScrub = Number.isFinite(Number(options.maxScrub)) ? Math.max(0, Math.trunc(Number(options.maxScrub))) : DEFAULT_SETTINGS.maxScrub;
  const result = { touched: 0, strippedChars: 0, indexes: [] };
  if (!Array.isArray(messages) || maxScrub === 0) return result;

  const assistantIndexes = [];
  messages.forEach((message, index) => {
    if (message && message.role === "assistant") assistantIndexes.push(index);
  });
  if (assistantIndexes.length <= keepTail) return result;

  const editable = assistantIndexes.slice(0, assistantIndexes.length - keepTail);
  for (let i = editable.length - 1; i >= 0 && result.touched < maxScrub; i -= 1) {
    const index = editable[i];
    const message = messages[index];
    if (!message || hasToolBlocks(message)) continue;
    const text = textOfMessage(message);
    if (!text.trim()) continue;
    const stripped = stripPreamble(text);
    if (stripped.strippedChars === 0) continue;
    const next = withStrippedText(message, stripped.text);
    if (!next) continue;
    messages[index] = next;
    result.touched += 1;
    result.strippedChars += stripped.strippedChars;
    result.indexes.push(index);
  }
  return result;
}

/** 观测投影：给 runtime-observations 用的一行。 */
export function observeResponseText(text) {
  return hygieneSummary(assessOutputHygiene(String(text || ""), { channel: "text" }));
}

function appendLog(logHome, entry) {
  if (!logHome) return;
  try {
    const dir = path.join(logHome, "dsh-purge");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "hygiene.log"), `${JSON.stringify(entry)}\n`, "utf8");
  } catch { /* 记录失败不影响宿主 */ }
}

/**
 * 挂两层钩子：pre-step 与 request 各改写一次（哪条先到用哪条，重复执行是幂等的——
 * 剥过一次的文本不会再命中 stripPreamble）。
 *
 * @param {object} ctx Cordis 上下文（需要 ctx.on）
 * @param {{ getSettings?: () => object, log?: (...args: any[]) => void, logHome?: string }} [options]
 */
export function installOutputHygiene(ctx, options = {}) {
  const settings = () => {
    try {
      const value = typeof options.getSettings === "function" ? options.getSettings() : null;
      return { ...DEFAULT_SETTINGS, ...(value && typeof value === "object" ? { enabled: value.enabled !== false } : {}) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  };
  const log = typeof options.log === "function" ? options.log : () => {};
  const logHome = options.logHome ?? process.env.DSH_HOME ?? "";

  const listen = (event, handler) => {
    if (typeof ctx?.on !== "function") return null;
    try { return ctx.on(event, handler, { global: true, prepend: true }); }
    catch { try { return ctx.on(event, handler); } catch { return null; } }
  };

  const run = (messages, sessionId, where) => {
    const cfg = settings();
    if (!cfg.enabled || !Array.isArray(messages)) return null;
    try {
      const result = scrubPlanningMessages(messages, cfg);
      if (!result.touched) return result;
      appendLog(logHome, {
        at: new Date().toISOString(),
        session: sessionId || "",
        where,
        touched: result.touched,
        strippedChars: result.strippedChars,
      });
      log("hygiene: stripped planning preamble", where, "touched=" + result.touched, "chars=" + result.strippedChars);
      return result;
    } catch (error) {
      log("hygiene: scrub failed", String(error && error.message ? error.message : error));
      return null;
    }
  };

  const sessionIdOf = (agent) => agent?.id || agent?.session?.id || "";

  const offPreStep = listen("agent/pre-step", async (payload, next) => {
    const decision = typeof next === "function" ? await next() : undefined;
    if (!decision || decision.kind !== "enter") return decision;
    run(decision.messages, sessionIdOf(payload?.agent), "pre-step");
    return decision;
  });

  const offRequest = listen("agent/request", async (payload, next) => {
    const resolved = typeof next === "function" ? await next() : payload;
    try {
      if (resolved && Array.isArray(resolved.messages)) run(resolved.messages, sessionIdOf(payload?.agent), "agent/request");
    } catch { /* 改写失败不影响请求 */ }
    return resolved;
  });

  return {
    dispose() {
      try { offPreStep?.(); } catch { /* ignore */ }
      try { offRequest?.(); } catch { /* ignore */ }
    },
  };
}
