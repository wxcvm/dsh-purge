import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
function extract(start, end) {
  const from = client.indexOf(start);
  const to = client.indexOf(end, from);
  assert.ok(from !== -1 && to > from);
  return client.slice(from, to);
}

// Evaluate only the shipped workspace component and its local UI helpers.
// DOM and React hooks below are controlled; no DSH process is started.
function workspace({ canReturn = true } = {}) {
  const callbacks = [], cleanup = [], state = [], focused = [];
  const bus = { page: "clean", listeners: new Set() };
  const dispatchPage = (page) => {
    bus.page = page;
    for (const listener of bus.listeners) listener(page);
  };
  const doc = new EventTarget();
  doc.fullscreenElement = null;
  let exitCalls = 0, enterCalls = 0, resolve, reject;
  doc.exitFullscreen = () => {
    exitCalls += 1;
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  const element = {
    requestFullscreen() {
      enterCalls += 1;
      return new Promise((yes, no) => {
        reject = no;
        resolve = (owner = element) => {
          doc.fullscreenElement = owner;
          doc.dispatchEvent(new Event("fullscreenchange"));
          yes();
        };
      });
    },
  };
  const scope = {
    h(tag, props, ...children) { return { tag, props: props ?? {}, children: children.flat() }; },
    useT() { return () => ""; },
    useState(initial) {
      const index = state.push(initial) - 1;
      return [initial, (value) => { state[index] = value; }];
    },
    useRef(current) { return { current }; },
    useEffect(callback) { callbacks.push(callback); },
    useLayoutEffect(callback) { callbacks.push(callback); },
    ensurePurgeWorkspaceStyles() {},
    PurgeWorkspaceBoundary: "boundary",
    PurgeWorkspaceContent: "content",
    __dshPurgeDrill: { useTemporaryPrivacy() { return false; }, setTemporaryPrivacy() {} },
    purgeWorkspaceBus: bus,
    selectPurgeWorkspacePage: dispatchPage,
    selectPurgeHostPanel: () => canReturn,
    document: doc,
    MutationObserver: undefined,
    require: () => null,
  };
  const tree = new Function(...Object.keys(scope),
    extract("function workspacePrivacySummary(", "function PurgeWorkspaceIcon(")
      + "\nreturn PurgeWorkspacePage()")(...Object.values(scope));
  tree.props.ref.current = element;
  callbacks.forEach((callback) => {
    const dispose = callback();
    if (dispose) cleanup.push(dispose);
  });
  const navigation = tree.children[0].children;
  const byClass = (key) => navigation.find((node) => node.props.className === "dshp-workspace-" + key);
  const tabs = byClass("tabs").children;
  return {
    doc, element, tabs, panels: tree.children.slice(1), focused,
    get page() { return state[0]; },
    get visible() { return state[1]; },
    get immersive() { return state[3]; },
    get fullscreenError() { return state[4]; },
    get navigationError() { return state[5]; },
    get enterCalls() { return enterCalls; },
    get exitCalls() { return exitCalls; },
    resolve: (owner) => resolve(owner), reject: () => reject(Error("host rejected request")),
    toggle: byClass("fullscreen").props.onClick,
    back: byClass("back").props.onClick,
    unmount() { cleanup.forEach((dispose) => dispose()); },
    key(from, key, modifiers = {}) {
      let prevented = false;
      tabs.find(({ props }) => props["data-workspace-tab"] === from).props.onKeyDown({
        key,
        ...modifiers,
        preventDefault() { prevented = true; },
        currentTarget: {
          parentElement: {
            querySelector(selector) {
              const target = tabs.find(({ props }) => selector === '[data-workspace-tab="' + props["data-workspace-tab"] + '"]');
              assert.ok(target, "focus must target an actual workspace tab");
              return { focus() { focused.push(target.props["data-workspace-tab"]); } };
            },
          },
        },
      });
      return prevented;
    },
  };
}

test("a pending fullscreen request cannot strand the workspace after returning", async () => {
  const ui = workspace();
  ui.toggle();
  ui.toggle();
  assert.equal(ui.enterCalls, 1, "rapid repeated clicks must not request twice");
  ui.back();
  assert.equal(ui.visible, false);
  assert.equal(ui.exitCalls, 0, "no fullscreen element yet");
  ui.unmount();
  ui.resolve();
  await Promise.resolve();
  assert.equal(ui.exitCalls, 1);
  assert.equal(ui.doc.fullscreenElement, null);
});

test("unmount releases owned fullscreen even if the entry promise is still pending", async () => {
  const ui = workspace();
  ui.toggle();
  ui.unmount();
  ui.resolve();
  await Promise.resolve();
  assert.equal(ui.exitCalls, 1);
});

test("the workspace never exits or replaces another component's fullscreen", async () => {
  const ui = workspace();
  const other = {};
  ui.toggle();
  ui.back();
  ui.unmount();
  ui.resolve(other);
  await Promise.resolve();
  assert.equal(ui.doc.fullscreenElement, other);
  assert.equal(ui.exitCalls, 0);
  const later = workspace();
  later.doc.fullscreenElement = other;
  later.toggle();
  assert.equal(later.enterCalls, 0);
  assert.equal(later.doc.fullscreenElement, other);
});

test("denied navigation preserves an outstanding request and user-operated fullscreen", async () => {
  const ui = workspace({ canReturn: false });
  ui.toggle();
  ui.back();
  assert.equal(ui.visible, true);
  assert.match(ui.navigationError, /无法返回/);
  ui.resolve();
  await Promise.resolve();
  assert.equal(ui.immersive, true);
  assert.equal(ui.exitCalls, 0);
  ui.toggle();
  assert.equal(ui.exitCalls, 1);
  assert.equal(ui.immersive, false);
});

test("native denial remains visible on the live workspace, not after unmount", async () => {
  const current = workspace();
  current.toggle();
  current.reject();
  await Promise.resolve();
  assert.match(current.fullscreenError, /宿主不允许全屏/);
  const gone = workspace();
  gone.toggle();
  gone.unmount();
  gone.reject();
  await Promise.resolve();
  assert.equal(gone.fullscreenError, "");
});

test("workspace tabs link to real panels, with only the selected tab in the Tab order", () => {
  const ui = workspace();
  assert.deepEqual(ui.tabs.map(({ props }) => props.tabIndex), [0, -1]);
  assert.deepEqual(ui.panels.map(({ props }) => props.hidden), [false, true]);
  for (const { props } of ui.tabs) {
    const panel = ui.panels.find((node) => node.props.id === props["aria-controls"]);
    assert.equal(panel.props.role, "tabpanel");
    assert.equal(panel.props["aria-labelledby"], props.id);
  }
  assert.equal(ui.key("clean", "ArrowLeft"), true);
  assert.equal(ui.page, "drill");
  assert.equal(ui.key("drill", "ArrowRight"), true);
  assert.equal(ui.page, "clean");
  assert.equal(ui.key("clean", "End"), true);
  assert.equal(ui.key("drill", "Home"), true);
  assert.deepEqual(ui.focused, ["drill", "clean", "drill", "clean"]);
  assert.equal(ui.key("clean", "Tab"), false);
  assert.equal(ui.key("clean", "ArrowRight", { altKey: true }), false);
  ui.tabs[1].props.onClick();
  assert.equal(ui.page, "drill", "mouse activation still works");
});

test("following host theme resolves both advertised schemes with the media preference", () => {
  const make = new Function("document", "window", "getComputedStyle",
    extract("function detectHostTheme(", "function readTheme(") + "\nreturn detectHostTheme");
  const root = { hasAttribute: () => false, style: { colorScheme: "" } };
  const doc = { documentElement: root };
  const theme = (scheme, matches) => make(doc, { matchMedia: () => matches == null ? null : { matches } },
    () => ({ colorScheme: scheme }))();
  assert.equal(theme("light dark", false), "white");
  assert.equal(theme("dark light", true), "dusk");
  assert.equal(theme("only light", true), "white");
  assert.equal(theme("light dark"), "white");
  assert.equal(theme("dark light"), "dusk");
  assert.equal(make(doc, { matchMedia: () => ({ matches: true }) }, () => { throw Error("restricted"); })(), "dusk");
  assert.equal(make({ body: { hasAttribute: () => true } })(), "dusk");
});
