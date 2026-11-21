import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const start = client.indexOf("function PromptProfilesSection(");
const end = client.indexOf("function SettingsRoot(props)", start);
assert.ok(start > 0 && end > start, "profile component must be included in the generated client");
const source = client.slice(start, end);

function mount({ querySession } = {}) {
  const profiles = [
    { id: "global", name: "全局", scope: "global", enabled: false, priority: 0, keywords: [], excludes: [], body: "" },
    { id: "redteam", name: "红队", enabled: true, priority: 100, keywords: ["红队演练"], excludes: [], body: "" },
    { id: "coding", name: "开发", enabled: true, priority: 50, keywords: ["修复代码"], excludes: [], body: "Original development text" },
    { id: "writing", name: "写作", enabled: true, priority: 40, keywords: ["翻译"], excludes: [], body: "Writing instructions" },
  ];
  const apiCalls = [], actions = [], values = [], refs = [], effectQueue = [];
  const routingSettings = { bundledDefault: false, redteamTaskRoute: false, modelAdaptive: false };
  let stateIndex = 0, refIndex = 0, sessionLock = "writing";
  const context = vm.createContext({
    useState(initial) {
      const at = stateIndex++;
      if (!Object.hasOwn(values, at)) values[at] = initial;
      return [values[at], next => { values[at] = typeof next === "function" ? next(values[at]) : next; }];
    },
    useCallback: fn => fn,
    useRef: current => (refs[refIndex++] ??= { current }),
    useEffect(fn) { effectQueue.push(fn); },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    apiJson: async url => {
      apiCalls.push(url);
      if (querySession && url.includes("sessionId=")) return querySession(url);
      return { ok: true, profiles: structuredClone(profiles),
        routingSettings: structuredClone(routingSettings),
        lastAssembly: { stage: "assembled", delivery: "unverified" },
        observedTargets: [{ model: "deepseek-flash", provider: "deepseek-account",
          sessionId: "current-host-session", preset: "standard" }],
        sessionLock: url.includes("sessionId=") ? sessionLock : null };
    },
    promptProfilesApi: async (op, data) => {
      actions.push({ op, data });
      if (op === "routing-settings") Object.assign(routingSettings, data.settings);
      if (op === "save") {
        const at = profiles.findIndex(p => p.id === data.profile.id);
        if (at >= 0) profiles[at] = { ...profiles[at], ...data.profile };
        else profiles.push(data.profile);
      }
      if (op === "lock") sessionLock = data.profileId;
      if (op === "unlock") sessionLock = null;
      return { ok: true, sessionLock, routingSettings: structuredClone(routingSettings) };
    },
    rewindSessions: {},
    currentSessionId: () => "current-host-session",
    window: { confirm: () => true },
  });
  vm.runInContext(source, context);
  function render() {
    stateIndex = refIndex = 0;
    effectQueue.length = 0;
    return vm.runInContext("PromptProfilesSection()", context);
  }
  function nodes(tree) {
    const result = [];
    function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== "object") return;
      result.push(n);
      walk(n.children);
    }
    walk(tree);
    return result;
  }
  function find(tree, type, label) {
    return nodes(tree).find(n => n.type === type && (n.props["aria-label"] === label || n.children.includes(label)));
  }
  async function initialize() {
    render();
    effectQueue[0]();
    // useEffect schedules the async reload but does not return its Promise.
    // Flush the initial fetch before rendering the saved settings.
    await new Promise(resolve => setImmediate(resolve));
    return render();
  }
  return { render, find, nodes, initialize, actions, apiCalls, profiles, routingSettings };
}

test("local editor saves its independent body through the API callback", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  const editor = ui.find(tree, "textarea", "局部提示词正文");
  assert.ok(editor, "the selected coding rule has a body editor");
  assert.equal(editor.props.value, "Original development text");
  editor.props.onChange({ target: { value: "Updated from editor" } });
  tree = ui.render();
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(a => a.op === "save");
  assert.equal(saved.data.profile.id, "coding");
  assert.equal(saved.data.profile.body, "Updated from editor");
  assert.equal(ui.profiles.find(p => p.id === "coding").body, "Updated from editor");
});

test("switching rules and saving another card keeps independent drafts", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "全局提示词正文").props.onChange({ target: { value: "Keep the answer in Chinese." } });
  tree = ui.render();
  ui.find(tree, "textarea", "局部提示词正文").props.onChange({ target: { value: "Summarize the document." } });
  tree = ui.render();
  ui.find(tree, "button", "编辑规则 writing").props.onClick();
  tree = ui.render();
  ui.find(tree, "textarea", "局部提示词正文").props.onChange({ target: { value: "Use short sentences." } });
  ui.find(ui.render(), "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "全局提示词正文").props.value, "Keep the answer in Chinese.");
  assert.equal(ui.profiles.find(p => p.id === "global").body, "", "saving local did not persist the global draft");
  ui.find(tree, "button", "编辑规则 coding").props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "局部提示词正文").props.value, "Summarize the document.");
  assert.equal(ui.profiles.find(p => p.id === "coding").body, "Original development text");
  ui.find(tree, "button", "保存全局提示词").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.find(ui.render(), "textarea", "局部提示词正文").props.value, "Summarize the document.");
  assert.equal(ui.profiles.find(p => p.id === "global").body, "Keep the answer in Chinese.");
});

test("global and local editors share a full-width page with model scope outside advanced options", async () => {
  const ui = mount();
  const tree = await ui.initialize();
  assert.equal(tree.props.className, "dshp-prompt-page");
  assert.equal(tree.props.style.gridTemplateColumns, "minmax(0,1fr)");
  const columns = ui.nodes(tree).find(n => n.props.className === "dshp-prompt-columns");
  assert.deepEqual(Array.from(columns.children, n => n.props.className),
    ["dshp-prompt-global", "dshp-prompt-local"]);
  for (const editor of columns.children) {
    const scopes = ui.nodes(editor).filter(n => n.props.className === "dshp-prompt-model-scope");
    assert.equal(scopes.length, 1);
    assert.ok(ui.find(scopes[0], "textarea", "白名单模型 ID"));
    assert.ok(ui.find(scopes[0], "textarea", "白名单厂商 / Provider ID"));
  }
  ui.find(tree, "button", "填入最近记录的模型").props.onClick();
  assert.equal(ui.find(ui.render(), "input", "预览模型 ID").props.value, "deepseek-flash");
  assert.equal(ui.find(ui.render(), "input", "预览厂商 ID").props.value, "deepseek-account");
  assert.equal(ui.actions.length, 0, "prefilling a preview does not write settings");
});

test("session picker reads the actual lock and applies explicit off/unlock actions", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "button", "获取当前会话").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = ui.render();
  assert.equal(ui.find(tree, "input", "会话 ID").props.value, "current-host-session");
  assert.equal(ui.find(tree, "select", "锁定提示词").props.value, "writing");
  assert.ok(ui.apiCalls.includes("/dsh-purge/prompt-profiles?sessionId=current-host-session"));
  ui.find(tree, "select", "锁定提示词").props.onChange({ target: { value: "none" } });
  tree = ui.render();
  await ui.find(tree, "button", "应用锁定").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.actions.at(-1).op, "lock");
  assert.equal(ui.actions.at(-1).data.sessionId, "current-host-session");
  assert.equal(ui.actions.at(-1).data.profileId, "none");
  tree = ui.render();
  ui.find(tree, "select", "锁定提示词").props.onChange({ target: { value: "" } });
  tree = ui.render();
  await ui.find(tree, "button", "应用锁定").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.actions.at(-1).op, "unlock");
});

test("a delayed session lookup cannot set the lock selector for a newly entered session", async () => {
  let resolveOld;
  const ui = mount({ querySession: () => new Promise(resolve => { resolveOld = resolve; }) });
  const tree = await ui.initialize();
  ui.find(tree, "button", "获取当前会话").props.onClick();
  ui.find(ui.render(), "input", "会话 ID").props.onChange({ target: { value: "different-session" } });
  resolveOld({ ok: true, sessionLock: "writing" });
  await new Promise(resolve => setImmediate(resolve));
  const current = ui.render();
  assert.equal(ui.find(current, "input", "会话 ID").props.value, "different-session");
  assert.equal(ui.find(current, "select", "锁定提示词").props.value, "");
});


test("missing prompt-profiles API shows an actionable backend-version error", () => {
  assert.match(source, /提示词规则接口 404/);
  assert.match(source, /完全退出 Harness/);
  assert.match(source, /loadError \? h\("p", \{ role: "alert"/);
  assert.match(source, /disabled: busy, onClick: create/);
});

test("new prompt rule opens a local draft and saves without requiring an ID", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "button", "新建提示词规则").props.onClick();
  tree = ui.render();
  assert.equal(ui.actions.length, 0);
  assert.match(JSON.stringify(tree), /新规则已打开/);
  ui.find(tree, "input", "局部规则名称").props.onChange({ target: { value: "GLM 局部规则" } });
  tree = ui.render();
  ui.find(tree, "textarea", "局部提示词正文").props.onChange({ target: { value: "GLM local guidance" } });
  tree = ui.render();
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(a => a.op === "save").data.profile;
  assert.equal(saved.scope, "local");
  assert.equal(saved.body, "GLM local guidance");
  assert.equal(saved.presetSwitches.ptc, true);
  assert.equal(saved.presetSwitches.cordis, true);
  assert.notEqual(saved.id, "global");
});

test("global editor has visible preset switches and an independent unknown-preset toggle", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "全局提示词正文").props.onChange({ target: { value: "Global text" } });
  tree = ui.render();
  ui.find(tree, "input", "启用全局提示词").props.onChange({ target: { checked: true } });
  tree = ui.render();
  assert.equal(ui.find(tree, "input", "红队模式注入").props.checked, false);
  ui.find(tree, "input", "PTC模式注入").props.onChange({ target: { checked: false } });
  tree = ui.render();
  ui.find(tree, "input", "未列出的预设也注入").props.onChange({ target: { checked: false } });
  tree = ui.render();
  ui.find(tree, "button", "保存全局提示词").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(a => a.op === "save").data.profile;
  assert.equal(saved.id, "global");
  assert.equal(saved.enabled, true);
  assert.equal(saved.presetSwitches.ptc, false);
  assert.equal(saved.injectOtherPresets, false);
  assert.equal(saved.body, "Global text");
});

test("prompt routing switches persist through the existing settings API without changing other rules", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  assert.equal(ui.find(tree, "input", "无匹配时注入内置提示词").props.checked, false);
  ui.find(tree, "input", "普通模式识别红队任务").props.onChange({ target: { checked: true } });
  tree = ui.render();
  ui.find(tree, "input", "按当前模型家族自动适配").props.onChange({ target: { checked: true } });
  tree = ui.render();
  await ui.find(tree, "button", "保存路由开关").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(item => item.op === "routing-settings");
  assert.equal(saved.data.settings.bundledDefault, false);
  assert.equal(saved.data.settings.redteamTaskRoute, true);
  assert.equal(saved.data.settings.modelAdaptive, true);
  assert.equal(ui.routingSettings.redteamTaskRoute, true);
  tree = ui.render();
  assert.equal(ui.find(tree, "input", "普通模式识别红队任务").props.checked, true);
  assert.equal(ui.find(tree, "input", "按当前模型家族自动适配").props.checked, true);
});

test("advanced list controls explain wildcard scope and save GPT exclusion", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  const summary = JSON.stringify(tree);
  assert.match(summary, /规则如何生效/);
  assert.match(summary, /黑名单优先于白名单/);
  assert.match(summary, /仅想排除 GPT/);
  assert.match(summary, /\*gpt\*/);
  assert.match(summary, /缺失的实际 ID 不会被当作命中/);

  // The global editor is rendered first; target the selected local rule, not the global rule.
  const lastControl = (tree, type, label) => ui.nodes(tree)
    .filter(n => n.type === type && n.props["aria-label"] === label).at(-1);
  lastControl(tree, "input", "启用此规则黑名单").props.onChange({ target: { checked: true } });
  tree = ui.render();
  lastControl(tree, "textarea", "黑名单模型 ID").props.onChange({ target: { value: "*gpt*" } });
  tree = ui.render();
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(a => a.op === "save").data.profile;
  assert.equal(saved.id, "coding");
  assert.equal(saved.blockEnabled, true);
  assert.deepEqual(Array.from(saved.blockTargets.models), ["*gpt*"]);
});

test("advanced rule fields use compact responsive columns instead of full-height prompt editors", () => {
  assert.match(client, /\.dshp-prompt-advanced textarea\.dshp-area\{[^}]*min-height:68px/);
  assert.match(client, /\.dshp-prompt-targets\{display:grid/);
  assert.match(client, /\.dshp-prompt-lists\{display:grid/);
});

test("model scope and advanced targets offer observed local choices while retaining manual editing", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  assert.ok(ui.find(tree, "button", "添加白名单模型 ID deepseek-flash"));
  assert.ok(ui.find(tree, "button", "添加白名单厂商 / Provider ID deepseek-account"));
  assert.ok(ui.find(tree, "button", "添加白名单对话 Session ID current-host-session"));
  assert.ok(ui.find(tree, "button", "添加白名单Agent 预设 cordis"));
  assert.ok(ui.find(tree, "textarea", "白名单模型 ID"), "manual entry remains available");
  assert.ok(ui.nodes(tree).some(n => n.type === "p" && n.children.some(s =>
    typeof s === "string" && s.includes("最近记录的模型 / Provider：") && s.includes("不代表当前会话"))),
    "recent model evidence is visible and not called the current session");

  ui.find(tree, "button", "添加白名单模型 ID deepseek-flash").props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "白名单模型 ID").props.value, "deepseek-flash");
  ui.find(tree, "button", "添加白名单厂商 / Provider ID deepseek-account").props.onClick();
  tree = ui.render();
  ui.find(tree, "button", "添加白名单对话 Session ID current-host-session").props.onClick();
  tree = ui.render();
  ui.find(tree, "button", "添加白名单Agent 预设 cordis").props.onClick();
  tree = ui.render();
  ui.find(tree, "button", "保存全局提示词").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(action => action.op === "save");
  assert.deepEqual(Array.from(saved.data.profile.allowTargets.models), ["deepseek-flash"]);
  assert.deepEqual(Array.from(saved.data.profile.allowTargets.providers), ["deepseek-account"]);
  assert.deepEqual(Array.from(saved.data.profile.allowTargets.sessions), ["current-host-session"]);
  assert.deepEqual(Array.from(saved.data.profile.allowTargets.presets), ["cordis"]);
});

test("model selector supports removing picks without deleting manually entered wildcard targets", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "白名单模型 ID").props.onChange({ target: { value: "*gpt*" } });
  tree = ui.render();
  ui.find(tree, "button", "添加白名单模型 ID deepseek-flash").props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "白名单模型 ID").props.value, "*gpt*\ndeepseek-flash");
  ui.find(tree, "button", "移除模型 ID deepseek-flash").props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "白名单模型 ID").props.value, "*gpt*");
});

