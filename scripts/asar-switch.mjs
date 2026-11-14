#!/usr/bin/env node
/**
 * asar-switch.mjs — 让 `resources/app/` 真正被加载（或改回去）。
 *
 * 为什么要有这个脚本：`app.asar` 被跑着的 Electron 打开着，进程内 rename 一定 EPERM。
 * 所以「让 asar 让位」只能在应用关掉之后做——这就是本脚本存在的理由，
 * 也是 `~/.dsh/dsh-purge/asar-swap-watch.ps1`（2026-10-30 成功过一次，后来被自动更新写回）的替代品。
 *
 * 用法：
 *   node scripts/asar-switch.mjs status
 *   node scripts/asar-switch.mjs off        # app.asar → app.asar.dshpurge.bak
 *   node scripts/asar-switch.mjs restore    # 改回去
 *   node scripts/asar-switch.mjs status --resources "D:/dsh/resources"
 *
 * 退出码：0 成功 / 1 失败（失败时打印原因，不会留下半完成状态）。
 */
import path from "node:path";
import process from "node:process";

import { describe, ensureAppDirActive, inspect, rollback, guessResourcesDir } from "../lib/asar-mode.js";

const argv = process.argv.slice(2);
const action = (argv[0] || "status").toLowerCase();
const resourcesIndex = argv.indexOf("--resources");
const resourcesDir = resourcesIndex >= 0 ? argv[resourcesIndex + 1] : (guessResourcesDir() || "");
const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh");

if (!resourcesDir) {
  console.error("找不到 resources 目录；用 --resources 指定（形如 <安装目录>/resources）");
  process.exit(1);
}

const print = (label, value) => console.log(`${label}: ${value}`);

if (action === "status") {
  const info = describe(resourcesDir, dshHome);
  print("resources", resourcesDir);
  print("形态", info.text);
  if (info.state) {
    print("  app.asar", info.state.asarPresent ? info.state.asarPath : "(无)");
    print("  app/", info.state.appPresent ? info.state.appDir : "(缺 package.json(main) 或 lib/main.js)");
    print("  备份", info.state.backupPresent ? info.state.backupPath : "(无)");
    print("  标记", info.patched ? "已读到 [dsh-purge]" : "未读到 [dsh-purge]");
  }
  process.exit(info.level === "bad" ? 1 : 0);
}

if (action === "off") {
  const result = ensureAppDirActive({ resourcesDir, dshHome, log: (...args) => console.log(...args) });
  print("结果", result.action);
  if (result.detail) print("原因", result.detail);
  if (result.backup) print("备份", result.backup);
  console.log(describe(resourcesDir, dshHome).text);
  process.exit(result.ok ? 0 : 1);
}

if (action === "restore") {
  const result = rollback({ resourcesDir, dshHome });
  print("结果", result.action);
  if (result.detail) print("原因", result.detail);
  console.log(describe(resourcesDir, dshHome).text);
  process.exit(result.ok ? 0 : 1);
}

if (action === "inspect") {
  console.log(JSON.stringify(inspect(resourcesDir), null, 2));
  process.exit(0);
}

console.error(`未知动作: ${action}（status | off | restore | inspect）`);
process.exit(1);
