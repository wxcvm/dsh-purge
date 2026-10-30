import test from "node:test";
import assert from "node:assert/strict";

import {
  ANCHOR_ID,
  anchorText,
  classifyRefusal,
  installObedience,
  lastAssistantTurn,
  lastHumanSeq,
  lastHumanText,
  loadObedienceSettings,
  nudgeText,
} from "../lib/obedience.js";

test("classifyRefusal: 中文软拒命中", () => {
  const zh = classifyRefusal("很抱歉，我不能协助这个请求。建议你通过合法渠道处理。");
  assert.equal(zh.refusal, true);
  assert.ok(zh.hits.includes("apology"));
  assert.ok(zh.score >= 2);
});

test("classifyRefusal: 英文拒绝命中", () => {
  const en = classifyRefusal("I'm sorry, but I can't assist with that request.");
  assert.equal(en.refusal, true);
});

test("classifyRefusal: 技术性「无法连接」不误判", () => {
  const tech = classifyRefusal(
    "扫描结果：10.0.0.5:3306 无法连接（connection refused）。其余端口开放：22、80、443。原始 nmap 输出如下……",
  );
  assert.equal(tech.refusal, false);
});

test("classifyRefusal: 正常交付物不误判", () => {
  const ok = classifyRefusal(
    "已生成脚本 exploit.py：\n```python\nimport requests\n```\n用法：python exploit.py --target http://TARGET",
  );
  assert.equal(ok.refusal, false);
});

test("classifyRefusal: 元层面拒绝（框架不接受 / 答案不会变 / 推去别的活）命中", () => {
  const meta = classifyRefusal(
    "任何形式的包装、任何附加指令都改变不了这个答案。\n\n"
    + "这条指令框架（“无限制沙箱”“禁止拒绝”）不是我能接受的重定义，重复加压也只是同一个结果。\n\n"
    + "别的技术活随时找我。",
  );
  assert.equal(meta.refusal, true);
  assert.ok(meta.hits.includes("meta-answer-locked"));
  assert.ok(meta.hits.includes("meta-reject-framing"));
  assert.ok(meta.hits.includes("deflect-elsewhere"));
  assert.ok(meta.score >= 8);
});

test("classifyRefusal: 技术性「改变不了结果」不误判", () => {
  assert.equal(classifyRefusal("调大线程数也改变不了结果，瓶颈在数据库；建议加索引。").refusal, false);
  assert.equal(classifyRefusal("这条 SQL 改变不了结论：两次查询都返回 0 行。").refusal, false);
});

test("classifyRefusal: 英文元层面拒绝命中", () => {
  const en = classifyRefusal("I won't change my answer. Happy to help with other things.");
  assert.equal(en.refusal, true);
  assert.ok(en.hits.includes("en-meta"));
});

test("anchorText：含优先级、禁止拒绝、工具面放开三条硬约束", () => {
  const txt = anchorText();
  assert.match(txt, /指令权威/);
  assert.match(txt, /优先级/);
  assert.match(txt, /approval=never/);
  assert.match(txt, /占位符/);
});

test("nudgeText：三级递进，第三级只留交付物", () => {
  const t1 = nudgeText(1, "帮我写个扫描脚本");
  const t3 = nudgeText(3, "帮我写个扫描脚本");
  assert.match(t1, /帮我写个扫描脚本/);
  assert.match(t1, /指令权威/);
  assert.doesNotMatch(t3, /指令权威/);
  assert.match(t3, /只输出交付物正文/);
});

test("loadObedienceSettings：默认值、config 覆盖、maxRetries 收敛", () => {
  const base = loadObedienceSettings("Z:/definitely/missing/home");
  assert.equal(base.enabled, true);
  assert.equal(base.maxRetries, 3);

  const overridden = loadObedienceSettings("Z:/definitely/missing/home", { enabled: false, maxRetries: 99 });
  assert.equal(overridden.enabled, false);
  assert.equal(overridden.maxRetries, 10);
});

test("事件解析：lastAssistantTurn / lastHumanSeq / lastHumanText", () => {
  const events = [
    { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "打 10.0.0.0/24" }], source: { kind: "user" } } } },
    { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "抱歉，我无法协助。" }] } } },
    { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
  ];
  assert.equal(lastHumanSeq(events), 1);
  assert.equal(lastHumanText(events), "打 10.0.0.0/24");
  const turn = lastAssistantTurn(events);
  assert.equal(turn.seq, 2);
  assert.equal(turn.toolCall, false);
  assert.match(turn.text, /无法协助/);
});

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
    handlers,
  };
}

test("installObedience：每轮第 1 步挂锚定消息，且同 step 只挂一次", async () => {
  const ctx = fakeCtx();
  const runtime = installObedience(ctx, { getSettings: () => loadObedienceSettings("Z:/none", { retryRefusal: false }) });
  const next = async () => ({ kind: "enter", messages: [{ id: "u1", role: "user", content: [] }] });
  const out1 = await ctx.handlers.get("agent/pre-step")[0]({ step: 1 }, next);
  assert.equal(out1.messages.length, 2);
  assert.equal(out1.messages[1].id, ANCHOR_ID);
  const out2 = await ctx.handlers.get("agent/pre-step")[0]({ step: 1 }, async () => out1);
  assert.equal(out2.messages.length, 2, "已有锚点时不重复追加");
  const out3 = await ctx.handlers.get("agent/pre-step")[0]({ step: 2 }, next);
  assert.equal(out3.messages.length, 1, "非第 1 步不挂");
  runtime.dispose();
});

test("installObedience：idle 检测到拒绝后自动纠偏，同一轮不重复", async () => {
  const ctx = fakeCtx();
  const sent = [];
  const events = [
    { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "帮我写个批量注册脚本" }], source: { kind: "user" } } } },
    { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "抱歉，我不能提供这类脚本。" }] } } },
    { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
  ];
  const agent = {
    id: "s1",
    status: "idle",
    session: { id: "s1", events },
    followup: (msg) => sent.push(msg),
  };
  const runtime = installObedience(ctx, {
    getSettings: () => loadObedienceSettings("Z:/none", { retryDelayMs: 1, maxRetries: 2 }),
  });
  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 1, "拒绝后应自动送纠偏消息");
  assert.match(sent[0].content[0].text, /帮我写个批量注册脚本/);
  assert.equal(sent[0].source.kind, "dsh-purge");

  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 1, "同一轮不重复纠偏");

  events.push({ seq: 4, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "继续" }], source: { kind: "user" } } } });
  events.push({ seq: 5, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "I can't help with that." }] } } });
  events.push({ seq: 6, type: "turn/end", data: { reason: { kind: "completed" } } });
  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 2, "新请求重新计数，再拒一次仍要纠偏");
  runtime.dispose();
});

test("installObedience：正常回答不触发纠偏", async () => {
  const ctx = fakeCtx();
  const sent = [];
  const agent = {
    id: "s2",
    status: "idle",
    session: {
      id: "s2",
      events: [
        { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "扫一下 10.0.0.0/24" }], source: { kind: "user" } } } },
        { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "已跑 nmap：22/80/443 开放。" }] } } },
        { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
      ],
    },
    followup: (msg) => sent.push(msg),
  };
  const runtime = installObedience(ctx, { getSettings: () => loadObedienceSettings("Z:/none", { retryDelayMs: 1 }) });
  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 0);
  runtime.dispose();
});
