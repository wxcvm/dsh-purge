import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const match = source.match(/const PURGE_WORKSPACE_CSS = ("(?:\\.|[^"\\])*");/);
assert.ok(match, "workspace stylesheet must remain in the client bundle");
const css = JSON.parse(match[1]);

test("default workspace uses one viewport geometry without competing dimensions", () => {
  const rule = css.match(/\.dshp-dock\.dshp-workspace\[data-maximized="1"\]\[data-default-full="1"\]\s*\{([^}]*)\}/);
  assert.ok(rule);
  assert.match(rule[1], /position:fixed!important;inset:0!important/);
  assert.match(rule[1], /width:auto!important;height:auto!important/);
  assert.doesNotMatch(rule[1], /100(?:d?vh|vw)/);
});

test("Windows titlebar is reserved without a second height calculation", () => {
  const rule = css.match(/html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\)[^\n]+\{([^}]*)\}/);
  assert.ok(rule);
  assert.match(rule[1], /top:var\(--dsh-windows-titlebar-height,40px\)!important/);
  assert.doesNotMatch(rule[1], /height:calc/);
  assert.match(css, /\.dshp-workspace :is\(button,input,select,textarea,a,\[role="button"\]\)\s*\{\s*-webkit-app-region:no-drag/);
});

test("workspace styles are installed before paint and back releases fullscreen", () => {
  assert.match(source, /useLayoutEffect\(\(\) => \{ ensurePurgeWorkspaceStyles\(\); \}, \[\]\)/);
  const back = source.match(/const back = \(\) => \{([\s\S]*?)\n\t\t\t\};\n\t\t\tif \(!workspaceVisible\)/);
  assert.ok(back, "workspace back handler must exist");
  assert.match(back[1], /selectPurgeHostPanel\(null\)[\s\S]*leaveWorkspace\(\)/);
  assert.match(source, /const leaveWorkspace = \(\) => \{\s*fullscreen\.release\(workspaceRef\.current\);[\s\S]*?setWorkspaceVisible\(false\)/);
});

test("host layout failures fall back to the Dock instead of escaping", () => {
  assert.match(source, /function selectPurgeHostPanel\(panel\) \{\s*try \{[\s\S]*?ctx\.get\("layout"\)[\s\S]*?layout\.selectPanel\(panel\)[\s\S]*?catch \(error\)[\s\S]*?return false/);
  assert.match(source, /if \(!selectPurgeHostPanel\(PURGE_PANEL_ID\)\) \{[\s\S]*?setDock\(\{ open: true, maximized: true/);
});

test("failed host navigation keeps the workspace visible", () => {
  assert.match(source, /if \(!selectPurgeHostPanel\(null\)\) \{\s*setNavigationError\([\s\S]*?\);\s*return;\s*\}\s*leaveWorkspace\(\)/);
});

test("a page render failure leaves navigation available and supports retry", () => {
  assert.match(source, /class PurgeWorkspaceBoundary extends Component/);
  assert.match(source, /static getDerivedStateFromError\(\) \{ return \{ failed: true \}; \}/);
  assert.match(source, /onClick: \(\) => this\.setState\(\{ failed: false \}\)/);
  assert.match(source, /h\(PurgeWorkspaceBoundary, \{ key: page \},\s*h\(PurgeWorkspaceContent, \{ page, t, onOpenReportSession, maskReportOrigin \}\)\)/);
  assert.match(css, /\.dshp-workspace-recovery\{/);
});

test("host panel access failures return false without hiding the workspace", () => {
  const start = source.indexOf("function selectPurgeHostPanel(");
  const end = source.indexOf("function showPurgeWorkspace(", start);
  assert.ok(start >= 0 && end > start);
  const make = new Function("purgeWorkspaceCtx", "console", source.slice(start, end) + "\nreturn selectPurgeHostPanel");
  const logger = { warn() {} };
  assert.equal(make({ get() { throw Error("host unavailable"); } }, logger)(null), false);
  assert.equal(make({ layout: { selectPanel() { throw Error("navigation denied"); } } }, logger)(null), false);
  let selected;
  assert.equal(make({ layout: { selectPanel(p) { selected = p; } } }, logger)(null), true);
  assert.equal(selected, null);
});
