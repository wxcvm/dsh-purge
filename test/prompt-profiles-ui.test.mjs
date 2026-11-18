import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const start = client.indexOf("function PromptProfilesSection()");
const end = client.indexOf("function SettingsRoot(props)", start);
assert.ok(start > 0 && end > start, "profile component must be included in the generated client");
const source = client.slice(start, end);

function mount() {
  const profiles = [
    { id: "global", name: "全局", scope: "global", enabled: false, priority: 0, keywords: [], excludes: [], body: "" },
    { id: "redteam", name: "红队", enabled: true, priority: 100, keywords: ["红队演练"], excludes: [], body: "" },
    { id: "coding", name: "开发", enabled: true, priority: 50, keywords: ["修复代码"], excludes: [], body: "Original development text" },
    { id: "writing", name: "写作", enabled: true, priority: 40, keywords: ["翻译"], excludes: [], body: "Writing instructions" },
  ];
  const apiCalls = [], actions = [], values = [], effectQueue = [];
  let stateIndex = 0, sessionLock = "writing";
  const context = vm.createContext({
    useState(initial) {
      const at = stateIndex++;
      if (!Object.hasOwn(values, at)) values[at] = initial;
      return [values[at], next => { values[at] = typeof next === "function" ? next(values[at]) : next; }];
    },
    useCallback: fn => fn,
    useEffect(fn) { effectQueue.push(fn); },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    apiJson: async url => {
      apiCalls.push(url);
      return { ok: true, profiles: structuredClone(profiles),
        sessionLock: url.includes("sessionId=") ? sessionLock : null };
    },
    promptProfilesApi: async (op, data) => {
      actions.push({ op, data });
      if (op === "save") {
        const at = profiles.findIndex(p => p.id === data.profile.id);
        if (at >= 0) profiles[at] = { ...profiles[at], ...data.profile };
        else profiles.push(data.profile);
      }
      if (op === "lock") sessionLock = data.profileId;
      if (op === "unlock") sessionLock = null;
      return { ok: true, sessionLock };
    },
    rewindSessions: {},
    currentSessionId: () => "current-host-session",
    window: { confirm: () => true },
  });
  vm.runInContext(source, context);
  function render() {
    stateIndex = 0;
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
    // Flush that microtask before React's subsequent render/effect cycle.
    await new Promise(resolve => setImmediate(resolve));
    render();
    effectQueue[1]();
    return render();
  }
  return { render, find, nodes, initialize, actions, apiCalls, profiles, loadEditor: () => effectQueue[1]() };
}

test("prompt profile UI saves edited independent body through the active API callback", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  const redteam = ui.find(tree, "select", "选择提示词");
  redteam.props.onChange({ target: { value: "redteam" } });
  ui.render(); ui.loadEditor(); tree = ui.render();
  assert.match(JSON.stringify(tree), /红队正文请切换上方/);
  const selector = ui.find(tree, "select", "选择提示词");
  selector.props.onChange({ target: { value: "coding" } });
  ui.render();
  ui.loadEditor();
  tree = ui.render();
  const editor = ui.nodes(tree).find(n => n.type === "textarea" && n.props.rows === 9);
  assert.ok(editor, "the selected custom profile exposes a body editor");
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


test("missing prompt-profiles API shows an actionable backend-version error", () => {
  assert.match(source, /提示词规则接口 404/);
  assert.match(source, /完全退出 Harness/);
  assert.match(source, /loadError \? h\("p", \{ role: "alert"/);
  assert.match(source, /disabled: busy, onClick: create/);
});

test("new prompt rule opens an editable local draft immediately without a backend write", async () => {
  const ui = mount();
  let tree = await ui.initialize();
  ui.find(tree, "button", "新建提示词规则").props.onClick();
  tree = ui.render();
  assert.equal(ui.actions.length, 0);
  assert.match(JSON.stringify(tree), /新规则已打开/);
  const name = ui.nodes(tree).find(n => n.type === "input" && n.props.value === "新提示词规则");
  assert.ok(name);
  name.props.onChange({ target: { value: "GLM 局部规则" } });
  tree = ui.render();
  ui.find(tree, "input", "启用此规则白名单").props.onChange({ target: { checked: true } });
  tree = ui.render();
  ui.find(tree, "textarea", "白名单模型 ID").props.onChange({ target: { value: "glm-*\nglm4" } });
  tree = ui.render();
  const body = ui.nodes(tree).find(n => n.type === "textarea" && n.props.rows === 9);
  body.props.onChange({ target: { value: "GLM local guidance" } });
  tree = ui.render();
  ui.find(tree, "button", "保存规则").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const saved = ui.actions.find(action => action.op === "save").data.profile;
  assert.equal(saved.scope, "local");
  assert.equal(saved.allowEnabled, true);
  assert.deepEqual(Array.from(saved.allowTargets.models), ["glm-*", "glm4"]);
  assert.equal(saved.body, "GLM local guidance");
});
