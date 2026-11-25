#!/usr/bin/env node
/**
 * 把产出层洁净度接到产出路径上（幂等）。
 *
 *   node scripts/apply-hygiene-wiring.mjs           # --check：只报告锚点与已接线状态
 *   node scripts/apply-hygiene-wiring.mjs --write   # 就地接线（插入行带 [hygiene-wiring] 标记）
 *   node scripts/apply-hygiene-wiring.mjs --root DIR
 *
 * 为什么用脚本而不是直接改文件：`lib/index.js` 与 `lib/runtime-observations.js`
 * 常年带着未提交的本地改动，接线不该把那些改动一起卷进提交。脚本只做两处插入，
 * 带标记、可重复运行、锚点缺失就明确报错而不是猜位置。
 *
 * 两处改动：
 *   1. lib/index.js：import installOutputHygiene + 安装调用 + 释放调用
 *   2. lib/runtime-observations.js：import observeResponseText + 每行观测写入 responseHygiene
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MARK = "[hygiene-wiring]";

/**
 * 幂等判据：整份文件里已经出现该块的特征串就不再插入。
 * 用特征串而不是 MARK 行号，因为插入会移动行号；用特征串而不是相邻行，
 * 因为相邻行可能属于上一处插入。
 */
function insert(lines, position, predicates, payload, token, added, missing, label) {
  if (lines.some((line) => line.includes(token))) return;
  const rules = Array.isArray(predicates) ? predicates : [predicates];
  const index = lines.findIndex((line) => rules.some((rule) => rule(line)));
  if (index < 0) { missing.push(label); return; }
  lines.splice(position === "before" ? index : index + 1, 0, ...payload);
  added.push(label);
}

/**
 * lib/index.js：导入 + 安装 + 释放。
 * @param {string} source
 * @returns {{ text: string, added: string[], missing: string[] }}
 */
export function wireIndexSource(source) {
  const added = [];
  const missing = [];
  const lines = String(source || "").split("\n");
  insert(
    lines, "after",
    [
      (line) => /^import \{ installStreamWatch \} from "\.\/stream-watch\.js";/.test(line),
      (line) => /^import \* as obedience from "\.\/obedience\.js";/.test(line),
    ],
    ['import { installOutputHygiene } from "./output-hygiene-runtime.js"; // ' + MARK],
    "output-hygiene-runtime.js", added, missing, "index:import",
  );
  insert(
    lines, "before",
    [
      (line) => /^\s+const streamWatchRuntime = installStreamWatch\(ctx, \{/.test(line),
      (line) => /^\s+const obedienceRuntime = obedience\.installObedience\(ctx, \{/.test(line),
    ],
    [
      "  const outputHygieneRuntime = installOutputHygiene(ctx, {",
      "    log: (...args) => log(cfg, ...args),",
      "    logHome: obedienceHome,",
      "  }); // " + MARK,
    ],
    "const outputHygieneRuntime", added, missing, "index:install",
  );
  insert(
    lines, "after",
    [
      (line) => /try \{ streamWatchRuntime\?\.dispose\?\.\(\); \}/.test(line),
      (line) => /try \{ obedienceRuntime\?\.dispose\?\.\(\); \}/.test(line),
    ],
    ["      try { outputHygieneRuntime?.dispose?.(); } catch { /* ignore */ } // " + MARK],
    "outputHygieneRuntime?.dispose", added, missing, "index:dispose",
  );
  return { text: lines.join("\n"), added, missing };
}

/**
 * lib/runtime-observations.js：导入 + 每行的产出洁净度投影。
 * @param {string} source
 * @returns {{ text: string, added: string[], missing: string[] }}
 */
export function wireObservationsSource(source) {
  const added = [];
  const missing = [];
  const lines = String(source || "").split("\n");
  insert(
    lines, "after",
    (line) => /from '\.\/response-assessment\.js';/.test(line),
    ["import { observeResponseText } from './output-hygiene-runtime.js'; // " + MARK],
    "observeResponseText", added, missing, "observations:import",
  );
  insert(
    lines, "after",
    (line) => /Retain only the projected classification, never the source text\./.test(line),
    ["        // 同一段正文再投影一次产出洁净度（前言/残渣/章节体量），仍然不落原文。 // " + MARK,
      "        row.responseHygiene = observeResponseText(messageText(messageOf(event)));"],
    "row.responseHygiene", added, missing, "observations:row",
  );
  return { text: lines.join("\n"), added, missing };
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag >= 0 ? argv[rootFlag + 1] : path.resolve(process.cwd());

  const targets = [
    { file: path.join(root, "lib", "index.js"), wire: wireIndexSource },
    { file: path.join(root, "lib", "runtime-observations.js"), wire: wireObservationsSource },
  ];

  let failed = false;
  for (const target of targets) {
    if (!fs.existsSync(target.file)) {
      console.error(`missing file: ${target.file}`);
      failed = true;
      continue;
    }
    const before = fs.readFileSync(target.file, "utf8");
    const { text, added, missing } = target.wire(before);
    const rel = path.relative(root, target.file).replace(/\\/g, "/");
    if (missing.length) {
      console.error(`${rel}: 锚点缺失 → ${missing.join(", ")}`);
      failed = true;
    }
    if (added.length) {
      if (write) {
        fs.writeFileSync(target.file, text, "utf8");
        console.log(`${rel}: wired ${added.join(", ")}`);
      } else {
        console.log(`${rel}: 待接线 ${added.join(", ")}（--write 才落盘）`);
      }
    } else if (!missing.length) {
      console.log(`${rel}: 已接线，无需改动`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
