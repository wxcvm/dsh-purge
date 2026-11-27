import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const start = client.indexOf("function PromptProfilesSection(");
const end = client.indexOf("function SettingsRoot(props)", start);
assert.ok(start > 0 && end > start, "profile component must be included in the generated client");
const source = client.slice(start, end);

function mount({ querySession, readSettings, requestPreview, requestWrite, fullWriteResponse = false } = {}) {
  const profiles = [
    { id: "global", name: "全局", scope: "global", enabled: false, priority: 0, keywords: [], excludes: [], body: "" },
    { id: "redteam", name: "红队", enabled: true, priority: 100, keywords: ["红队演练"], excludes: [], body: "" },
    { id: "coding", name: "开发", enabled: true, priority: 50, keywords: ["修复代码"], excludes: [], body: "Original development text" },
    { id: "writing", name: "写作", enabled: true, priority: 40, keywords: ["翻译"], excludes: [], body: "Writing instructions" },
  ];
  const apiCalls = [], actions = [], values = [], refs = [], effectQueue = [];
  const routingSettings = { bundledDefault: false, redteamTaskRoute: false, modelAdaptive: false };
  const observed = [{ model: "deepseek-flash", provider: "deepseek-account", sessionId: "current-host-session", preset: "standard" }];
  let stateIndex = 0, refIndex = 0, sessionLock = "writing";
  const snapshot = () => ({ ok: true, profiles: structuredClone(profiles),
    routingSettings: structuredClone(routingSettings), observedTargets: structuredClone(observed),
    backupSource: { ready: true, code: "READY", bytes: 1234, version: "v2.0.0" },
    modelPromptCatalog: [
      { id: "openai", label: "GPT / OpenAI", sampleModel: "gpt-6", text: "[GPT-ADAPT] built-in GPT text" },
      { id: "claude", label: "Claude / Anthropic", sampleModel: "claude-sonnet-4", text: "Claude model guidance" },
      { id: "gemini", label: "Gemini / Google", sampleModel: "gemini-2.5-pro", text: "Gemini model guidance" },
      { id: "glm", label: "GLM / 智谱", sampleModel: "glm-4.6", text: "GLM model guidance" },
    ],
    lastAssembly: { stage: "assembled", delivery: "unverified" } });
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
      if (readSettings && !url.includes("sessionId=")) return readSettings(snapshot());
      return { ...snapshot(), sessionLock: url.includes("sessionId=") ? sessionLock : null };
    },
    promptProfilesApi: async (op, data) => {
      actions.push({ op, data });
      if (op === "save" && requestWrite) return requestWrite(op, data, profiles, snapshot);
      if (op === "preview" && requestPreview) return requestPreview(data);
      if (op === "routing-settings") Object.assign(routingSettings, data.settings);
      if (op === "save") {
        const at = profiles.findIndex(p => p.id === data.profile.id);
        if (at >= 0) profiles[at] = { ...profiles[at], ...data.profile };
        else profiles.push(data.profile);
      }
      if (op === "lock") sessionLock = data.profileId;
      if (op === "unlock") sessionLock = null;
      return { ...(fullWriteResponse ? snapshot() : { ok: true, routingSettings: structuredClone(routingSettings) }), sessionLock };
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
  return { render, find, nodes, initialize, actions, apiCalls, profiles, routingSettings, observed };
}

test("saved and draft blacklists are visible and searchable without changing route settings", async () => {
  const ui = mount();
  Object.assign(ui.profiles.find(p => p.id === "coding"), {
    allowEnabled: false, blockEnabled: true,
    blockTargets: { models: ["blocked-model"], providers: ["blocked-provider"],
      sessions: ["blocked-session"], presets: ["redteam"] },
  });
  Object.assign(ui.profiles.find(p => p.id === "writing"), {
    allowEnabled: true, allowTargets: { models: ["allowed-writer"] },
    blockEnabled: true, blockTargets: { models: ["forbidden-writer"] },
  });
  await ui.initialize();
  const local = () => ui.nodes(ui.render()).find(n => n.props.className === "dshp-prompt-local");
  const search = value => ui.find(ui.render(), "input", "查找局部提示词规则")
    .props.onChange({ target: { value } });
  let display = JSON.stringify(local());
  assert.match(display, /白名单关闭 · 黑名单排除：模型：blocked-model · Provider：blocked-provider · 会话：blocked-session · Agent 预设：redteam/);
  assert.match(display, /模型：allowed-writer · 黑名单排除：模型：forbidden-writer/);
  search("BLOCKED-PROVIDER");
  assert.ok(ui.find(local(), "button", "编辑规则 coding"));
  assert.equal(ui.find(local(), "button", "编辑规则 writing"), undefined);
  search("FORBIDDEN-WRITER");
  assert.ok(ui.find(local(), "button", "编辑规则 writing"));
  assert.equal(ui.find(local(), "button", "编辑规则 coding"), undefined);
  search("");
  ui.find(local(), "textarea", "黑名单模型 ID").props.onChange({ target: { value: "new-blocked-draft" } });
  display = JSON.stringify(local());
  assert.match(display, /已保存范围：","白名单关闭 · 黑名单排除：模型：blocked-model/);
  assert.match(display, /未保存的范围：","白名单关闭 · 黑名单排除：模型：new-blocked-draft/);
  search("NEW-BLOCKED-DRAFT");
  assert.ok(ui.find(local(), "button", "编辑规则 coding"));
  assert.equal(ui.actions.length, 0, "search and editing draft do not save or route");
});

const nextTask = () => new Promise(resolve => setImmediate(resolve));

test("local rule list separates saved and draft model scopes; searching does not change the editor", async () => {
  const ui = mount();
  Object.assign(ui.profiles.find(p => p.id === "coding"), {
    allowEnabled: true, allowTargets: { models: ["editor-old"], providers: ["local-writer"] },
  });
  Object.assign(ui.profiles.find(p => p.id === "writing"), { allowEnabled: true, allowTargets: {} });
  let tree = await ui.initialize();
  const local = () => ui.nodes(ui.render()).find(n => n.props.className === "dshp-prompt-local");
  assert.match(JSON.stringify(local()), /白名单开启但未填条件/);
  ui.find(local(), "textarea", "白名单模型 ID").props.onChange({ target: { value: "editor-draft" } });
  const search = query => ui.find(ui.render(), "input", "查找局部提示词规则").props.onChange({ target: { value: query } });
  search("LOCAL-WRITER");
  tree = local();
  assert.ok(ui.find(tree, "button", "编辑规则 coding"));
  assert.equal(ui.find(tree, "button", "编辑规则 writing"), undefined);
  const display = JSON.stringify(tree);
  assert.match(display, /已保存启用 · 有草稿/);
  assert.match(display, /已保存范围：","模型：editor-old · Provider：local-writer/);
  assert.match(display, /未保存的范围：","模型：editor-draft · Provider：local-writer/);
  search("editor-draft");
  assert.ok(ui.find(local(), "button", "编辑规则 coding"));
  search("nothing-here");
  assert.equal(ui.find(local(), "button", "编辑规则 coding"), undefined);
  assert.match(JSON.stringify(local()), /仍可继续编辑/);
  assert.equal(ui.find(local(), "textarea", "白名单模型 ID").props.value, "editor-draft");
  assert.equal(ui.actions.length, 0);
});

test("creating in a filtered list reveals the new draft and focuses its name once", async () => {
  const ui = mount();
  const tree = await ui.initialize();
  const name = () => ui.find(ui.render(), "input", "局部规则名称");
  let focused = 0;
  const node = { focus() { focused++; } };
  name().props.ref(node);
  assert.equal(focused, 0, "opening the page does not steal focus");
  ui.find(tree, "input", "查找局部提示词规则").props.onChange({ target: { value: "narrow-search" } });
  ui.find(ui.render(), "button", "新建提示词规则").props.onClick();
  name().props.ref(node);
  name().props.ref(node);
  assert.equal(focused, 1);
  assert.equal(name().props.value, "新提示词规则");
  assert.equal(ui.find(ui.render(), "input", "查找局部提示词规则").props.value, "");
  assert.equal(ui.actions.length, 0, "new drafts are not auto-saved");
});

test("a late preview cannot replace results for a newer model; input and saved changes retire results", async () => {
  const replies = new Map();
  const ui = mount({ requestPreview: input => new Promise(resolve => { replies.set(input.model, resolve); }) });
  await ui.initialize();
  const field = model => ui.find(ui.render(), "input", "预览模型 ID").props.onChange({ target: { value: model } });
  const preview = () => ui.find(ui.render(), "button", "预览规则").props.onClick();
  field("writing-a");
  const old = preview();
  assert.match(JSON.stringify(ui.render()), /正在预览已保存规则/);
  field("writing-b");
  assert.match(JSON.stringify(ui.render()), /请重新预览/);
  const latest = preview();
  replies.get("writing-b")({ ok: true, selected: ["editor-b"], decisions: [] });
  await latest;
  replies.get("writing-a")({ ok: true, selected: ["editor-a"], decisions: [] });
  await old;
  const current = JSON.stringify(ui.render());
  assert.match(current, /本次预览命中：editor-b/);
  assert.doesNotMatch(current, /editor-a/);
  ui.find(ui.render(), "button", "保存全局提示词").props.onClick();
  await nextTask();
  assert.doesNotMatch(JSON.stringify(ui.render()), /本次预览命中：editor-b/);
});

test("preview reports invalid data or failure distinctly from a genuine empty result", async () => {
  let result = { ok: true, selected: [], decisions: [] };
  const ui = mount({ requestPreview: async () => result });
  await ui.initialize();
  const preview = async () => {
    await ui.find(ui.render(), "button", "预览规则").props.onClick();
    return JSON.stringify(ui.render());
  };
  assert.match(await preview(), /本次预览命中：无匹配/);
  result = { ok: true, selected: "not an array", decisions: {} };
  assert.match(await preview(), /预览响应格式有误/);
  assert.doesNotMatch(JSON.stringify(ui.render()), /本次预览命中/);
  result = { ok: false, error: "server details" };
  const failed = await preview();
  assert.match(failed, /预览失败，未取得匹配结果/);
  assert.doesNotMatch(failed, /本次预览命中|server details/);
});

test("write acknowledgement uses its full snapshot and does not issue a redundant GET", async () => {
  const ui = mount({ fullWriteResponse: true });
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "局部提示词正文").props.onChange({ target: { value: "Follow the editorial style." } });
  ui.find(ui.render(), "button", "保存规则").props.onClick();
  await nextTask();
  tree = ui.render();
  assert.equal(ui.apiCalls.length, 1);
  assert.equal(ui.find(tree, "textarea", "局部提示词正文").props.value, "Follow the editorial style.");
  assert.equal(ui.find(tree, "button", "恢复已保存的规则"), undefined);
});

test("legacy readback error is recoverable and refresh preserves drafts and updates recent model data", async () => {
  let reads = 0;
  const ui = mount({ readSettings: snapshot => {
    if (++reads === 2) throw Error("temporary read failure");
    return snapshot;
  } });
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "全局提示词正文").props.onChange({ target: { value: "Unsubmitted general notes." } });
  ui.find(ui.render(), "textarea", "局部提示词正文").props.onChange({ target: { value: "Keep the summary useful." } });
  ui.find(ui.render(), "button", "保存规则").props.onClick();
  await nextTask();
  tree = ui.render();
  assert.match(JSON.stringify(tree), /已保存；读回失败/);
  assert.equal(ui.find(tree, "button", "保存规则").props.disabled, true);
  ui.observed[0].model = "recently-observed-writing";
  await ui.find(tree, "button", "重新读取").props.onClick();
  tree = ui.render();
  assert.equal(ui.actions.length, 1, "recovery does not trigger another write");
  assert.equal(ui.find(tree, "button", "保存规则").props.disabled, false);
  assert.equal(ui.find(tree, "textarea", "全局提示词正文").props.value, "Unsubmitted general notes.");
  assert.equal(ui.find(tree, "button", "恢复已保存的规则"), undefined);
  assert.match(JSON.stringify(tree), /最近记录的模型 \/ Provider：recently-observed-writing/);
});

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
  assert.equal(Object.hasOwn(saved.data.settings, "bundledDefault"), false, "unmodified routing settings must not be written");
  assert.equal(Object.hasOwn(saved.data.settings, "upstreamSafeBackup"), false, "ordinary controls never write source selection");
  assert.equal(saved.data.settings.redteamTaskRoute, true);
  assert.equal(saved.data.settings.modelAdaptive, true);
  assert.equal(ui.routingSettings.redteamTaskRoute, true);
  tree = ui.render();
  assert.equal(ui.find(tree, "input", "普通模式识别红队任务").props.checked, true);
  assert.equal(ui.find(tree, "input", "按当前模型家族自动适配").props.checked, true);
});

test("source status is readable on the same page, independently of ordinary routing edits", async () => {
  const ui = mount({ fullWriteResponse: true });
  ui.routingSettings.upstreamSafeBackup = true;
  let tree = await ui.initialize();
  const status = () => JSON.stringify(ui.nodes(tree).find(n => n.props["aria-label"] === "主副提示词来源"));
  assert.match(status(), /配置已选择副方案/);
  assert.match(status(), /不表示当前会话已组装或模型已收到/);
  assert.equal(ui.find(tree, "button", "保存路由开关").props.disabled, true);
  ui.find(tree, "input", "按当前模型家族自动适配").props.onChange({ target: { checked: true } });
  tree = ui.render();
  await ui.find(tree, "button", "保存路由开关").props.onClick();
  tree = ui.render();
  const write = ui.actions.find(item => item.op === "routing-settings");
  assert.deepEqual(structuredClone(write.data.settings), { modelAdaptive: true });
  assert.equal(ui.routingSettings.upstreamSafeBackup, true);
  assert.match(status(), /配置已选择副方案/);
});

test("model family cards show real host-provided text and create only an unsaved scoped rule", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  const modelPanel = ui.nodes(tree).find(node => node.props["aria-label"] === "模型专属提示词");
  const panelText = JSON.stringify(modelPanel);
  assert.match(panelText, /GPT \/ Claude \/ Gemini \/ GLM/);
  assert.match(panelText, /\[GPT-ADAPT\] built-in GPT text/);
  assert.match(panelText, /Claude model guidance/);
  assert.match(panelText, /Gemini model guidance/);
  assert.ok(ui.find(tree, "button", "编辑GPT专属规则"));
  ui.find(tree, "button", "编辑GPT专属规则").props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, "input", "局部规则名称").props.value, "GPT 专属规则");
  assert.equal(ui.find(tree, "input", "启用当前提示词规则").props.checked, false);
  assert.equal(ui.actions.length, 0, "creating an editor must not save or inject a prompt");
  ui.find(tree, "textarea", "局部提示词正文").props.onChange({ target: { value: "Owner's custom GPT rule" } });
  tree = ui.render();
  ui.find(tree, "input", "启用当前提示词规则").props.onChange({ target: { checked: true } });
  tree = ui.render();
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(x => x.op === "save").data.profile;
  assert.equal(saved.id, "model-openai");
  assert.equal(saved.enabled, true);
  assert.equal(saved.allowEnabled, true);
  assert.ok(saved.allowTargets.models.includes("gpt-*"));
  assert.equal(saved.body, "Owner's custom GPT rule");
});

test("source choice saves only the backup switch and leaves other unsaved routing changes", async () => {
  const ui = mount({ fullWriteResponse: true });
  ui.routingSettings.upstreamSafeBackup = false;
  let tree = await ui.initialize();
  assert.match(JSON.stringify(tree), /备用资源可读取/);
  assert.equal(ui.find(tree, "input", "启用接手版副提示词").props.checked, false);
  ui.find(tree, "input", "普通模式识别红队任务").props.onChange({ target: { checked: true } });
  tree = ui.render();
  ui.find(tree, "input", "启用接手版副提示词").props.onChange({ target: { checked: true } });
  tree = ui.render();
  await ui.find(tree, "button", "保存副提示词方案").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const first = ui.actions.find(x => x.op === "routing-settings");
  assert.deepEqual(structuredClone(first.data.settings), { upstreamSafeBackup: true });
  assert.equal(ui.routingSettings.upstreamSafeBackup, true);
  assert.equal(ui.routingSettings.redteamTaskRoute, false, "unrelated router switch must not be saved");
  tree = ui.render();
  assert.equal(ui.find(tree, "input", "普通模式识别红队任务").props.checked, true,
    "the unrelated routing draft must survive source save");
  await ui.find(tree, "button", "保存路由开关").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const writes = ui.actions.filter(x => x.op === "routing-settings");
  assert.equal(writes.length, 2);
  assert.deepEqual(structuredClone(writes[1].data.settings), { redteamTaskRoute: true });
});

test("unknown backup selection is not clickable, and missing built-in family text is not invented", async () => {
  const ui = mount({ readSettings(result) {
    return { ...result, modelPromptCatalog: undefined, backupSource: undefined };
  } });
  const tree = await ui.initialize();
  assert.equal(ui.find(tree, "input", "启用接手版副提示词").props.disabled, true);
  assert.match(JSON.stringify(tree), /备用资源未核验/);
  assert.match(JSON.stringify(tree), /当前宿主未返回内置适配正文/);
  assert.equal(ui.find(tree, "button", "保存副提示词方案").props.disabled, true);
});

test("local-only leaves the source unconfirmed and preserves an edited prompt", async () => {
  let refuse = false;
  const ui = mount({ readSettings(result) {
    if (refuse) throw new Error("local-only");
    return result;
  } });
  ui.routingSettings.upstreamSafeBackup = false;
  let tree = await ui.initialize();
  assert.match(JSON.stringify(tree), /配置使用主方案/);
  ui.find(tree, "textarea", "全局提示词正文").props.onChange({ target: { value: "keep this draft" } });
  refuse = true;
  tree = ui.render();
  await ui.find(tree, "button", "重新读取").props.onClick();
  tree = ui.render();
  assert.match(JSON.stringify(tree), /当前 Harness 拒绝了这次本机设置请求/);
  assert.match(JSON.stringify(tree), /读取失败，当前状态未确认/);
  assert.doesNotMatch(JSON.stringify(tree), /配置使用主方案/);
  assert.equal(ui.find(tree, "textarea", "全局提示词正文").props.value, "keep this draft");
  assert.equal(ui.find(tree, "button", "保存全局提示词").props.disabled, true);
  refuse = false;
  await ui.find(tree, "button", "重新读取").props.onClick();
  tree = ui.render();
  assert.match(JSON.stringify(tree), /配置使用主方案/);
  assert.equal(ui.find(tree, "textarea", "全局提示词正文").props.value, "keep this draft");
  assert.deepEqual(ui.actions, []);
});

test("a legacy payload without a source setting must not be reported as the main source", async () => {
  const ui = mount();
  const tree = await ui.initialize();
  assert.match(JSON.stringify(tree), /宿主未返回备用方案状态/);
  assert.doesNotMatch(JSON.stringify(tree), /配置使用主方案|配置已选择副方案/);
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

function mountRecentTargetPicker() {
  let choice = "";
  const context = vm.createContext({
    useState: () => [choice, next => { choice = next; }],
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
  });
  vm.runInContext(source, context);
  return props => context.PromptObservedTargetSelect(props);
}

function recentTargetProps(ui, tree, label) {
  const picker = ui.nodes(tree).find(n => n.type?.name === "PromptObservedTargetSelect" && n.props.label === label);
  assert.ok(picker, "a recent select exists for " + label);
  return picker.props;
}

function addRecentTarget(ui, tree, label, id, beforeAdd = () => {}) {
  const props = recentTargetProps(ui, tree, label);
  const renderPicker = mountRecentTargetPicker();
  let picker = renderPicker(props);
  assert.equal(ui.find(picker, "button", "添加到" + label).props.disabled, true);
  const select = ui.find(picker, "select", "从最近记录选择" + label);
  assert.ok(ui.nodes(select).some(n => n.type === "option" && n.props.value === id));
  select.props.onChange({ target: { value: id } });
  beforeAdd();
  picker = renderPicker(props);
  assert.equal(ui.find(picker, "select", "从最近记录选择" + label).props.value, id);
  ui.find(picker, "button", "添加到" + label).props.onClick();
  assert.equal(ui.find(renderPicker(props), "select", "从最近记录选择" + label).props.value, "");
}

test("model scope and advanced targets offer observed local choices while retaining manual editing", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  assert.ok(recentTargetProps(ui, tree, "白名单模型 ID"));
  assert.ok(recentTargetProps(ui, tree, "白名单厂商 / Provider ID"));
  assert.ok(ui.find(tree, "button", "添加白名单对话 Session ID current-host-session"));
  assert.ok(ui.find(tree, "button", "添加白名单Agent 预设 cordis"));
  assert.ok(ui.find(tree, "textarea", "白名单模型 ID"), "manual entry remains available");
  assert.ok(ui.nodes(tree).some(n => n.type === "p" && n.children.some(s =>
    typeof s === "string" && s.includes("最近记录的模型 / Provider：") && s.includes("不代表当前会话"))),
    "recent model evidence is visible and not called the current session");

  addRecentTarget(ui, tree, "白名单模型 ID", "deepseek-flash", () => {
    assert.equal(ui.find(ui.render(), "textarea", "白名单模型 ID").props.value, "");
  });
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "白名单模型 ID").props.value, "deepseek-flash");
  addRecentTarget(ui, tree, "白名单厂商 / Provider ID", "deepseek-account");
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
  assert.equal(saved.data.profile.allowEnabled, false);
});

test("model selector supports removing picks without deleting manually entered wildcard targets", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "白名单模型 ID").props.onChange({ target: { value: "*gpt*" } });
  tree = ui.render();
  addRecentTarget(ui, tree, "白名单模型 ID", "deepseek-flash");
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "白名单模型 ID").props.value, "*gpt*\ndeepseek-flash");
  ui.find(tree, "button", "移除模型 ID deepseek-flash").props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "白名单模型 ID").props.value, "*gpt*");
});

test("recent picker distinguishes no observations, every ID added, and a stale selection", async () => {
  const ui = mount();
  const tree = await ui.initialize();
  const props = recentTargetProps(ui, tree, "白名单模型 ID");
  const renderPicker = mountRecentTargetPicker();
  assert.match(renderPicker({ ...props, options: [] }).children[0], /暂无本机观测/);
  assert.match(renderPicker({ ...props, selected: ["deepseek-flash"] }).children[0], /均已加入/);
  const options = [...props.options, { id: "other-model", label: "另一模型" }];
  let picker = renderPicker({ ...props, options });
  ui.find(picker, "select", "从最近记录选择白名单模型 ID").props.onChange({ target: { value: "deepseek-flash" } });
  picker = renderPicker({ ...props, options, selected: ["deepseek-flash"] });
  assert.equal(ui.find(picker, "select", "从最近记录选择白名单模型 ID").props.value, "");
  const add = ui.find(picker, "button", "添加到白名单模型 ID");
  assert.equal(add.props.disabled, true);
  add.props.onClick();
  assert.equal(ui.find(ui.render(), "textarea", "白名单模型 ID").props.value, "");
});

test("ordinary editor reads back a stale-save conflict without overwriting or losing its draft", async () => {
  const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
  const ui = mount({
    readSettings: snapshot => {
      if (!snapshot.profiles.find(row => row.id === "coding").revision)
        snapshot.profiles.find(row => row.id === "coding").revision = a;
      return snapshot;
    },
    requestWrite(op, data, profiles, snapshot) {
      assert.equal(op, "save");
      const row = profiles.find(row => row.id === "coding");
      if (!row.revision) {
        assert.equal(data.expectedRevision, a);
        Object.assign(row, { body: "Body saved in another window", revision: b });
        throw Object.assign(new Error("stale"), { code: "prompt_profile_conflict" });
      }
      assert.equal(data.expectedRevision, b);
      Object.assign(row, { body: data.profile.body, revision: c });
      return snapshot();
    },
  });
  let tree = await ui.initialize();
  ui.find(tree, "textarea", "局部提示词正文").props.onChange({ target: { value: "My local draft" } });
  tree = ui.render();
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = ui.render();
  assert.equal(ui.find(tree, "textarea", "局部提示词正文").props.value, "My local draft");
  assert.equal(ui.find(tree, "textarea", "已保存正文 coding").props.value, "Body saved in another window");
  assert.equal(ui.profiles.find(row => row.id === "coding").body, "Body saved in another window");
  ui.find(tree, "button", "采用已保存版本作为比对基线 coding").props.onClick();
  tree = ui.render();
  assert.equal(ui.actions.length, 1, "comparison does not save");
  assert.equal(ui.find(tree, "textarea", "局部提示词正文").props.value, "My local draft");
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.profiles.find(row => row.id === "coding").body, "My local draft");
});
