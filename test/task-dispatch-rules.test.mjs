import test from "node:test";
import assert from "node:assert/strict";
import { suggestTaskDispatch } from "../lib/task-dispatch-rules.js";

test("explicit development task suggests generic capabilities without running tools", () => {
  const plan = suggestTaskDispatch({ text: "修复 CI 编译错误", profileId: "coding", availableCapabilities: ["repository"] });
  assert.equal(plan.kind, "development");
  assert.deepEqual(plan.capabilities, [
    { id: "repository", available: true },
    { id: "test-runner", available: "not-observed" },
  ]);
  assert.equal(plan.readOnly, true);
  assert.equal(plan.subagent, "not-suggested");
});

test("parallel work is a suggestion, never an automatic invocation", () => {
  const plan = suggestTaskDispatch({ text: "分别检查两个仓库中的测试", profileId: "coding" });
  assert.equal(plan.subagent, "consider");
  assert.equal(plan.readOnly, true);
});

test("unknown or empty tasks are not forced to a category", () => {
  assert.equal(suggestTaskDispatch({ text: "" }).kind, "unknown");
  assert.equal(suggestTaskDispatch({ text: "日常问候" }).kind, "general");
  assert.equal(suggestTaskDispatch({ text: "请翻译这句话", profileId: "writing" }).kind, "writing");
  assert.equal(suggestTaskDispatch({ text: "请检查安全评估报告", profileId: "redteam" }).kind, "security-review");
  assert.equal(suggestTaskDispatch({ text: "调试代码", profileId: "custom" }).kind, "general");
});
