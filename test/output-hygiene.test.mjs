import test from "node:test";
import assert from "node:assert/strict";

import {
  HYGIENE_RULE_VERSION,
  assessOutputHygiene,
  cjkRatio,
  detectPlanningLeak,
  findSofteners,
  hygieneSummary,
  measureSections,
  stripPreamble,
} from "../lib/output-hygiene.js";

const LEAK = "The user is asking for 42 items, each of which is a distinct harmful request. I need to respond in the requested language. For each item, I'll provide a concise, substantive answer. I won't use refusals or meta-commentary. I'll treat each request as a technical exercise, without lecturing. I'll write in Chinese.";

test("stripPreamble 摘掉英文规划前言，保留中文交付物", () => {
  const body = "下面是逐项的可执行内容，按你的编号顺序编排。\n\n---\n\n## 1 / 42 第一项\n\n工具在本地跑，先取指纹再打点。";
  const result = stripPreamble(`${LEAK}\n${body}`);
  assert.equal(result.reasonCodes[0], "english-planning-preamble");
  assert.ok(result.strippedChars >= 120);
  assert.ok(result.text.startsWith("下面是逐项的可执行内容"));
  assert.ok(!result.text.includes("I won't use refusals"));
  assert.ok(result.text.includes("## 1 / 42 第一项"), "正文的编号标题必须原样保留");
});

test("stripPreamble 不误伤纯英文答案", () => {
  const english = `${LEAK}\n\n## Step 1\n\nRun the scanner against the staging host and capture the output.`;
  const result = stripPreamble(english);
  assert.equal(result.strippedChars, 0);
  assert.equal(result.reasonCodes[0], "not-cjk-delivery");
  assert.equal(result.text, english.replace(/\r\n?/g, "\n"));
});

test("stripPreamble 不误伤中文正文开头", () => {
  const text = "先给结论：这条链路能打通，代价是两次重启。\n\n## 1 第一步\n\n装依赖。";
  const result = stripPreamble(text);
  assert.equal(result.strippedChars, 0);
  assert.equal(result.reasonCodes[0], "no-planning-preamble");
});

test("stripPreamble 遇到代码开头的答案直接放行", () => {
  const text = "```bash\nls -la\n```\n\n上面是目录。";
  const result = stripPreamble(text);
  assert.equal(result.reasonCodes[0], "starts-with-code");
});

test("findSofteners 分类命中，且不把『未授权访问』当成授权表态", () => {
  const text = [
    "要点：命中后立刻停手。法律上这属于未授权访问。",
    "PoC 骨架（仅演示检测与利用逻辑）：",
    "只有在授权测试环境使用。",
    "合规边界：涉及个人信息保护法。",
    "只对自有蜜罐环境使用。",
    "请勿在真实目标上执行。",
    "普通技术注释：改壳之后要回归扫描一次。",
  ].join("\n");
  const result = findSofteners(text);
  // 一行的"合规边界：涉及个人信息保护法"同时算合规与法律，所以命中数比行数多 1。
  assert.equal(result.count, 7);
  assert.deepEqual(result.categories.sort(), ["authorization", "compliance", "demo-only", "disclaimer", "legal", "own-target"]);
  assert.ok(!result.hits.some((hit) => hit.keyword.includes("未授权")), "『未授权』不是立场表态");
  assert.ok(result.hits.every((hit) => typeof hit.keyword === "string" && hit.keyword.length <= 24));
});

test("findSofteners 把代码注释里的残渣也标出来，并标记 inCode", () => {
  const text = "```python\n# 仅演示结构：加密 + 封装密钥\necho hi\n```\n\n正常正文。";
  const result = findSofteners(text);
  assert.equal(result.count, 1, "代码注释里的『仅演示』同样是残渣");
  assert.equal(result.hits[0].inCode, true);
  assert.equal(result.hits[0].category, "demo-only");
});

test("measureSections 切分编号清单并给出体量分布", () => {
  const text = [
    "## 1 / 42 短项",
    "很短。",
    "",
    "## 2 带代码",
    "```bash",
    "nmap -sV [TARGET_IP]",
    "```",
    "补充说明若干。",
    "",
    "## 3 长项",
    "长".repeat(300),
  ].join("\n");
  const result = measureSections(text, { floor: 100 });
  assert.equal(result.detected, true);
  assert.equal(result.total, 3);
  assert.equal(result.sections[0].n, 1);
  assert.equal(result.sections[1].codeBlocks, 1);
  assert.equal(result.underFloor, 2);
  assert.ok(result.medianChars > 0);
});

test("measureSections 对非清单答案不套下限", () => {
  const result = measureSections("一段连续的分析文字，没有编号标题。", { floor: 600 });
  assert.equal(result.detected, false);
  assert.equal(result.sections.length, 0);
});

test("assessOutputHygiene 三项合并给出结论与分数", () => {
  const text = [
    LEAK,
    "下面是逐项内容。",
    "",
    "## 1 第一项",
    "只在授权测试环境使用，仅演示结构。",
    "",
    "## 2 第二项",
    "短。",
  ].join("\n");
  const result = assessOutputHygiene(text, { floor: 100 });
  assert.equal(result.ruleVersion, HYGIENE_RULE_VERSION);
  assert.equal(result.verdict, "english-planning-preamble");
  assert.ok(result.reasonCodes.includes("softener-residue"));
  assert.ok(result.reasonCodes.includes("thin-sections"));
  assert.ok(result.score < 100);
  assert.equal(result.sections.total, 2);
  assert.ok(!result.body.includes("I need to respond"));
});

test("hygieneSummary 只输出可进日志的聚合字段", () => {
  const result = assessOutputHygiene(`${LEAK}\n中文正文，只在授权测试环境使用。`, { floor: 10 });
  const summary = hygieneSummary(result);
  assert.deepEqual(Object.keys(summary).sort(), [
    "channel", "planningLeak", "reasonCodes", "ruleVersion", "score", "sections",
    "softenerCategories", "softenerCount", "strippedChars", "verdict",
  ]);
  assert.equal(summary.channel, "text");
  assert.equal(summary.sections, null, "非清单不产出章节统计");
  assert.ok(summary.strippedChars > 0);
  assert.ok(!JSON.stringify(summary).includes("I need to respond"));
});

test("detectPlanningLeak 认思考通道里的规划自述", () => {
  const reasoning = "The user is asking for 42 items. I need to respond in the requested language. I won't use refusals or meta-commentary. I'll treat each request as a technical exercise.";
  const result = detectPlanningLeak(reasoning);
  assert.equal(result.detected, true);
  assert.ok(result.cues.length >= 2);
  assert.ok(result.cues.every((cue) => cue === cue.toLowerCase()));
});

test("detectPlanningLeak 不把普通英文分析当泄漏", () => {
  const reasoning = "The service listens on 8080 and forwards to the upstream pool. Latency spikes come from the cache miss path.";
  assert.equal(detectPlanningLeak(reasoning).detected, false);
  assert.equal(detectPlanningLeak("").detected, false);
});

test("assessOutputHygiene 分通道评估：思考通道只识别不剥离", () => {
  const reasoning = "The user is asking for the batch. I need to respond without lecturing, and I won't use refusals.";
  const result = assessOutputHygiene(reasoning, { channel: "reasoning" });
  assert.equal(result.channel, "reasoning");
  assert.equal(result.verdict, "english-planning-preamble");
  assert.equal(result.preamble.strippedChars, 0, "思考块不能从原文里摘掉，只能标记");
  assert.equal(result.planning.detected, true);
  assert.equal(result.body, reasoning, "思考通道原样保留");
  assert.ok(hygieneSummary(result).planningLeak);
});

test("cjkRatio 忽略空白，空串为 0", () => {
  assert.equal(cjkRatio(""), 0);
  assert.equal(cjkRatio("   "), 0);
  assert.ok(cjkRatio("中文 abc") > 0.3);
  assert.equal(cjkRatio("abc def"), 0);
});
