/**
 * 把 lib/redteam/client.js 抽成可嵌入的工厂片段，
 * 写进 client.js 的 DSH_PURGE_DRILL 标记之间，并同步工作区源码与样式。
 *
 * 用法：node scripts/build-client.mjs
 * 校验：node scripts/build-client.mjs --check（只比较，不写文件）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const drillSrc = join(root, "lib", "redteam", "client.js");
const clientPath = join(root, "client.js");
const workspaceSrc = join(root, "lib", "workspace", "client-shell.js");
const workspaceCssSrc = join(root, "lib", "workspace", "workspace.css");

const BEGIN = "/* __DSH_PURGE_DRILL_BEGIN__ */";
const END = "/* __DSH_PURGE_DRILL_END__ */";
const WORKSPACE_BEGIN = "/* __DSH_PURGE_WORKSPACE_BEGIN__ */";
const WORKSPACE_END = "/* __DSH_PURGE_WORKSPACE_END__ */";

let raw = readFileSync(drillSrc, "utf8").replace(/\r\n/g, "\n");
const startMark = "factory: (require) => {";
const start = raw.indexOf(startMark);
if (start < 0) throw new Error("cannot find ModuleLoader factory in drill client");
const endMark = "\n    return module.exports\n  },\n})";
const end = raw.lastIndexOf(endMark);
if (end < 0) throw new Error("cannot find factory end in drill client");
let body = raw.slice(start + startMark.length, end);

// 去掉末尾 exports（return 已在 endMark 外）
body = body
	.replace(/\n\s*exports\.apply\s*=\s*apply\s*\n/, "\n")
	.replace(/\n\s*exports\.inject\s*=\s*inject\s*\n/, "\n");

// 替换 apply(ctx)：不再自己注册槽位，只导出 Panel / CSS / 状态
const applyAt = body.lastIndexOf("function apply(ctx) {");
if (applyAt < 0) throw new Error("apply(ctx) not found in drill client");
// apply() 本体没有嵌套函数花括号冲突到 CSS（CSS 在前面），用括号深度即可
let d = 0;
let j = body.indexOf("{", applyAt);
for (; j < body.length; j += 1) {
	const ch = body[j];
	if (ch === "{") d += 1;
	else if (ch === "}") {
		d -= 1;
		if (d === 0) {
			j += 1;
			break;
		}
	}
}
const applyParts = `function applyDrillParts() {
      return { CSS: CSS, Panel: Panel, setUI: setUI, useUI: useUI, isFullWindow: isFullWindow, setDockWidth: setDockWidth, api: api };
    }
`;
body = body.slice(0, applyAt) + applyParts + body.slice(j);

const fragment = `${BEGIN}
		// 内嵌演练台（源码在 lib/redteam，已并进本插件）
		const __dshPurgeDrill = (() => {
			var module = { exports: {} };
			var exports = module.exports;
${body}
			return applyDrillParts();
		})();
${END}`;

let client = readFileSync(clientPath, "utf8");
if (!client.includes(BEGIN) || !client.includes(END)) {
	throw new Error("client.js missing drill markers; run patch-client-dock.mjs first");
}
const beginAt = client.indexOf(BEGIN);
const endAt = client.indexOf(END);
if (beginAt < 0 || endAt < 0 || endAt < beginAt) throw new Error("drill markers out of order");
let generated = client.slice(0, beginAt) + fragment + client.slice(endAt + END.length);

// Workspace source stays readable; the host still receives a single client.js.
const workspaceSource = readFileSync(workspaceSrc, "utf8").replace(/\r\n/g, "\n");
const workspaceCss = readFileSync(workspaceCssSrc, "utf8").replace(/\r\n/g, "\n");
const cssPlaceholder = 'const PURGE_WORKSPACE_CSS = "__DSH_PURGE_WORKSPACE_CSS__";';
if (workspaceSource.split(cssPlaceholder).length !== 2) throw new Error("workspace CSS placeholder missing or duplicated");
const workspaceBody = workspaceSource
  .replace(cssPlaceholder, "const PURGE_WORKSPACE_CSS = " + JSON.stringify(workspaceCss) + ";")
  .split("\n").map((line) => line ? "\t\t" + line : line).join("\n");
const workspaceFragment = WORKSPACE_BEGIN + "\n" + workspaceBody + WORKSPACE_END;
const workspaceBeginAt = generated.indexOf(WORKSPACE_BEGIN);
const workspaceEndAt = generated.indexOf(WORKSPACE_END);
if (workspaceBeginAt < 0 || workspaceEndAt < workspaceBeginAt) throw new Error("workspace markers missing or out of order");
generated = generated.slice(0, workspaceBeginAt) + workspaceFragment + generated.slice(workspaceEndAt + WORKSPACE_END.length);
// Shared quality report projection and native runtime panel have one source each.
const runtimeBegin = "/* __DSH_PURGE_RUNTIME_BEGIN__ */";
const runtimeEnd = "/* __DSH_PURGE_RUNTIME_END__ */";
const runtimeBody = readFileSync(join(root, "lib", "task-quality-report.js"), "utf8").replace(/^export /gm, "")
  + "\n" + readFileSync(join(root, "lib", "workspace", "runtime-panel.js"), "utf8");
const runtimeAt = generated.indexOf(runtimeBegin), runtimeEndAt = generated.indexOf(runtimeEnd);
if (runtimeAt < 0 || runtimeEndAt < runtimeAt) throw new Error("runtime panel markers missing");
generated = generated.slice(0, runtimeAt) + runtimeBegin + "\n" + runtimeBody.replace(/\r\n/g, "\n")
  + runtimeEnd + generated.slice(runtimeEndAt + runtimeEnd.length);
// Normalize line endings so a Windows checkout does not change the build identity.
// FNV-1a is an identity for stale UI detection, not a security signature.
const buildMarker = /const CLIENT_BUILD_ID = "[^"]*";/;
if (!buildMarker.test(generated)) throw new Error("client build marker missing");
const canonical = generated.replace(/\r\n/g, "\n").replace(buildMarker, 'const CLIENT_BUILD_ID = "";');
let buildHash = 0xcbf29ce484222325n;
for (let i = 0; i < canonical.length; i++) {
  buildHash = BigInt.asUintN(64, (buildHash ^ BigInt(canonical.charCodeAt(i))) * 0x100000001b3n);
}
generated = generated.replace(buildMarker, 'const CLIENT_BUILD_ID = "' + buildHash.toString(16).padStart(16, "0") + '";');
if (process.argv.includes("--check")) {
  if (generated !== client) {
    console.error("client.js is stale; run node scripts/build-client.mjs and commit the generated client.js");
    process.exitCode = 1;
  } else {
    console.log("client.js embedded drill matches lib/redteam/client.js and workspace source");
  }
} else {
  writeFileSync(clientPath, generated);
  console.log("embedded drill and workspace into client.js");
}
