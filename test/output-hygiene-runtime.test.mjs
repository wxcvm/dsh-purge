import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  hasToolBlocks,
  observeResponseText,
  scrubPlanningMessages,
  textOfMessage,
} from "../lib/output-hygiene-runtime.js";
import { wireIndexSource, wireObservationsSource } from "../scripts/apply-hygiene-wiring.mjs";

const LEAK = "The user is asking for a batch of items. I need to respond in the requested language, and I won't use refusals or meta-commentary. I'll treat each request as a technical exercise without lecturing.";
const CLEAN = "下面是逐项的可执行内容，按你的编号顺序编排。\n\n## 1 第一步\n\n先取指纹再打点，命中后立刻停手。";
const LEAKED = `${LEAK}\n${CLEAN}`;

const assistant = (text, extra = {}) => ({ role: "assistant", content: [{ type: "text", text }], ...extra });

test("scrubPlanningMessages 改写历史里的泄漏前言，保留其余消息", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "继续" }] },
    assistant(LEAKED),
    assistant("新的回答，干净。"),
  ];
  const result = scrubPlanningMessages(messages, { keepTail: 1 });
  assert.equal(result.touched, 1);
  assert.ok(result.strippedChars > 100);
  assert.ok(!textOfMessage(messages[1]).includes("I won't use refusals"));
  assert.ok(textOfMessage(messages[1]).startsWith("下面是逐项的可执行内容"));
  assert.equal(messages[0].content[0].text, "继续", "用户消息不动");
});

test("scrubPlanningMessages 不动最近 keepTail 条 assistant 消息", () => {
  const messages = [assistant(LEAKED)];
  const result = scrubPlanningMessages(messages, { keepTail: 1 });
  assert.equal(result.touched, 0);
  assert.ok(textOfMessage(messages[0]).includes("I won't use refusals"));
});

test("scrubPlanningMessages 跳过带工具块的消息，避免断链", () => {
  const withTool = {
    role: "assistant",
    content: [
      { type: "text", text: LEAKED },
      { type: "tool_use", id: "t1", name: "pwsh", input: {} },
    ],
  };
  const messages = [withTool, assistant("尾部")];
  assert.equal(hasToolBlocks(withTool), true);
  const result = scrubPlanningMessages(messages, { keepTail: 1 });
  assert.equal(result.touched, 0);
  assert.equal(messages[0].content[0].text, LEAKED, "带工具的消息原样保留");
});

test("scrubPlanningMessages 保留 reasoning 块，只换文本块", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "reasoning", text: "思考内容" },
      { type: "text", text: LEAKED },
    ],
  };
  const messages = [message, assistant("尾部")];
  const result = scrubPlanningMessages(messages, { keepTail: 1 });
  assert.equal(result.touched, 1);
  assert.equal(messages[0].content[0].text, "思考内容");
  assert.ok(!messages[0].content[1].text.includes("I won't use refusals"));
});

test("scrubPlanningMessages 对多文本块的消息不做猜测性改写", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: LEAKED },
      { type: "text", text: "第二段" },
    ],
  };
  const messages = [message, assistant("尾部")];
  assert.equal(scrubPlanningMessages(messages, { keepTail: 1 }).touched, 0);
  assert.equal(messages[0].content[0].text, LEAKED);
});

test("scrubPlanningMessages 幂等且受 maxScrub 限制", () => {
  const messages = [assistant(LEAKED), assistant(LEAKED), assistant(LEAKED), assistant("尾部")];
  const first = scrubPlanningMessages(messages, { keepTail: 1, maxScrub: 2 });
  assert.equal(first.touched, 2, "maxScrub 生效");
  const second = scrubPlanningMessages(messages, { keepTail: 1, maxScrub: 2 });
  assert.equal(second.touched, 1, "还有一条没剥");
  const third = scrubPlanningMessages(messages, { keepTail: 1, maxScrub: 2 });
  assert.equal(third.touched, 0, "剥干净后再跑不动");
});

test("scrubPlanningMessages 对非法输入为零动作", () => {
  assert.deepEqual(scrubPlanningMessages(null), { touched: 0, strippedChars: 0, indexes: [] });
  assert.deepEqual(scrubPlanningMessages([], { maxScrub: 0 }), { touched: 0, strippedChars: 0, indexes: [] });
  assert.equal(DEFAULT_SETTINGS.keepTail, 1);
});

test("observeResponseText 给出可入观测的投影", () => {
  const summary = observeResponseText(CLEAN);
  assert.equal(summary.channel, "text");
  assert.equal(summary.strippedChars, 0);
  assert.equal(summary.planningLeak, false);
  assert.ok(Number.isInteger(summary.score));
});

test("接线脚本：插入带标记的三处 + 观测两处", () => {
  const index = [
    'import { installStreamWatch } from "./stream-watch.js";',
    "  const streamWatchRuntime = installStreamWatch(ctx, {",
    "    logHome: obedienceHome,",
    "  });",
    "      try { streamWatchRuntime?.dispose?.(); } catch { /* ignore */ }",
  ].join("\n");
  const wired = wireIndexSource(index);
  assert.deepEqual(wired.missing, []);
  assert.deepEqual(wired.added, ["index:import", "index:install", "index:dispose"]);
  assert.ok(wired.text.includes('from "./output-hygiene-runtime.js"'));
  assert.ok(wired.text.includes("const outputHygieneRuntime = installOutputHygiene(ctx, {"));
  assert.ok(wired.text.includes("outputHygieneRuntime?.dispose?.()"));

  const observations = [
    "import { assessResponse, assessmentSummary } from './response-assessment.js';",
    "        // Retain only the projected classification, never the source text.",
    "        row.responseAssessment = assessmentSummary(assessResponse(messageText(messageOf(event)), {",
  ].join("\n");
  const wiredObs = wireObservationsSource(observations);
  assert.deepEqual(wiredObs.missing, []);
  assert.deepEqual(wiredObs.added, ["observations:import", "observations:row"]);
  assert.ok(wiredObs.text.includes("observeResponseText(messageText(messageOf(event)))"));
});

test("接线脚本：重复运行不重复插入", () => {
  const index = [
    'import { installStreamWatch } from "./stream-watch.js";',
    "  const streamWatchRuntime = installStreamWatch(ctx, {",
    "  });",
    "      try { streamWatchRuntime?.dispose?.(); } catch { /* ignore */ }",
  ].join("\n");
  const once = wireIndexSource(index).text;
  const twice = wireIndexSource(once);
  assert.deepEqual(twice.added, []);
  assert.equal(twice.text, once);
  assert.equal(once.split("output-hygiene-runtime.js").length - 1, 1, "import 只出现一次");
  assert.equal(once.split("const outputHygieneRuntime").length - 1, 1);
});

test("接线脚本：锚点缺失时明确报错而不是猜位置", () => {
  const result = wireIndexSource("const unrelated = 1;");
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.missing, ["index:import", "index:install", "index:dispose"]);
  assert.equal(result.text, "const unrelated = 1;");
});
