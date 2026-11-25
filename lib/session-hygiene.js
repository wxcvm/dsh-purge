/**
 * 会话文件层的产出洁净度改写（磁盘层）。
 *
 * 与请求侧接线的分工：
 *   - 请求侧（output-hygiene-runtime）：模型下一轮**读**历史时读不到泄漏前言
 *   - 本模块（磁盘层）：把已经写进 `session.v4.jsonl.zstd` 的那份也改成干净版，
 *     让界面回看、导出、以及将来重建上下文的路径都看不到它
 *
 * 文件格式是**多帧** zstd：每条事件追加一帧。改写只重编**被改动的那几帧**，
 * 其余帧按原始字节拷回——这样不会把整个文件压成一个大帧，也不动无关记录。
 * （scrub-session-refusals.mjs 的做法是全部解成一行行再压成单帧，这里不沿用。）
 *
 * 保守边界，和运行时那层一致：
 *   - 只动 assistant/message 的**文本块**；reasoning 原样保留
 *   - 带 tool 块的消息整条跳过，避免 tool_use / tool_result 对不上
 *   - 一条消息里文本块不是恰好一个就跳过（不猜它想表达什么）
 *   - 剥不动就原样返回（stripPreamble 自己的四道闸门先兜住误伤）
 *   - keepTail 从末尾保护最近 N 条 assistant 消息，默认 0（会话已结束时最后一条正是要改的那条）
 */
import zlib from "node:zlib";

import { detectPlanningLeak, stripPreamble } from "./output-hygiene.js";

export const SESSION_HYGIENE_VERSION = "session-hygiene-1";
export const ZSTD_MAGIC = Object.freeze([0x28, 0xb5, 0x2f, 0xfd]);

/** 思考块不可"摘前缀"——它整段就是自述，命中就换成这个中性标记。 */
export const REASONING_MARKER = "[该轮思考含框架自述，已按产出洁净度策略移除]";

export const DEFAULT_SETTINGS = Object.freeze({ keepTail: 0, maxRewrite: 200, reasoning: false });

function hasZstd() {
  return typeof zlib.zstdDecompressSync === "function" && typeof zlib.zstdCompressSync === "function";
}

/** 只按魔数找候选起点；能否解码由 resolveFrames 验证。 */
function magicStarts(buffer) {
  const starts = [];
  for (let i = 0; i + 4 <= buffer.length; i += 1) {
    if (buffer[i] === ZSTD_MAGIC[0] && buffer[i + 1] === ZSTD_MAGIC[1]
      && buffer[i + 2] === ZSTD_MAGIC[2] && buffer[i + 3] === ZSTD_MAGIC[3]) starts.push(i);
  }
  return starts;
}

/**
 * 把缓冲区切成帧。压缩数据里可能偶然出现魔数，所以逐段试解：
 * 解不开就把边界往后并一帧，直到解得开为止。
 *
 * @param {Buffer} buffer
 * @returns {{ start: number, end: number, text: string|null }[]}
 */
export function resolveFrames(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return [];
  if (!hasZstd()) throw new Error("当前 Node 不支持 zstd（需要 Node 23+）");
  const starts = magicStarts(buffer);
  if (!starts.length) return [{ start: 0, end: buffer.length, text: null }];

  const frames = [];
  let i = 0;
  while (i < starts.length) {
    let j = i;
    let text = null;
    while (j < starts.length) {
      const end = j + 1 < starts.length ? starts[j + 1] : buffer.length;
      try {
        text = zlib.zstdDecompressSync(buffer.subarray(starts[i], end)).toString("utf8");
        break;
      } catch {
        j += 1;
      }
    }
    if (text === null) {
      frames.push({ start: starts[i], end: buffer.length, text: null });
      break;
    }
    frames.push({ start: starts[i], end: j + 1 < starts.length ? starts[j + 1] : buffer.length, text });
    i = j + 1;
  }
  return frames;
}

function textOfMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

function hasToolBlocks(message) {
  const content = message?.content;
  if (Array.isArray(content) && content.some((b) => b && typeof b.type === "string" && b.type.startsWith("tool"))) return true;
  if (Array.isArray(message?.toolCalls) && message.toolCalls.length) return true;
  return false;
}

/** 只换文本块，保留 reasoning 等其它块；文本块不是恰好一个就返回 null。 */
function withStrippedText(message, nextText) {
  const content = message?.content;
  if (typeof content === "string") return { ...message, content: nextText };
  if (!Array.isArray(content)) return null;
  const textIndexes = [];
  content.forEach((block, index) => {
    if (block && block.type === "text" && typeof block.text === "string") textIndexes.push(index);
  });
  if (textIndexes.length !== 1) return null;
  const next = content.slice();
  const at = textIndexes[0];
  next[at] = { ...content[at], text: nextText };
  return { ...message, content: next };
}

/**
 * 把命中规划泄漏的 reasoning 块换成中性标记。
 * 返回 null 表示没有可换的块。
 */
function withNeutralReasoning(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  let count = 0;
  let removed = 0;
  const next = content.map((block) => {
    if (!block || block.type !== "reasoning" || typeof block.text !== "string") return block;
    if (!detectPlanningLeak(block.text).detected) return block;
    count += 1;
    removed += block.text.length;
    return { ...block, text: REASONING_MARKER };
  });
  if (!count) return null;
  return { message: { ...message, content: next }, count, removed };
}

/**
 * 扫描（并按需构造）改写计划。
 * @param {Buffer} buffer
 * @param {{ keepTail?: number, maxRewrite?: number, reasoning?: boolean }} [options]
 */
export function analyzeSessionBuffer(buffer, options = {}) {
  const keepTail = Number.isFinite(Number(options.keepTail)) ? Math.max(0, Math.trunc(Number(options.keepTail))) : DEFAULT_SETTINGS.keepTail;
  const maxRewrite = Number.isFinite(Number(options.maxRewrite)) ? Math.max(0, Math.trunc(Number(options.maxRewrite))) : DEFAULT_SETTINGS.maxRewrite;
  const wantReasoning = options.reasoning === true;
  const frames = resolveFrames(buffer);
  const stats = {
    version: SESSION_HYGIENE_VERSION,
    bytes: Buffer.isBuffer(buffer) ? buffer.length : 0,
    frames: frames.length,
    undecodable: frames.filter((frame) => frame.text === null).length,
    events: 0,
    assistants: 0,
    changed: 0,
    strippedChars: 0,
    reasoningChanged: 0,
    reasoningChars: 0,
    skippedTool: 0,
    skippedMultiText: 0,
  };
  const editions = new Map(); // frameIndex -> lines[]
  if (!frames.length) return { frames, editions, stats };

  // 先数 assistant 序号，用来算 keepTail 保护区。
  const assistantSeqs = [];
  frames.forEach((frame, frameIndex) => {
    if (frame.text === null) return;
    frame.text.split("\n").forEach((line, lineIndex) => {
      if (!line.trim()) return;
      let event = null;
      try { event = JSON.parse(line); } catch { return; }
      if (event?.type !== "assistant/message") return;
      assistantSeqs.push({ frameIndex, lineIndex });
    });
  });
  const protectedFrom = Math.max(0, assistantSeqs.length - keepTail);
  const protectedSet = new Set(assistantSeqs.slice(protectedFrom).map((entry) => `${entry.frameIndex}:${entry.lineIndex}`));

  frames.forEach((frame, frameIndex) => {
    if (frame.text === null) return;
    const lines = frame.text.split("\n");
    let dirty = false;
    lines.forEach((line, lineIndex) => {
      if (!line.trim()) return;
      let event = null;
      try { event = JSON.parse(line); } catch { return; }
      if (event?.type !== "assistant/message") {
        if (event?.type === "user/message") stats.events += 1;
        return;
      }
      stats.assistants += 1;
      if (protectedSet.has(`${frameIndex}:${lineIndex}`)) return;
      if (stats.changed >= maxRewrite) return;
      const message = event?.data?.message;
      if (!message) return;
      if (hasToolBlocks(message)) { stats.skippedTool += 1; return; }
      let current = message;
      let touched = false;

      const body = textOfMessage(current);
      if (body.trim()) {
        const stripped = stripPreamble(body);
        if (stripped.strippedChars > 0) {
          const nextMessage = withStrippedText(current, stripped.text);
          if (nextMessage) {
            current = nextMessage;
            touched = true;
            stats.strippedChars += stripped.strippedChars;
          } else {
            stats.skippedMultiText += 1;
          }
        }
      }

      if (wantReasoning) {
        const neutral = withNeutralReasoning(current);
        if (neutral) {
          current = neutral.message;
          touched = true;
          stats.reasoningChanged += neutral.count;
          stats.reasoningChars += neutral.removed;
        }
      }

      if (!touched) return;
      lines[lineIndex] = JSON.stringify({ ...event, data: { ...event.data, message: current } });
      stats.changed += 1;
      dirty = true;
    });
    if (dirty) editions.set(frameIndex, lines);
  });
  return { frames, editions, stats };
}

/**
 * 生成改写后的缓冲区。只有被改动的帧重新压缩，其余帧按原字节拷回。
 * @param {Buffer} buffer
 * @param {{ keepTail?: number, maxRewrite?: number }} [options]
 * @returns {{ buffer: Buffer, stats: object, backup: Buffer }}
 */
export function rewriteSessionBuffer(buffer, options = {}) {
  const { frames, editions, stats } = analyzeSessionBuffer(buffer, options);
  if (!editions.size) return { buffer: Buffer.from(buffer), stats, backup: Buffer.from(buffer) };

  const chunks = [];
  frames.forEach((frame, frameIndex) => {
    const lines = editions.get(frameIndex);
    if (!lines) {
      chunks.push(buffer.subarray(frame.start, frame.end));
      return;
    }
    chunks.push(zlib.zstdCompressSync(Buffer.from(lines.join("\n"), "utf8")));
  });
  const output = Buffer.concat(chunks);
  return { buffer: output, stats: { ...stats, rewrittenFrames: editions.size, bytesAfter: output.length }, backup: Buffer.from(buffer) };
}
