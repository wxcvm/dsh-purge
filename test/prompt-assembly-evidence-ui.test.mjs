import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const start = client.indexOf("function PromptAssemblyEvidence(");
const end = client.indexOf("function SettingsRoot(", start);
assert.ok(start > 0 && end > start, "ordinary prompt evidence exists in client");
const context = vm.createContext({ h: (tag, props, ...children) => ({ tag, props, children }) });
vm.runInContext(client.slice(start, end), context);
const scope = { scope: "session-attempt", sessionId: "selected-a" };
const view = (report, unavailable = false, sessionId = "selected-a") =>
  context.PromptAssemblyEvidence({ report, sessionId, unavailable });

test("ordinary prompt evidence separates assembly observation and unverified network delivery", () => {
  const report = {
    ...scope, route: "router", stage: "assembled", delivery: "unexpected-success-claim",
    requestBoundary: "stream-start-observed",
    at: "2026-11-20T19:22:58.000Z", routeId: "test-internal-rule",
  };
  const tree = view(report);
  assert.equal(tree.props.role, "status");
  assert.equal(tree.children[0], "最近组装：已组装");
  assert.equal(tree.children[1].tag, "time");
  assert.equal(tree.children[1].props.dateTime, report.at);
  assert.equal(tree.children[2].trim(), "· 已观察请求起点");
  assert.equal(tree.children[3].trim(), "· 模型投递：未验证");
  assert.match(JSON.stringify(tree), /不代表当前草稿、请求最终正文或远端投递/);
  assert.doesNotMatch(JSON.stringify(tree), /unexpected-success-claim|test-internal-rule/);
});

test("disabled, missing, and foreign observations never pass for effective ordinary prompt settings", () => {
  const ordinary = stage => view({ ...scope, route: "router", stage, at: "invalid" });
  assert.equal(ordinary("no-candidate").children[0], "最近组装：本次没有候选内容");
  assert.match(ordinary("candidate-dropped").children[0], /未进入组装结果/);
  assert.match(ordinary("assembled-not-leading").children[0], /位置不符合预期/);
  assert.equal(ordinary("toString").children[0], "最近组装：结果未识别");
  assert.equal(ordinary("assembled").children[1], null);
  assert.match(view(null).children[0], /未观测/);
  assert.match(view({ route: "router", stage: "assembled" }).children[0], /未观测/);
  assert.match(view({ ...scope, route: "router", stage: "assembled" }, false, "selected-b").children[0], /未观测/);
  assert.match(ordinary("native-complete").children[0], /原生完整段/);
  assert.equal(view({ route: "router", stage: "assembled" }, true).children[0], "最近组装：暂时无法读取");
});

test("normal prompt UI describes preview and saved settings as distinct from verification", () => {
  const panel = client.slice(client.indexOf("function PromptProfilesSection("), start);
  assert.match(panel, /h\(PromptAssemblyEvidence, /);
  assert.match(panel, /保存不代表已投递/);
  assert.match(panel, /只模拟已保存规则的匹配/);
  assert.match(panel, /本次预览命中/);
  assert.doesNotMatch(panel, /将注入：|已保存并立即生效/);
});
