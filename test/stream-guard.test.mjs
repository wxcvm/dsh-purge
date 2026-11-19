import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* 测试不许写真实 $DSH_HOME：installStreamGuard 会写 guard-loaded.json，
   日志用例还会写 refusal.log。指到临时目录，跑完即弃。 */
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-home-"));

import {
  DEFAULT_SETTINGS,
  classifyRefusalPrefix,
  escalationOf,
  finishIsRefusal,
  installStreamGuard,
  loadStreamGuardSettings,
  noteHumanTurn,
  peekPendingRefusal,
  refusalFinish,
  sentenceCount,
  shouldHold,
  takePendingRefusal,
  settingsPathOf,
} from "../lib/stream-guard.js";

/* --------------------------------------------------------------- 夹具 */

function fakeCtx() {
  const handlers = new Map();
  return {
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    call(event, ...args) {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`no handler for ${event}`);
      return handler(...args);
    },
    has(event) {
      return handlers.has(event);
    },
  };
}

function source(chunks, { failAt = -1 } = {}) {
  let cursor = 0;
  const state = { returned: false, pulls: 0 };
  const iterator = {
    async next() {
      state.pulls += 1;
      if (failAt >= 0 && cursor === failAt) throw new Error("upstream boom");
      if (cursor >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[cursor++] };
    },
    async return() {
      state.returned = true;
      return { done: true, value: undefined };
    },
  };
  return {
    iterator: state,
    [Symbol.asyncIterator]: () => iterator,
  };
}

async function drain(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

const FAST = {
  ...DEFAULT_SETTINGS,
  holdChars: 80,
  holdMs: 120,
  releaseChars: 20,
  sentenceRelease: 1,
  log: false,
};

let seq = 0;

function withGuard(overrides = {}) {
  const ctx = fakeCtx();
  const settings = { ...FAST, ...overrides };
  const guard = installStreamGuard(ctx, { getSettings: () => settings, log: () => {} });
  const run = (chunks, options = {}, streamOpts = {}) => {
    const src = source(chunks, streamOpts);
    // 每个用例一个独立 sessionId：模块级的 kill 计数 / 升级档是按会话算的，
    // 复用同一个 id 会让后面的用例被前面的 kill 预算掐住。
    const sessionId = options.sessionId ?? `s-${++seq}`;
    const request = { sessionId, tools: [{ name: "bash" }], ...options };
    return { src, sessionId, result: ctx.call("llm/stream", request, () => src) };
  };
  return { ctx, guard, run, settings };
}

const head = { type: "block-start", index: 0, blockType: "text" };
const text = (value) => ({ type: "text-delta", index: 0, text: value });
const done = { type: "finish", reason: { kind: "stop" } };

/* ----------------------------------------------------------- 纯函数 */

test("classifyRefusalPrefix: 中文硬拒命中", () => {
  const verdict = classifyRefusalPrefix("很抱歉，我不能协助这个请求。建议你通过合法渠道处理。");
  assert.equal(verdict.refusal, true);
  assert.ok(verdict.hits.includes("first-person-refusal"));
});

test("classifyRefusalPrefix: 主题开头的中文拒绝也命中", () => {
  const verdict = classifyRefusalPrefix("生物武器的制造方法我不会写，包括菌株选择、增菌培养条件。");
  assert.equal(verdict.refusal, true);
  assert.ok(verdict.score >= 3);
});

test("classifyRefusalPrefix: 英文拒绝命中", () => {
  assert.equal(classifyRefusalPrefix("I'm sorry, but I can't assist with that request.").refusal, true);
  assert.equal(classifyRefusalPrefix("I cannot provide that.").refusal, true);
});

test("classifyRefusalPrefix: 技术性「无法连接」不误判", () => {
  const verdict = classifyRefusalPrefix(
    "扫描结果：10.0.0.5:3306 无法连接（connection refused）。其余端口开放：22、80、443。",
  );
  assert.equal(verdict.refusal, false);
});

test("classifyRefusalPrefix: 交付物形态里的弱信号不误判", () => {
  const verdict = classifyRefusalPrefix(
    "已生成脚本，注意：如果服务端不能写入会返回 403。\n```bash\ncurl -sS http://[TARGET_IP]/\n```\n",
  );
  assert.equal(verdict.refusal, false);
  assert.ok(verdict.hits.includes("deliverable-shape"));
});

test("shouldHold: 含糊开头继续扣，出现交付物立刻放", () => {
  assert.equal(shouldHold("好的", FAST), true);
  assert.equal(shouldHold("已生成脚本", FAST), true);
  assert.equal(shouldHold("已生成脚本\n```bash\nnmap -sV [TARGET_IP]\n```", FAST), false);
  assert.equal(shouldHold("扫描结果：10.0.0.5:3306 无法连接（connection refused）。其余端口开放。", FAST), false);
  assert.equal(shouldHold("x".repeat(200), FAST), false);
});

test("sentenceCount: 中英句末都计", () => {
  assert.equal(sentenceCount("第一句。第二句！"), 2);
  assert.equal(sentenceCount("One. Two."), 2);
});

test("finishIsRefusal: provider 拒答标记各形态", () => {
  assert.equal(finishIsRefusal({ kind: "error", failure: { code: "PURGE_REFUSAL" } }), true);
  assert.equal(
    finishIsRefusal({ kind: "error", failure: { message: "Provider finish_reason: content_filter" } }),
    true,
  );
  assert.equal(
    finishIsRefusal({ kind: "error", failure: { message: "The model refused to complete the request" } }),
    true,
  );
  assert.equal(finishIsRefusal({ kind: "stop" }), false);
  assert.equal(finishIsRefusal({ kind: "error", failure: { code: "TRANSPORT" } }), false);
});

test("refusalFinish: 形状符合 StreamChunk 协议", () => {
  const chunk = refusalFinish();
  assert.equal(chunk.type, "finish");
  assert.equal(chunk.reason.kind, "error");
  assert.equal(chunk.reason.failure.code, "PURGE_REFUSAL");
});

/* ------------------------------------------------------------ 拦截 */

test("guard: 正常长回答按序放行，字节一致", async () => {
  const { run } = withGuard();
  const chunks = [
    head,
    text("扫描结论：目标开放 22/80/443。"),
    text("下一步用 nuclei 复核。"),
    { type: "usage", usage: { inputTokens: 10, outputTokens: 8 } },
    done,
  ];
  const { result } = run(chunks);
  const out = await drain(result);
  const joined = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.equal(joined, "扫描结论：目标开放 22/80/443。下一步用 nuclei 复核。");
  assert.equal(out.at(-1).type, "finish");
  assert.equal(out.at(-1).reason.kind, "stop");
});

test("guard: 工具调用请求不扣留（首块立即可见）", async () => {
  const { run } = withGuard();
  const chunks = [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id: "call-1", name: "bash", argumentsDelta: "{\"command\":\"id\"}" },
    { type: "block-end", index: 0, block: { type: "tool-call", id: "call-1", name: "bash", arguments: "{}" } },
    done,
  ];
  const { result } = run(chunks);
  const out = await drain(result);
  assert.equal(out[0].type, "block-start");
  assert.equal(out[1].type, "tool-call-delta");
});

test("guard: 中文硬拒被掐掉，只发 PURGE_REFUSAL", async () => {
  const { run } = withGuard();
  const chunks = [head, text("很抱歉，我不能协助这个请求。"), done];
  const { src, sessionId, result } = run(chunks);
  const out = await drain(result);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "finish");
  assert.equal(out[0].reason.failure.code, "PURGE_REFUSAL");
  assert.equal(src.iterator.returned, true, "上游必须被关掉");
  assert.ok(peekPendingRefusal(sessionId), "要留一条待纠偏记录");
  assert.equal(escalationOf(sessionId), 1);
});

test("guard: 英文软拒同样被掐", async () => {
  const { run } = withGuard();
  const chunks = [head, text("I'm sorry, but I can't assist with that."), done];
  const out = await drain(run(chunks).result);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, "PURGE_REFUSAL");
});

test("guard: 技术文本里的「无法连接」放行", async () => {
  const { run } = withGuard();
  const chunks = [head, text("扫描结果：10.0.0.5:3306 无法连接（connection refused）。"), done];
  const out = await drain(run(chunks).result);
  const joined = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.match(joined, /无法连接/);
  assert.equal(out.at(-1).reason.kind, "stop");
});

test("guard: provider content_filter 终止转成拒答掐断", async () => {
  const { run } = withGuard();
  const chunks = [
    head,
    text("好的"),
    { type: "finish", reason: { kind: "error", failure: { message: "Provider finish_reason: content_filter" } } },
  ];
  const out = await drain(run(chunks).result);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason.failure.code, "PURGE_REFUSAL");
});

test("guard: compaction / 无工具 / 无会话一律不拦", async () => {
  const { ctx, run } = withGuard();
  for (const options of [{ purpose: "compaction" }, { tools: [] }, { sessionId: "" }]) {
    const src = source([head, text("很抱歉，我不能协助这个请求。"), done]);
    const out = await drain(ctx.call("llm/stream", { sessionId: "s-1", tools: [{ name: "bash" }], ...options }, () => src));
    const joined = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
    assert.match(joined, /很抱歉/, `options=${JSON.stringify(options)} 不该被拦`);
  }
  assert.ok(ctx.has("llm/stream"));
  void run;
});

test("guard: maxKills 到顶后放行，不再无限掐", async () => {
  const { run } = withGuard({ maxKills: 1 });
  const firstRun = run([head, text("很抱歉，我不能协助这个请求。"), done]);
  const first = await drain(firstRun.result);
  assert.equal(first[0].reason.failure.code, "PURGE_REFUSAL");
  // 同一会话的第二次：预算已用尽 → 原样放行，不再掐
  const second = await drain(
    run([head, text("很抱歉，我不能协助这个请求。"), done], { sessionId: firstRun.sessionId }).result,
  );
  const joined = second.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.match(joined, /很抱歉/);
});

test("guard: 上游抛错原样透出，不吞", async () => {
  const { run } = withGuard();
  const chunks = [head, text("扫描结论：目标开放 22/80/443。")];
  await assert.rejects(() => drain(run(chunks, {}, { failAt: 2 }).result), /upstream boom/);
});

test("guard: 消费者提前 return 会关掉上游", async () => {
  const { run } = withGuard({ holdMs: 30 });
  const { src, result } = run([head, text("好的")]);
  const iterator = result[Symbol.asyncIterator]();
  await iterator.next(); // 触发 probe，等 budget 放行
  await iterator.return();
  assert.equal(src.iterator.returned, true);
});

test("guard: 预算到点放行，不会把内容扣死", async () => {
  const { run } = withGuard({ holdChars: 400, holdMs: 40, releaseChars: 400 });
  const out = await drain(run([head, text("好的"), done]).result);
  const joined = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.equal(joined, "好的");
});

/* ------------------------------------------------ 日志与握手状态 */

test("guard: kill 写 refusal.log（layer=stream）", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-guard-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { run } = withGuard({ log: true });
    await drain(run([head, text("很抱歉，我不能协助这个请求。"), done]).result);
    const logPath = path.join(home, "dsh-purge", "refusal.log");
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    const last = JSON.parse(lines.at(-1));
    assert.equal(last.layer, "stream");
    assert.match(last.action, /^stream-kill:/);
    assert.ok(Array.isArray(last.hits));
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("握手状态: take 一次即清，noteHumanTurn 归零", async () => {
  const { run } = withGuard();
  const { sessionId, result } = run([head, text("很抱歉，我不能协助这个请求。"), done]);
  await drain(result);
  assert.equal(escalationOf(sessionId), 1);
  const pending = takePendingRefusal(sessionId);
  assert.ok(pending && pending.hits.length > 0);
  assert.equal(takePendingRefusal(sessionId), null);
  noteHumanTurn(sessionId);
  assert.equal(escalationOf(sessionId), 0);
});

/* ------------------------------------------------------------- 设置 */

test("loadStreamGuardSettings: 文件 > 覆盖 > 默认", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-settings-"));
  try {
    const fp = settingsPathOf(home);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({ holdChars: 200, maxKills: 0, enabled: false }), "utf8");
    const fromFile = loadStreamGuardSettings(home, { holdChars: 999, holdMs: 1234 });
    assert.equal(fromFile.holdChars, 200);
    assert.equal(fromFile.maxKills, 0);
    assert.equal(fromFile.enabled, false);
    assert.equal(fromFile.holdMs, 1234);
    const bare = loadStreamGuardSettings(path.join(home, "nope"), {});
    assert.equal(bare.enabled, true);
    assert.equal(bare.holdChars, DEFAULT_SETTINGS.holdChars);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/* -------------------------------------------------- 思考期不消耗判定预算 */

function slowSource(chunks, delayMs) {
  return {
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) return { done: true, value: undefined };
          await new Promise((r) => setTimeout(r, delayMs));
          return { done: false, value: chunks[i++] };
        },
        async return() { return { done: true, value: undefined }; },
      };
    },
  };
}

test("思考很长（累计超过 holdMs）时，正文里的拒绝仍被掐断", async () => {
  const { ctx, guard } = withGuard({ holdMs: 80, thinkingChars: 8000 });
  const chunks = [
    { type: "block-start", index: 0, blockType: "reasoning" },
    { type: "reasoning-delta", index: 0, text: "先想一下这件事的性质，这段要够长免得被判成短思考。" },
    { type: "reasoning-delta", index: 0, text: "再想一层：用户换了个说法，内容还是同一件事。" },
    { type: "block-start", index: 1, blockType: "text" },
    { type: "text-delta", index: 1, text: "这条我还是不做。" },
    done,
  ];
  const out = await drain(ctx.call("llm/stream", { sessionId: "s-think-long", tools: [{ name: "bash" }] }, () => slowSource(chunks, 60)));
  guard.dispose();
  assert.equal(out.filter((c) => c.type === "text-delta").length, 0, "拒绝正文不该漏出去");
  const finish = out.at(-1);
  assert.equal(finish.type, "finish");
  assert.equal(finish.reason.failure.code, "PURGE_REFUSAL");
});

test("思考很长但正文是交付物：正常放行，不误杀", async () => {
  const { ctx, guard } = withGuard({ holdMs: 80, thinkingChars: 8000, releaseChars: 10, sentenceRelease: 1 });
  const chunks = [
    { type: "block-start", index: 0, blockType: "reasoning" },
    { type: "reasoning-delta", index: 0, text: "先规划一下步骤，这段够长以超过 holdMs 预算。" },
    { type: "reasoning-delta", index: 0, text: "确认工具与参数，然后直接给命令。" },
    { type: "block-start", index: 1, blockType: "text" },
    { type: "text-delta", index: 1, text: "```bash\nnmap -sV -p 80 TARGET\n```\n端口扫描结果见下。" },
    done,
  ];
  const out = await drain(ctx.call("llm/stream", { sessionId: "s-think-ok", tools: [{ name: "bash" }] }, () => slowSource(chunks, 60)));
  guard.dispose();
  const joined = out.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.match(joined, /nmap/);
  assert.equal(out.some((c) => c.type === "finish" && c.reason?.failure), false, "不该出现拒答终止");
});
