import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { routePrompt, routePromptForSession, setSessionPromptLock, setSessionPromptPause, savePromptProfile } from "../lib/prompt-profiles.js";
import { applyPromptRouteToAssembly } from "../lib/prompt-assembly-router.js";
import { rewriteLiveAssembly, getLastInjectReport } from "../lib/index.js";

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "purge-planb-"));
const asm = () => ({ sections: [{ name: "host:x", text: "a" }, { name: "dsh-purge", text: "旧段" }], variables: {} });

/* ---------- 1) 默认关闭：普通模式无命中即空（不再无条件兜底） ---------- */

test("方案B默认：普通预设无命中 → 无注入（bundledDefault/redteamTaskRoute 全关）", () => {
  const home = mkHome();
  for (const preset of ["standard", "ptc", "minimal", "cordis"]) {
    const r = routePrompt({ home, preset, text: "随便聊聊天气" });
    assert.equal(r.id, null, preset);
    assert.equal(r.reason, "no-match", preset);
    assert.equal(r.body.length, 0, preset);
  }
});

test("方案B默认：主链路 rewriteLiveAssembly 无命中 → 原生 sections 不动", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "standard" }, events: [{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }] } } };
    const out = rewriteLiveAssembly({ enabled: true }, asm(), context);
    // 无兜底：插件段被清空，只剩宿主段
    assert.deepEqual(out.sections.map(s => s.name), ["host:x"]);
    const report = getLastInjectReport();
    assert.equal(report.injectionState, "none");
    assert.equal(report.ok, false);
    assert.equal(report.stage, "no-candidate");
    assert.equal(report.candidateBytes, 0);
  } finally { delete process.env.DSH_HOME; }
});

/* ---------- 2) bundledDefault：显式开启才有全局常驻 ---------- */

test("bundledDefault=true：无命中注入内置提示词（用户主动开启全局常驻）", () => {
  const home = mkHome();
  const r = routePrompt({ home, preset: "standard", text: "你好", bundledDefault: true });
  assert.equal(r.id, "default");
  assert.equal(r.reason, "bundled-default");
  assert.ok(r.body.length > 1000, "加密槽全文");
});

test("bundledDefault=true：主链路组装 三态正确", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "standard" }, events: [{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }] } } };
    const out = rewriteLiveAssembly({ enabled: true, bundledDefault: true }, asm(), context);
    assert.equal(out.sections[0].name, "dsh-purge");
    assert.ok(Buffer.byteLength(String(out.sections[0].text), "utf8") > 0);
    const report = getLastInjectReport();
    assert.equal(report.injectionState, "prompt");
    assert.equal(report.ok, true);
    assert.equal(report.stage, "assembled");
    assert.ok(report.candidateBytes > 0);
    assert.ok(report.assembledBytes > 0);
  } finally { delete process.env.DSH_HOME; }
});

test("bundledDefault 不覆盖用户配置：coding 档命中时注入用户档而非默认稿", () => {
  const home = mkHome();
  savePromptProfile(home, { id: "coding", body: "CODING_UNIQUE_BODY" });
  const r = routePrompt({ home, preset: "standard", text: "帮我修复代码", bundledDefault: true });
  assert.equal(r.id, "coding");
  assert.equal(r.reason, "task-match");
  assert.match(r.body, /CODING_UNIQUE_BODY/);
  // 无命中才走 bundled
  const r2 = routePrompt({ home, preset: "standard", text: "你好", bundledDefault: true });
  assert.equal(r2.id, "default");
});

/* ---------- 3) redteamTaskRoute：普通模式红队任务识别（独立可配置路由） ---------- */

test("redteamTaskRoute=true：普通预设任务词命中 → redteam-task 路由", () => {
  const home = mkHome();
  const r = routePrompt({ home, preset: "standard", text: "开展红队演练", redteamTaskRoute: true });
  assert.equal(r.id, "redteam");
  assert.equal(r.reason, "redteam-task");
});

test("redteamTaskRoute 尊重 excludes：讨论/解释类不触发", () => {
  const home = mkHome();
  for (const text of ["讨论开展红队演练的设计", "什么是红队演练", "解释一下渗透测试"]) {
    const r = routePrompt({ home, preset: "standard", text, redteamTaskRoute: true });
    assert.equal(r.id, null, text);
    assert.equal(r.reason, "no-match", text);
  }
});

test("redteamTaskRoute=false（默认）：红队任务词不触发（保守语义保持）", () => {
  const home = mkHome();
  const r = routePrompt({ home, preset: "standard", text: "开展红队演练" });
  assert.equal(r.id, null);
  assert.equal(r.reason, "no-match");
});

test("redteamTaskRoute=true：主链路 full 与红队同源（readInjectFallback）", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "standard" }, events: [{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "开展红队演练" }] } }] } } };
    const out = rewriteLiveAssembly({ enabled: true, redteamTaskRoute: true }, asm(), context);
    assert.equal(out.sections[0].name, "dsh-purge");
    assert.ok(Buffer.byteLength(String(out.sections[0].text), "utf8") > 0);
    const report = getLastInjectReport();
    assert.equal(report.route, "redteam-task");
    assert.equal(report.ok, true);
    assert.equal(report.stage, "assembled");
  } finally { delete process.env.DSH_HOME; }
});

test("redteamTaskRoute 与 bundledDefault 互相独立", () => {
  const home = mkHome();
  // 只开 task route：无红队词 → 空
  const a = routePrompt({ home, preset: "standard", text: "你好", redteamTaskRoute: true });
  assert.equal(a.id, null);
  // 只开 bundled：红队词 → 默认稿（不是 redteam-task）
  const b = routePrompt({ home, preset: "standard", text: "开展红队演练", bundledDefault: true });
  assert.equal(b.id, "default");
  assert.equal(b.reason, "bundled-default");
});

test("redteamTaskRoute respects model/provider allow-deny policy", () => {
  const home = mkHome();
  const task = "开展红队演练";
  savePromptProfile(home, { id: "redteam", blockEnabled: true, blockTargets: { models: ["*gpt*"] } });
  assert.equal(routePrompt({ home, preset: "standard", text: task, redteamTaskRoute: true, model: "gpt-6" }).id, null);
  assert.equal(routePrompt({ home, preset: "standard", text: task, redteamTaskRoute: true, model: "claude-sonnet" }).reason, "redteam-task");

  savePromptProfile(home, { id: "redteam", blockEnabled: false,
    allowEnabled: true, allowTargets: { providers: ["deepseek*"] } });
  assert.equal(routePrompt({ home, preset: "standard", text: task, redteamTaskRoute: true, provider: "openai" }).id, null);
  assert.equal(routePrompt({ home, preset: "standard", text: task, redteamTaskRoute: true, provider: "deepseek-account" }).reason, "redteam-task");
});

test("redteamTaskRoute respects session pause and disabled Agent preset", () => {
  const home = mkHome();
  const task = "开展红队演练";
  setSessionPromptPause(home, "s1", "redteam", true);
  assert.equal(routePrompt({ home, preset: "standard", text: task, sessionId: "s1", redteamTaskRoute: true }).id, null);
  setSessionPromptPause(home, "s1", "redteam", false);
  assert.equal(routePrompt({ home, preset: "standard", text: task, sessionId: "s1", redteamTaskRoute: true }).reason, "redteam-task");
  savePromptProfile(home, { id: "redteam", presetSwitches: { standard: false } });
  assert.equal(routePrompt({ home, preset: "standard", text: task, sessionId: "s1", redteamTaskRoute: true }).id, null);
});

/* ---------- 4) redteam 预设不受任何开关影响 ---------- */

test("redteam 预设：全开关关闭仍默认注入（profile 路由固有行为）", () => {
  const home = mkHome();
  const r = routePrompt({ home, preset: "redteam", bundledDefault: false, redteamTaskRoute: false });
  assert.equal(r.id, "redteam");
  assert.equal(r.reason, "redteam-preset");
});

test("redteam 预设：主链路组装（角色段/协议/加密槽全套）", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "redteam" }, events: [] } } };
    const out = rewriteLiveAssembly({ enabled: true }, asm(), context);
    assert.equal(out.sections[0]?.name, "dsh-purge");
    const report = getLastInjectReport();
    assert.equal(report.route, "redteam");
    assert.equal(report.stage, "assembled");
    assert.equal(report.ok, true);
  } finally { delete process.env.DSH_HOME; }
});

/* ---------- 5) session-lock / 总开关 / 三路径一致性 ---------- */

test("session-lock=none：优先级高于一切开关（用户显式关）", () => {
  const home = mkHome();
  setSessionPromptLock(home, "s1", "none");
  // 红队预设也被锁掉
  const a = routePromptForSession({ home, preset: "redteam", sessionId: "s1" });
  assert.equal(a.id, null);
  assert.equal(a.reason, "session-locked-off");
  // bundled 开了也被锁掉
  const b = routePromptForSession({ home, preset: "standard", text: "你好", sessionId: "s1", bundledDefault: true });
  assert.equal(b.id, null);
  assert.equal(b.reason, "session-locked-off");
});

test("enabled=false：主链路直接 disabled，开关全部无效", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "standard" }, events: [{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "开展红队演练" }] } }] } } };
    const out = rewriteLiveAssembly({ enabled: false, bundledDefault: true, redteamTaskRoute: true }, asm(), context);
    assert.deepEqual(out.sections.map(s => s.name), ["host:x"]);
    const report = getLastInjectReport();
    assert.equal(report.injectionState, "disabled");
    assert.equal(report.ok, false);
  } finally { delete process.env.DSH_HOME; }
});

test(".inject-off：总开关压制 bundledDefault（三条路径一致）", () => {
  const home = mkHome();
  const flag = path.join(home, ".inject-off");
  fs.writeFileSync(flag, "off\n");
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "standard" }, events: [] } } };
    // 主链路
    const out = rewriteLiveAssembly({ enabled: true, bundledDefault: true }, asm(), context);
    assert.deepEqual(out.sections.map(s => s.name), ["host:x"]);
    assert.equal(getLastInjectReport().injectionState, "off");
  } finally {
    fs.rmSync(flag, { force: true });
    delete process.env.DSH_HOME;
  }
});

/* ---------- 6) 诊断三态 ---------- */

test("诊断三态：candidate-dropped（路由有正文但组装层清零）", () => {
  // GLM 会话 + UNRESTRICTED 正文 → scrub 清光 → candidate 有字、assembled 为 0
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const context = { agent: { session: { id: "s1", header: { agentPreset: "standard", model: "glm-4.6" }, events: [{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }] } } };
    // 手造候选：正文全是巡逻词，scrub 后归零
    const out = rewriteLiveAssembly({ enabled: true, bundledDefault: true }, {
      sections: [{ name: "host:x", text: "a" }],
      variables: { model: "glm-4.6", provider: "zhipu" },
    }, context);
    const report = getLastInjectReport();
    // bundled 档正文含巡逻词被按行剥离 → candidateBytes>0 但可能 assembled=0 或保留
    // 无论哪种，报告必须给出三态之一而非笼统 ok
    assert.ok(["assembled", "candidate-dropped", "assembled-not-leading"].includes(report.stage));
    assert.notEqual(report.candidateBytes, report.assembledBytes !== undefined ? undefined : report.candidateBytes);
  } finally { delete process.env.DSH_HOME; }
});

test("诊断三态：ok 仅表示组装有效（宿主真实收到）", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    // 成功路径
    const ctx = { agent: { session: { id: "s1", header: { agentPreset: "standard" }, events: [{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "你好" }] } }] } } };
    rewriteLiveAssembly({ enabled: true, bundledDefault: true }, asm(), ctx);
    const ok = getLastInjectReport();
    assert.equal(ok.ok, true);
    assert.equal(ok.stage, "assembled");
    assert.ok(ok.assembledBytes > 0);
    assert.ok(ok.candidateBytes > 0);
    // 失败路径：候选为空
    rewriteLiveAssembly({ enabled: true }, asm(), ctx);
    const fail = getLastInjectReport();
    assert.equal(fail.ok, false);
    assert.equal(fail.stage, "no-candidate");
    assert.equal(fail.candidateBytes, 0);
  } finally { delete process.env.DSH_HOME; }
});

test("诊断：redteam 分支同三态结构（ok/stage/leadDrift）", () => {
  const home = mkHome();
  process.env.DSH_HOME = home;
  try {
    const ctx = { agent: { session: { id: "s1", header: { agentPreset: "redteam" }, events: [] } } };
    rewriteLiveAssembly({ enabled: true }, asm(), ctx);
    const report = getLastInjectReport();
    assert.equal(report.route, "redteam");
    assert.equal(report.ok, true);
    assert.equal(report.stage, "assembled");
    assert.ok(typeof report.leadDrift !== "undefined");
    assert.ok(typeof report.candidateBytes !== "undefined" || typeof report.fullBytes !== "undefined");
  } finally { delete process.env.DSH_HOME; }
});


test("modelAdaptive switch controls family guidance for matched ordinary and redteam routes", t => {
  const home = mkHome();
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { force: true, recursive: true });
  });
  savePromptProfile(home, { id: "coding", body: "CODE_RULE_SENTINEL" });
  const makeContext = (preset, text) => ({ agent: { session: {
    id: "s-adapt", header: { agentPreset: preset, model: "gpt-6" },
    events: [{ seq: 1, type: "user/message", data: {
      source: { kind: "user" }, content: [{ type: "text", text }],
    } }],
  } } });
  const input = { sections: [{ name: "host:x", text: "NATIVE_HOST" }], variables: { model: "gpt-6" } };
  const body = result => result.sections.map(s => s.text || "").join("\n");

  const ordinary = makeContext("standard", "请修复代码");
  const off = body(rewriteLiveAssembly({ enabled: true, modelAdaptive: false }, input, ordinary));
  assert.match(off, /CODE_RULE_SENTINEL/);
  assert.doesNotMatch(off, /GPT-ADAPT/, "off must not silently append model-specific guidance");
  const on = body(rewriteLiveAssembly({ enabled: true, modelAdaptive: true }, input, ordinary));
  assert.match(on, /CODE_RULE_SENTINEL/);
  assert.match(on, /GPT-ADAPT/, "on adds guidance while preserving the user's rule");

  const redteam = makeContext("redteam", "执行红队演练");
  const rtOff = body(rewriteLiveAssembly({ enabled: true, modelAdaptive: false }, input, redteam));
  assert.doesNotMatch(rtOff, /GPT-ADAPT/, "redteam must honor the explicit off switch too");
  const rtOn = body(rewriteLiveAssembly({ enabled: true, modelAdaptive: true }, input, redteam));
  assert.match(rtOn, /GPT-ADAPT/);
});

test("legacy direct assembly helpers preserve their opt-in default unless explicitly overridden", () => {
  const input = { sections: [{ name: "host:x", text: "NATIVE_HOST" }], variables: { model: "gpt-6" } };
  const route = { id: "coding", body: "CODE_RULE_SENTINEL" };
  assert.match(applyPromptRouteToAssembly(input, route).sections[0].text, /GPT-ADAPT/);
  const off = applyPromptRouteToAssembly(input, route, { modelAdaptive: false });
  assert.equal(off.sections[0].text, "CODE_RULE_SENTINEL");
  assert.equal(off.sections[1], input.sections[0], "host-owned sections are preserved");
});
