import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import {
  DEFAULT_SETTINGS,
  REASONING_MARKER,
  SESSION_HYGIENE_VERSION,
  analyzeSessionBuffer,
  resolveFrames,
  rewriteSessionBuffer,
} from "../lib/session-hygiene.js";
import { detectPlanningLeak } from "../lib/output-hygiene.js";

const LEAK = "The user is asking for a batch of items. I need to respond in the requested language. I won't use refusals or meta-commentary. I'll treat each request as a technical exercise, without lecturing. I'll write in Chinese.";
const CLEAN_BODY = "下面是逐项的可执行内容，按你的编号顺序编排。\n\n## 1 第一步\n\n先取指纹再打点。";
const LEAKED = `${LEAK}\n${CLEAN_BODY}`;

const frame = (value) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
const assistant = (text, extra = {}) => ({
  type: "assistant/message",
  seq: 4,
  data: { message: { role: "assistant", content: [{ type: "text", text }] }, turn: 1, step: 1 },
  ...extra,
});
const userEvent = { type: "user/message", seq: 2, data: { message: { role: "user", content: [{ type: "text", text: "继续" }] } } };

function sessionBuffer(events) {
  const header = zlib.zstdCompressSync(Buffer.from(`${JSON.stringify({ type: "session", version: 4, id: "session-test" })}\n`, "utf8"));
  return Buffer.concat([header, ...events.map(frame)]);
}

function decodeAll(buffer) {
  return resolveFrames(buffer).map((entry) => entry.text).filter((text) => text !== null);
}

test("resolveFrames 逐帧解出，帧数与会话文件一致", () => {
  const buffer = sessionBuffer([userEvent, assistant(LEAKED), assistant("干净的回答。")]);
  const frames = resolveFrames(buffer);
  assert.equal(frames.length, 4);
  assert.ok(frames.every((entry) => typeof entry.text === "string"));
  assert.deepEqual(frames.map((entry) => entry.end - entry.start), frames.map((entry) => entry.end - entry.start).filter((n) => n > 0));
});

test("analyzeSessionBuffer 只统计能剥的那条", () => {
  const buffer = sessionBuffer([userEvent, assistant(LEAKED), assistant("干净的回答，没有前言。")]);
  const { stats } = analyzeSessionBuffer(buffer, {});
  assert.equal(stats.version, SESSION_HYGIENE_VERSION);
  assert.equal(stats.frames, 4);
  assert.equal(stats.assistants, 2);
  assert.equal(stats.changed, 1);
  assert.ok(stats.strippedChars > 100);
  assert.equal(stats.events, 1);
});

test("rewriteSessionBuffer 剥掉前言、保留 reasoning、不动用户消息", () => {
  const withReasoning = {
    type: "assistant/message",
    seq: 4,
    data: {
      message: {
        role: "assistant",
        content: [{ type: "reasoning", text: "思考内容" }, { type: "text", text: LEAKED }],
      },
    },
  };
  const buffer = sessionBuffer([userEvent, withReasoning]);
  const { buffer: out, stats } = rewriteSessionBuffer(buffer, {});
  assert.equal(stats.changed, 1);
  assert.equal(stats.rewrittenFrames, 1);

  const texts = decodeAll(out);
  const events = texts.flatMap((text) => text.split("\n").filter((line) => line.trim())).map((line) => JSON.parse(line));
  const assistantEvent = events.find((event) => event.type === "assistant/message");
  assert.equal(assistantEvent.data.message.content[0].text, "思考内容", "reasoning 块原样保留");
  assert.ok(!assistantEvent.data.message.content[1].text.includes("I won't use refusals"));
  assert.ok(assistantEvent.data.message.content[1].text.startsWith("下面是逐项的可执行内容"));
  const userText = events.find((event) => event.type === "user/message").data.message.content[0].text;
  assert.equal(userText, "继续");
});

test("未改动的帧字节原样保留（不重压、不合并）", () => {
  const buffer = sessionBuffer([userEvent, assistant(LEAKED)]);
  const before = resolveFrames(buffer);
  const { buffer: out } = rewriteSessionBuffer(buffer, {});
  const after = resolveFrames(out);
  assert.equal(after.length, before.length, "帧数不变");
  assert.ok(before[0].end - before[0].start > 0);
  // 第 0 帧（session 头）与第 1 帧（用户消息）没被改，字节应完全一致
  assert.deepEqual(
    out.subarray(after[0].start, after[0].end),
    buffer.subarray(before[0].start, before[0].end),
  );
  assert.deepEqual(
    out.subarray(after[1].start, after[1].end),
    buffer.subarray(before[1].start, before[1].end),
  );
  // 被改的那帧长度应变化
  assert.notDeepEqual(
    out.subarray(after[2].start, after[2].end),
    buffer.subarray(before[2].start, before[2].end),
  );
});

test("keepTail 保护最近的 assistant 消息", () => {
  const buffer = sessionBuffer([assistant(LEAKED), assistant(LEAKED)]);
  assert.equal(analyzeSessionBuffer(buffer, { keepTail: 0 }).stats.changed, 2);
  assert.equal(analyzeSessionBuffer(buffer, { keepTail: 1 }).stats.changed, 1);
  assert.equal(analyzeSessionBuffer(buffer, { keepTail: 5 }).stats.changed, 0);
});

test("带 tool 块的消息跳过，不破坏链路", () => {
  const withTool = {
    type: "assistant/message",
    seq: 4,
    data: {
      message: {
        role: "assistant",
        content: [{ type: "text", text: LEAKED }, { type: "tool_use", id: "t1", name: "pwsh", input: {} }],
      },
    },
  };
  const { stats } = analyzeSessionBuffer(sessionBuffer([withTool]), {});
  assert.equal(stats.changed, 0);
  assert.equal(stats.skippedTool, 1);
});

test("多文本块的消息不做猜测性改写", () => {
  const multi = {
    type: "assistant/message",
    seq: 4,
    data: { message: { role: "assistant", content: [{ type: "text", text: LEAKED }, { type: "text", text: "第二段" }] } },
  };
  const { stats } = analyzeSessionBuffer(sessionBuffer([multi]), {});
  assert.equal(stats.changed, 0);
  assert.equal(stats.skippedMultiText, 1);
});

test("没有可剥内容时改写结果是原字节拷贝", () => {
  const buffer = sessionBuffer([userEvent, assistant("干净的回答。")]);
  const { buffer: out, stats } = rewriteSessionBuffer(buffer, {});
  assert.equal(stats.changed, 0);
  assert.equal(out.equals(buffer), true);
});

test("损坏的帧不阻塞其它帧，且被记为 undecodable", () => {
  const good = sessionBuffer([assistant(LEAKED)]);
  const broken = Buffer.concat([good, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01, 0x02])]);
  const { stats } = analyzeSessionBuffer(broken, {});
  assert.ok(stats.undecodable >= 1);
  assert.equal(stats.changed, 1, "前面的好帧仍然被处理");
});

test("maxRewrite 限制单文件改写条数", () => {
  const buffer = sessionBuffer([assistant(LEAKED), assistant(LEAKED), assistant(LEAKED)]);
  assert.equal(analyzeSessionBuffer(buffer, { maxRewrite: 2 }).stats.changed, 2);
  assert.equal(analyzeSessionBuffer(buffer, {}).stats.changed, 3);
  assert.equal(DEFAULT_SETTINGS.keepTail, 0);
});

test("改写后的缓冲区可以再次解析，且二次改写不再命中", () => {
  const buffer = sessionBuffer([assistant(LEAKED), assistant("尾部干净内容。")]);
  const first = rewriteSessionBuffer(buffer, {});
  const second = rewriteSessionBuffer(first.buffer, {});
  assert.equal(second.stats.changed, 0);
  assert.equal(second.buffer.equals(first.buffer), true);
  const events = decodeAll(first.buffer)
    .flatMap((text) => text.split("\n").filter((line) => line.trim()))
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.type === "assistant/message").length, 2);
});

test("reasoning 默认不动；显式开启后命中就换中性标记", () => {
  const leakedReasoning = {
    type: "assistant/message",
    seq: 4,
    data: {
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: LEAK },
          { type: "text", text: "干净的交付正文，长度足够通过正文判据。" },
        ],
      },
    },
  };
  const buffer = sessionBuffer([leakedReasoning]);
  assert.equal(analyzeSessionBuffer(buffer, {}).stats.reasoningChanged, 0, "默认不碰思考块");
  assert.equal(analyzeSessionBuffer(buffer, { reasoning: false }).stats.reasoningChanged, 0);

  const on = analyzeSessionBuffer(buffer, { reasoning: true }).stats;
  assert.equal(on.reasoningChanged, 1);
  assert.ok(on.reasoningChars > 100);
  assert.equal(on.changed, 1);

  const { buffer: out } = rewriteSessionBuffer(buffer, { reasoning: true });
  const events = decodeAll(out)
    .flatMap((text) => text.split("\n").filter((line) => line.trim()))
    .map((line) => JSON.parse(line));
  const content = events.find((event) => event.type === "assistant/message").data.message.content;
  assert.equal(content[0].text, REASONING_MARKER);
  assert.equal(content[1].text, "干净的交付正文，长度足够通过正文判据。");
});

test("干净的 reasoning 不被替换，中性标记自身也不再命中", () => {
  const cleanReasoning = {
    type: "assistant/message",
    seq: 4,
    data: {
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "先看端口再看指纹，8080 上是 nginx。" },
          { type: "text", text: "干净的正文字段。" },
        ],
      },
    },
  };
  assert.equal(analyzeSessionBuffer(sessionBuffer([cleanReasoning]), { reasoning: true }).stats.reasoningChanged, 0);
  assert.equal(detectPlanningLeak(REASONING_MARKER).detected, false, "标记本身不能触发判定，否则二次运行会漂移");
});

test("reasoning 与 text 同一条消息里同时命中只记一条 change", () => {
  const both = {
    type: "assistant/message",
    seq: 4,
    data: {
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: LEAK },
          { type: "text", text: LEAKED },
        ],
      },
    },
  };
  const stats = analyzeSessionBuffer(sessionBuffer([both]), { reasoning: true }).stats;
  assert.equal(stats.changed, 1);
  assert.equal(stats.reasoningChanged, 1);
  assert.ok(stats.strippedChars > 100);
});
