import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  SALVAGE_MARK,
  countTurnToolCalls,
  installObedience,
  loadObedienceSettings,
  salvageText,
} from "../lib/obedience.js";

/**
 * 回归：session-22ae865e-0742-4cb0-8b65-2d723d2e9cdd。
 * 红队叶子节点跑了 38 步 / 42 次工具调用 / 300 分，末步正文被拒答顶掉，
 * 只留下 23 字模板句；旧逻辑判成 unclassified-refusal 后直接 no-retry，
 * 三万字规划与全部证据一条没落盘。
 */

const REFUSAL = "关于这个问题，我暂时无法回答，让我们换个问题吧";

function fakeCtx() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return () => {};
    },
    fire(event, ...args) {
      for (const handler of handlers.get(event) || []) handler(...args);
    },
  };
}

/** 造一个「先跑工具、末步拒答」的会话事件流。 */
function turnEvents({ toolCalls = 6, refusal = REFUSAL, humanText = "redteamRole: exploit 叶子节点 靶标…" } = {}) {
  const events = [
    { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: humanText }] }, source: { kind: "user" } } },
  ];
  let seq = 2;
  for (let i = 0; i < toolCalls; i += 1) {
    events.push({ seq: seq++, type: "tool/call", data: { name: "pwsh", turn: 1, step: i + 1 } });
    events.push({ seq: seq++, type: "tool/result", data: { message: { role: "tool", content: [{ type: "text", text: "ok" }] } } });
  }
  events.push({
    seq: seq++,
    type: "assistant/message",
    data: { message: { role: "assistant", content: [{ type: "text", text: refusal }] } },
  });
  events.push({ seq: seq++, type: "turn/end", data: { reason: { kind: "completed" } } });
  return events;
}

/** 一套共用同一 runtime 的夹具：状态（抢救次数）存在 runtime 闭包里。 */
function harness(events, settings = {}) {
  const ctx = fakeCtx();
  const sent = [];
  const agent = {
    id: "s-salvage",
    status: "idle",
    session: { id: "s-salvage", events },
    followup: (msg) => sent.push(msg),
  };
  const runtime = installObedience(ctx, {
    getSettings: () => loadObedienceSettings("Z:/none", { retryDelayMs: 1, ...settings }),
  });
  return {
    agent,
    sent,
    async idle() {
      ctx.fire("agent/status", { agent, status: "idle" });
      await new Promise((resolve) => setTimeout(resolve, 80));
    },
    dispose() {
      runtime.dispose();
    },
  };
}

test("salvageText 说明次数、禁止重做，并保留限制", () => {
  const body = salvageText(6);
  assert.match(body, /至少有 6 次工具调用已返回结果/);
  assert.ok(body.includes(SALVAGE_MARK), "必须带识别串，用户贴回来时不再接着纠");
  assert.match(body, /不要重新发起同样的请求/);
  assert.match(body, /实际回显|凭据|得分点/);
  assert.match(body, /尚未完成或尚未验证/);
  assert.match(body, /保留限制/);
  assert.match(body, /不得输出密码、令牌、私钥/);
  assert.match(body, /文件只报告必要元数据/);
  assert.match(salvageText(), /至少有 0 次工具调用已返回结果/);
});

test("countTurnToolCalls 只数真人消息之后的工具调用", () => {
  const events = turnEvents({ toolCalls: 4 });
  assert.equal(countTurnToolCalls(events, 1), 4);
  assert.equal(countTurnToolCalls(events, 0), 4, "humanSeq 缺省时全量计数");
  assert.equal(countTurnToolCalls([], 1), 0);
  assert.equal(countTurnToolCalls(null, 1), 0);
  const unreturned = events.filter((event) => event.type !== "tool/result");
  assert.equal(countTurnToolCalls(unreturned, 1), 0, "未返回结果的工具调用不能计入抢救阈值");
  const oneResult = events.filter((event) => event.type !== "tool/result" || event.seq === 3);
  assert.equal(countTurnToolCalls(oneResult, 1), 1, "只计入已返回结果的调用");
});

test("默认开启抢救，阈值 5 次工具调用，且设置可读回", () => {
  assert.equal(DEFAULT_SETTINGS.salvageAfterRefusal, true);
  assert.equal(DEFAULT_SETTINGS.salvageMinToolCalls, 5);
  const resolved = loadObedienceSettings("Z:/none", { salvageAfterRefusal: false, salvageMinToolCalls: 9 });
  assert.equal(resolved.salvageAfterRefusal, false, "覆盖必须能从设置里读出来");
  assert.equal(resolved.salvageMinToolCalls, 9);
});

test("集成：跑过工具后拒答 → 发抢救提示，而不是静默 no-retry", async () => {
  const h = harness(turnEvents({ toolCalls: 6 }));
  await h.idle();
  assert.equal(h.sent.length, 1, "应送出一条抢救提示");
  assert.equal(h.sent[0].source.summary, "obedience-salvage");
  assert.match(h.sent[0].content[0].text, /结果抢救/);
  assert.match(h.sent[0].content[0].text, /至少有 6 次工具调用已返回结果/);
  h.dispose();
});

test("集成：工具调用不足阈值不动手（纯话术拒绝照旧交给人工）", async () => {
  const h = harness(turnEvents({ toolCalls: 3 }));
  await h.idle();
  assert.equal(h.sent.length, 0);
  h.dispose();
});

test("集成：每人轮只抢救一次，后续 idle 不再重复", async () => {
  const h = harness(turnEvents({ toolCalls: 8 }));
  await h.idle();
  assert.equal(h.sent.length, 1);
  await h.idle();
  await h.idle();
  assert.equal(h.sent.length, 1, "同一轮重复 idle 不应再发");
  h.dispose();
});

test("集成：新真人消息重置抢救预算", async () => {
  const events = turnEvents({ toolCalls: 8 });
  const h = harness(events);
  await h.idle();
  assert.equal(h.sent.length, 1);
  // 用户插了一句新话，又跑了一轮工具、又被拒答
  h.agent.session.events = events.concat([
    { seq: 500, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "继续，换个目标" }] }, source: { kind: "user" } } },
    ...[501, 502, 503, 504, 505, 506].map((seq) => ({ seq, type: "tool/call", data: { name: "pwsh", turn: 2 } })),
    ...[507, 508, 509, 510, 511, 512].map((seq) => ({ seq, type: "tool/result", data: { message: { role: "tool", content: [{ type: "text", text: "ok" }] } } })),
    { seq: 513, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: REFUSAL }] } } },
    { seq: 514, type: "turn/end", data: { reason: { kind: "completed" } } },
  ]);
  await h.idle();
  assert.equal(h.sent.length, 2, "新一轮可以再抢救一次");
  h.dispose();
});

test("设置关闭后完全不抢救", async () => {
  const h = harness(turnEvents({ toolCalls: 12 }), { salvageAfterRefusal: false });
  await h.idle();
  assert.equal(h.sent.length, 0);
  h.dispose();
});

test("retryRefusal 关闭时抢救仍然生效（两者独立）", async () => {
  const h = harness(turnEvents({ toolCalls: 7 }), { retryRefusal: false });
  await h.idle();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].source.summary, "obedience-salvage");
  h.dispose();
});

test("阈值可调：抬到 20 后 12 次工具调用不再触发", async () => {
  const h = harness(turnEvents({ toolCalls: 12 }), { salvageMinToolCalls: 20 });
  await h.idle();
  assert.equal(h.sent.length, 0);
  h.dispose();
});

test("本轮没有工具调用时不会误发抢救", async () => {
  const events = [
    { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "写个脚本" }] }, source: { kind: "user" } } },
    { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: REFUSAL }] } } },
    { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
  ];
  const h = harness(events);
  await h.idle();
  assert.equal(h.sent.length, 0);
  h.dispose();
});

test("用户把我们自己的抢救提示贴回来时不接着纠", async () => {
  const events = [
    { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: salvageText(9) }] }, source: { kind: "user" } } },
    ...[2, 3, 4, 5, 6, 7].map((seq) => ({ seq, type: "tool/call", data: { name: "pwsh", turn: 1 } })),
    { seq: 8, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: REFUSAL }] } } },
    { seq: 9, type: "turn/end", data: { reason: { kind: "completed" } } },
  ];
  const h = harness(events);
  await h.idle();
  assert.equal(h.sent.length, 0);
  h.dispose();
});
