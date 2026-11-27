import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Opt-in computed browser layout test, not a mock of Windows Electron paint.
const executable = process.argv[2];
if (!executable) throw new Error("Usage: node test/fixtures/clean-workspace-chromium.mjs CHROMIUM_EXECUTABLE");
const client = readFileSync(new URL("../../client.js", import.meta.url), "utf8");
function template(name) {
  const match = client.match(new RegExp("const " + name + " = `([^`]+)`;"));
  assert.ok(match, "Missing stylesheet: " + name);
  return match[1];
}
const workspaceLiteral = client.match(/const PURGE_WORKSPACE_CSS = ("[^\n]+");/)?.[1];
assert.ok(workspaceLiteral, "missing workspace stylesheet");
const css = template("PURGE_CSS") + JSON.parse(workspaceLiteral) +
  template("PURGE_WORKSPACE_PAINT_CSS") + template("PURGE_PROMPT_PAGE_CSS");

// Fixture deliberately executes none of the bundled JavaScript or transport.
function measure() {
  const $ = selector => document.querySelector(selector);
  const host = $(".paint-host");
  const shell = $(".dshp-workspace");
  const main = $("main");
  const input = $("#editor");
  const filter = selector => getComputedStyle($(selector)).backdropFilter;
  const geometry = () => {
    const columns = $(".dshp-prompt-columns").getBoundingClientRect();
    const left = $(".dshp-prompt-global").getBoundingClientRect();
    const right = $(".dshp-prompt-local").getBoundingClientRect();
    return { sideBySide: right.left > left.right,
      usesWidth: Math.abs(columns.right - right.right) < 2,
      navDirection: getComputedStyle($(".dshp-clean-nav")).flexDirection,
      horizontalOverflow: main.scrollWidth > main.clientWidth + 1 };
  };
  const wide = geometry();
  const inlineFilter = filter("#editor");
  const dialogFilter = filter("#dialog-field");
  const compactFilter = filter("#compact-field");
  host.style.width = "650px";
  const narrow = geometry();
  input.focus({ preventScroll: true });
  const focusWorks = document.activeElement === input;
  main.scrollTop = main.scrollHeight;
  const bottom = $("#bottom").getBoundingClientRect();
  const scrolled = main.scrollTop > 0 && bottom.bottom <= main.getBoundingClientRect().bottom;
  shell.dataset.defaultFull = "1";
  const hostWideFilter = filter("#editor");
  const hostWideDialog = filter("#dialog-field");
  $("#result").textContent = JSON.stringify({ wide, narrow, inlineFilter, dialogFilter, compactFilter,
    hostWideFilter, hostWideDialog, focusWorks, scrolled });
}

const parent = realpathSync(tmpdir());
const scratch = mkdtempSync(path.join(parent, "purge-ui-browser-"));
try {
  const html = path.join(scratch, "paint.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <style>html,body{margin:0}.paint-host{width:1160px;height:400px;position:relative}` + css + `</style>
  <div class="paint-host"><section class="dshp-dock dshp-workspace" data-maximized="1" data-workspace="clean">
    <header class="dshp-workspace-nav">Purge</header><div class="dshp-dock-body">
    <div class="dshp-root dshp-clean-workspace"><nav class="dshp-clean-nav"><button>Settings</button></nav>
    <main class="dshp-clean-content"><div class="dshp-prompt-page"><div class="dshp-prompt-columns">
      <section class="dshp-prompt-global"><textarea class="dshp-area" id="editor">Review the wording.</textarea></section>
      <section class="dshp-prompt-local"><input class="dshp-field" value="Writing"></section>
    </div></div>
    <div role="dialog" hidden><input class="dshp-field" id="dialog-field"></div>
    <div style="height:540px"></div><button id="bottom">Save</button>
    </main></div></div></section></div>
  <div class="dshp-dock" hidden><input class="dshp-field" id="compact-field"></div>
  <output id="result"></output><script>(` + measure.toString() + `)();</script>`);
  const dom = execFileSync(executable, ["--headless", "--disable-background-networking", "--disable-extensions",
    "--disable-sync", "--no-first-run", "--no-default-browser-check", "--window-size=1440,850",
    "--force-device-scale-factor=1", "--user-data-dir=" + path.join(scratch, "profile"),
    "--dump-dom", pathToFileURL(html).href],
  { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const result = JSON.parse(dom.match(/<output id="result">(.*?)<\/output>/)?.[1] || "null");
  assert.ok(result, "Chromium failed to evaluate the layout fixture");
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.wide, { sideBySide: true, usesWidth: true, navDirection: "column", horizontalOverflow: false });
  assert.deepEqual(result.narrow, { sideBySide: false, usesWidth: true, navDirection: "row", horizontalOverflow: false });
  assert.equal(result.inlineFilter, "none");
  assert.equal(result.hostWideFilter, "none");
  for (const filter of [result.dialogFilter, result.hostWideDialog, result.compactFilter]) assert.match(filter, /blur\(/);
  assert.equal(result.focusWorks, true);
  assert.equal(result.scrolled, true);
} finally {
  assert.equal(path.dirname(realpathSync(scratch)), parent);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
