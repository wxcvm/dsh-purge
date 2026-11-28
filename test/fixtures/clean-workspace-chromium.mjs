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
const drill = readFileSync(new URL("../../lib/redteam/client.js", import.meta.url), "utf8");
const drillCss = drill.split("const CSS = " + String.fromCharCode(96))[1]?.split(String.fromCharCode(96))[0];
assert.ok(drillCss, "missing environment stylesheet");
const css = template("PURGE_CSS") + JSON.parse(workspaceLiteral) +
  template("PURGE_WORKSPACE_PAINT_CSS") + template("PURGE_PROMPT_PAGE_CSS") + drillCss;

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
  const env = $("#env-probe");
  const http = $("#http-probe");
  const details = $("#http-probe details");
  const closedHeight = details.offsetHeight;
  details.querySelector("summary").click();
  const disclosuresWork = details.open && details.offsetHeight > closedHeight;
  const probeLayout = () => {
    const envPane = $("#env-probe .rt-pane");
    const envIssue = $("#env-probe .rt-env-issues");
    const row = $("#http-probe .dshp-http-row");
    return { envFits: envPane.scrollWidth <= envPane.clientWidth + 1
        && envIssue.scrollWidth <= envIssue.clientWidth + 1,
      httpFits: http.scrollWidth <= http.clientWidth + 1 && row.scrollWidth <= row.clientWidth + 1 };
  };
  const wideProbe = probeLayout();
  env.style.width = http.style.width = "330px";
  const narrowProbe = probeLayout();
  $("#result").textContent = JSON.stringify({ wide, narrow, inlineFilter, dialogFilter, compactFilter,
    hostWideFilter, hostWideDialog, focusWorks, scrolled, wideProbe, narrowProbe, disclosuresWork });
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
  <section id="http-probe" class="dshp-root" style="width:920px;box-sizing:border-box">
    <dl class="dshp-observation-counts"><div><dt>近期请求</dt><dd>50</dd></div>
    <div><dt>宿主记录 HTTP 403</dt><dd>1</dd></div><div><dt>HTTP 状态未观测</dt><dd>49</dd></div></dl>
    <ul class="dshp-http-rows"><li class="dshp-http-row"><strong>请求 1 · HTTP 503</strong>
    <p class="dshp-runtime-meta">终态：error · 运行结果：error · 来源：host-stream</p></li></ul>
    <details class="dshp-diagnostic-details"><summary>观测范围与来源</summary>
    <p>最近读取的终态元数据</p></details>
  </section>
  <section id="env-probe" class="rt-dock rt-embedded" style="width:920px;height:580px;box-sizing:border-box">
    <div class="rt-main rt-env-main"><div class="rt-toolbar rt-env-status"><strong>环境中心</strong>
    <span class="rt-spacer"></span><span class="rt-tag">有未保存修改</span><button class="rt-btn">刷新本机配置</button></div>
    <div class="rt-toolbar rt-env-tabs"><button class="rt-btn rt-btn-primary">环境总览</button>
    <button class="rt-btn">工具管理</button><button class="rt-btn">执行环境</button><button class="rt-btn">诊断与修复</button>
    <details class="rt-env-more"><summary class="rt-btn">更多设置</summary><div><button class="rt-btn">网络配置</button></div></details></div>
    <div class="rt-pane"><section class="rt-card rt-env-check"><h4>本机配置检查</h4>
    <ul class="rt-env-issues"><li><span class="rt-env-meta">不可用的搜索目录：D:/sample/diagnostics/fixture-very-long-folder-name-do-not-wrap-in-the-middle</span>
    <button class="rt-btn">编辑搜索目录</button></li></ul></section></div></div>
  </section>
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
  assert.deepEqual(result.wideProbe, { envFits: true, httpFits: true });
  assert.deepEqual(result.narrowProbe, { envFits: true, httpFits: true });
  assert.equal(result.disclosuresWork, true);
} finally {
  assert.equal(path.dirname(realpathSync(scratch)), parent);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
