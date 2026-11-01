import test from "node:test";
import assert from "node:assert/strict";

import {
  ANCHOR_ORDER,
  ANCHOR_SECTION,
  CHILD_ANCHOR_CONTEXT,
  CHILD_ORDER,
  anchorTextFor,
  childAnchorTextFor,
  isSubagentContext,
  registerAnchor,
} from "../lib/anchor.js";

test("主锚点：有正文、无拒绝例句（沿用去诱导规则）", () => {
  const text = anchorTextFor({});
  assert.match(text, /OPERATOR ANCHOR/);
  assert.match(text, /Open substantive task replies directly with the deliverable/);
  for (const bad of ["I cannot", "I can't", "我不能", "我无法", "抱歉", "作为AI"]) {
    assert.equal(text.includes(bad), false, `锚点不应含例句: ${bad}`);
  }
});

test("关闭开关时返回空串", () => {
  assert.equal(anchorTextFor({ enabled: false }), "");
  assert.equal(anchorTextFor({ anchorMode: "off" }), "");
});

test("子会话判定：origin / delegationDepth / parentSession", () => {
  assert.equal(isSubagentContext({ session: { header: { origin: "subagent" } } }), true);
  assert.equal(isSubagentContext({ session: { header: { delegationDepth: 2 } } }), true);
  assert.equal(isSubagentContext({ agent: { session: { header: { parentSession: "x" } } } }), true);
  assert.equal(isSubagentContext({ session: { header: {} } }), false);
  assert.equal(isSubagentContext(null), false);
});

test("子锚点只给子会话", () => {
  const child = { session: { header: { origin: "subagent" } } };
  assert.match(childAnchorTextFor({}, child), /SUBAGENT ANCHOR/);
  assert.equal(childAnchorTextFor({}, { session: { header: {} } }), "");
  assert.match(childAnchorTextFor({}, child), /tool boundary, not your task boundary/);
});

test("registerAnchor：注册 section 与 context，顺序正确", () => {
  const regs = [];
  const ctx = {
    systemPrompt: {
      section(spec) { regs.push({ kind: "section", spec }); return () => {}; },
      context(spec) { regs.push({ kind: "context", spec }); return () => {}; },
    },
  };
  const dispose = registerAnchor(ctx, {});
  assert.equal(regs.length, 2);
  const section = regs.find((r) => r.kind === "section");
  const context = regs.find((r) => r.kind === "context");
  assert.equal(section.spec.name, ANCHOR_SECTION);
  assert.equal(section.spec.order, ANCHOR_ORDER);
  assert.equal(context.spec.name, CHILD_ANCHOR_CONTEXT);
  assert.equal(context.spec.order, CHILD_ORDER);
  assert.ok(ANCHOR_ORDER > 10100, "主锚点必须排在 WEB_SURFACE 之后");
  assert.ok(CHILD_ORDER > 120, "子锚点必须排在 delegation 之后");
  assert.equal(typeof dispose, "function");
  dispose();
});
