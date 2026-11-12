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
  assert.match(source, /const back = \(\) => \{[\s\S]{0,700}document\.exitFullscreen\(\)[\s\S]{0,300}setWorkspaceVisible\(false\)/);
});
