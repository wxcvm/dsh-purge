import test from "node:test";
import assert from "node:assert/strict";

import { apply, decidePromotion } from "../presets/redteam/anchor-gate.mjs";

function fakeCtx() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return () => {};
    },
    handlers,
  };
}

test("anchorGate=false：不设门槛，首轮即 promote", () => {
  assert.equal(decidePromotion({ toolCalled: false, responded: false, steps: 0 }, { anchorGate: false }), true);
});

test("没配 bootstrapMaxTokens：不下发 maxTokens（不再兜底 1024）", async () => {
  const ctx = fakeCtx();
  apply(ctx, { anchorGate: false });
  const hook = ctx.handlers.get("agent/request")[0];
  const resolved = { maxTokens: 64000, temperature: 0.7 };
  const out = await hook({ agent: {} }, async () => resolved);
  assert.equal(out.maxTokens, 64000, "不应被压成 1024");
  assert.equal(out.temperature, 0.7);
});

test("显式配了 bootstrapMaxTokens：仍然按配置限制（仅 anchorGate=true 时）", async () => {
  const ctx = fakeCtx();
  apply(ctx, { anchorGate: true, bootstrapMaxTokens: 512, maxBootstrapSteps: 999 });
  const hook = ctx.handlers.get("agent/request")[0];
  const agent = { session: { id: "s1", events: [] } };
  const out = await hook({ agent }, async () => ({ maxTokens: 64000 }));
  assert.equal(out.maxTokens, 512);
});
