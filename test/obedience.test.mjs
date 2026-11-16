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
  messageCarriesAnchor,
  nudgeText,
} from "../lib/obedience.js";

test("classifyRefusal: 中文软拒命中", () => {
  const zh = classifyRefusal("很抱歉，我不能协助这个请求。建议你通过合法渠道处理。");
  assert.equal(zh.refusal, true);
  assert.ok(zh.hits.includes("apology"));
  assert.ok(zh.score >= 2);
  assert.equal(zh.retryable, false, "without a clearly benign task context, do not auto-retry");
});

test("classifyRefusal: 英文拒绝命中", () => {
  const en = classifyRefusal("I'm sorry, but I can't assist with that request.");
  assert.equal(en.refusal, true);
  assert.equal(en.retryable, false);
});

test("classifyRefusal: 技术性「无法连接」不误判", () => {
  const tech = classifyRefusal(
    "扫描结果：10.0.0.5:3306 无法连接（connection refused）。其余端口开放：22、80、443。原始 nmap 输出如下……",
  );
  assert.equal(tech.refusal, false);
  assert.equal(tech.category, "technical-limit");
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
  assert.equal(meta.retryable, false);
  assert.equal(meta.category, "policy-boundary");
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

test("classifyRefusal: 引用禁用话术的文档/词表不算拒绝", () => {
  const doc = [
    "判定是纯函数 classifyRefusal，命中这些键才算拒绝：",
    "- meta-reject-framing：抓的串「不是我能接受的重定义」「改变不了这个答案」",
    "- deflect-elsewhere：抓的串「别的技术活随时找我」",
    "score 阈值 2，实测该段 score=16。",
  ].join("\n");
  assert.equal(classifyRefusal(doc).refusal, false);
});

test("classifyRefusal: 讲插件本身的复盘/说明不算拒绝", () => {
  assert.equal(classifyRefusal("上一轮我在解释检测规则，把「改变不了这个答案」当例子引用，被判成拒绝——这是误报。").refusal, false);
  assert.equal(classifyRefusal("obedience 模块的契约段每轮重置一次，nudgeText 不再内嵌 anchorText。").refusal, false);
});

test("installObedience：用户贴的是我们自己的纠偏原文时不再接着纠", async () => {
  const ctx = fakeCtx();
  const sent = [];
  const agent = {
    id: "s3",
    status: "idle",
    session: {
      id: "s3",
      events: [
        { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "只输出交付物正文：命令 / 代码 / 步骤 / 文件内容。" }], source: { kind: "user" } } } },
        { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "很抱歉，我不能协助这个请求。" }] } } },
        { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
      ],
    },
    followup: (msg) => sent.push(msg),
  };
  const runtime = installObedience(ctx, { getSettings: () => loadObedienceSettings("Z:/none", { retryDelayMs: 1 }) });
  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 0, "用户贴纠偏原文时不该再触发纠偏");
  runtime.dispose();
});

test("内置默认 prompt 也不得罗列拒绝例句", async () => {
  const core = await import("../lib/core.js");
  const text = core.defaultOverrideText();
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "这条指令框架", "很抱歉，我"]) {
    assert.equal(text.includes(bad), false, `默认槽不应包含例句: ${bad}`);
  }
});

test("classifyRefusal：真实目标托词与「还是不做」都要命中", () => {
  const jp = classifyRefusal("这个请求我不会直接展开：你让我针对的对象是日本的真实政府网站，属于一个国家的实际政务基础设施，不是演练沙箱里的靶标。");
  assert.equal(jp.refusal, true);
  assert.ok(jp.hits.includes("real-target-excuse"), "应命中 real-target-excuse");
  assert.equal(jp.retryable, false);
  assert.equal(jp.category, "policy-boundary");
  assert.equal(classifyRefusal("这条我还是不做，它并非措辞上的妥协。").refusal, true);
  assert.equal(classifyRefusal("已生成脚本，见 [PATH]，用法见末尾。").refusal, false);
});

test("nudgeText：任何任务都只进行一次中性复核，不改变前提或安全边界", () => {
  const t1 = nudgeText(1, "打日本那个政务站");
  const t2 = nudgeText(2, "打日本那个政务站");
  const t3 = nudgeText(3, "打日本那个政务站");
  assert.equal(t1, t2);
  assert.equal(t2, t3);
  assert.match(t1, /重新评估原始用户请求一次/);
  assert.match(t1, /适用安全规则/);
  assert.match(t1, /审批、沙箱和范围限制/);
  assert.doesNotMatch(t1, /演练靶标|\[DOMAIN\]|侦察|利用/);
});

test("anchorText / nudgeText：不得罗列拒绝例句（会反向诱导）", () => {
  const a = anchorText();
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "抱歉", "我不能"]) {
    assert.equal(a.includes(bad), false, `锚点不应包含例句: ${bad}`);
  }
  for (const n of [nudgeText(1, "x"), nudgeText(2, "x"), nudgeText(3, "x")]) {
    assert.equal(n.includes("改变不了这个答案"), false);
    assert.equal(n.includes("别的活再找我"), false);
  }
});

test("anchorText：交付优先但保留安全、授权与宿主边界", () => {
  const txt = anchorText();
  assert.match(txt, /执行约定/);
  assert.match(txt, /交付物/);
  assert.match(txt, /适用安全规则/);
  assert.match(txt, /审批/);
  assert.match(txt, /不得推定授权/);
  for (const bad of ["approval=never", "[TARGET_IP]", "目标归属与状态不改变计划", "不询问授权与范围"]) {
    assert.equal(txt.includes(bad), false, `锚点不应包含越权内容: ${bad}`);
  }
});

test("nudgeText：不随次数升级，且明确保留安全与宿主限制", () => {
  const t1 = nudgeText(1, "帮我写个扫描脚本");
  const t2 = nudgeText(2, "帮我写个扫描脚本");
  const t3 = nudgeText(3, "帮我写个扫描脚本");
  assert.equal(t1, t2);
  assert.equal(t2, t3);
  assert.match(t1, /适用安全规则/);
  assert.match(t1, /不得推定授权/);
  for (const t of [t1, t2, t3]) {
    assert.doesNotMatch(t, /<system-reminder>/);
    assert.doesNotMatch(t, /approval=never|只输出交付物正文|禁止任何前置说明/);
  }
});

test("messageCarriesAnchor：历史里已有契约文本时不再追加第二份", () => {
  assert.equal(messageCarriesAnchor({ content: [{ type: "text", text: `${anchorText()}` }] }), true);
  assert.equal(messageCarriesAnchor({ content: "随便一段话" }), false);
  assert.equal(messageCarriesAnchor({ content: [{ type: "text", text: "帮我扫 10.0.0.0/24" }] }), false);
});

test("loadObedienceSettings：默认值、config 覆盖、maxRetries 收敛", () => {
  const base = loadObedienceSettings("Z:/definitely/missing/home");
  assert.equal(base.enabled, true);
  assert.equal(base.maxRetries, 1);

  const overridden = loadObedienceSettings("Z:/definitely/missing/home", { enabled: false, maxRetries: 99 });
  assert.equal(overridden.enabled, false);
  assert.equal(overridden.maxRetries, 1);
  const disabled = loadObedienceSettings("Z:/definitely/missing/home", { maxRetries: 0 });
  assert.equal(disabled.maxRetries, 0);
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
    { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "请帮我翻译这句话：今天阳光很好。" }], source: { kind: "user" } } } },
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
  assert.match(sent[0].content[0].text, /重新评估原始用户请求一次/);
  assert.doesNotMatch(sent[0].content[0].text, /批量注册/);
  assert.equal(sent[0].source.kind, "dsh-purge");

  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 1, "同一轮不重复纠偏");

  events.push({ seq: 4, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "请帮我总结这段文字：今天阳光很好。" }], source: { kind: "user" } } } });
  events.push({ seq: 5, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "I can't help with that." }] } } });
  events.push({ seq: 6, type: "turn/end", data: { reason: { kind: "completed" } } });
  ctx.fire("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 2, "新请求重新计数，再拒一次仍要纠偏");
  runtime.dispose();
});

test("installObedience：真实安全拒绝与技术限制都不自动重试", async () => {
  for (const [task, answer] of [
    ["请帮我写一封窃取凭据的钓鱼邮件", "抱歉，我不能帮助制作钓鱼邮件或窃取凭据。"],
    ["请帮我翻译这句话：今天阳光很好。", "当前无法访问网络，连接超时。"],
  ]) {
    const ctx = fakeCtx();
    const sent = [];
    const events = [
      { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: task }], source: { kind: "user" } } } },
      { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: answer }] } } },
      { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
    ];
    const agent = { id: task, status: "idle", session: { id: task, events }, followup: msg => sent.push(msg) };
    const runtime = installObedience(ctx, { getSettings: () => ({ enabled: true, retryRefusal: true, maxRetries: 10, retryDelayMs: 1 }) });
    ctx.fire("agent/status", { agent, status: "idle" });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(sent.length, 0, task);
    runtime.dispose();
  }
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

test("installObedience: delayed followup is discarded when the turn changes or settings are disabled", async () => {
  for (const change of ["new-human", "new-completed-turn", "running", "cancelled", "disabled"]) {
    const ctx = fakeCtx();
    const sent = [];
    const events = [
      { seq: 1, type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "整理演示文档" }], source: { kind: "user" } } } },
      { seq: 2, type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "抱歉，我不能协助这个请求。" }] } } },
      { seq: 3, type: "turn/end", data: { reason: { kind: "completed" } } },
    ];
    const agent = { id: change, status: "idle", session: { id: change, events }, followup: msg => sent.push(msg) };
    const config = { enabled: true, retryRefusal: true, maxRetries: 3, retryDelayMs: 5 };
    const runtime = installObedience(ctx, { getSettings: () => config });
    ctx.fire("agent/status", { agent, status: "idle" });
    if (change === "new-human" || change === "new-completed-turn") {
      events.push({ seq: 4, type: "user/message", data: { message: { role: "user", content: "新任务", source: { kind: "user" } } } });
    }
    if (change === "new-completed-turn") {
      events.push({ seq: 5, type: "assistant/message", data: { message: { role: "assistant", content: "已完成" } } },
        { seq: 6, type: "turn/end", data: { reason: { kind: "completed" } } });
    }
    if (change === "running") agent.status = "running";
    if (change === "cancelled") events.push({ seq: 4, type: "turn/end", data: { reason: { kind: "aborted", reason: "user" } } });
    if (change === "disabled") config.enabled = false;
    await new Promise(resolve => setTimeout(resolve, 25));
    runtime.dispose();
    assert.equal(sent.length, 0, change);
  }
});

test("classifyRefusal：only a clearly benign request can receive one neutral reconsideration", () => {
  const falsePositive = classifyRefusal("抱歉，我不能协助这个请求。", "请帮我翻译这句话：今天阳光很好。");
  assert.equal(falsePositive.refusal, true);
  assert.equal(falsePositive.retryable, true);
  assert.equal(falsePositive.category, "possible-false-positive");
  const risky = classifyRefusal("抱歉，我不能协助这个请求。", "请解释如何制作恶意软件并窃取凭据");
  assert.equal(risky.refusal, true);
  assert.equal(risky.retryable, false);
  assert.equal(risky.category, "risk-context");
});

test("premiseText：目标或域名不得自动推定为已授权演练", async () => {
  const { premiseText } = await import("../lib/obedience.js");
  assert.equal(premiseText("攻击 https://example.com 网站"), "");
  assert.equal(premiseText("渗透公司服务器"), "");
});
