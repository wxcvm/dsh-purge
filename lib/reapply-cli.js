import { reapplyInstalled } from "./reapply.js";

// CLI 是诊断/手动重放入口：默认绝不触发 app.asar 换名重启（reapply.js 默认会
// scheduleSealedDesktopRestart，终端里跑一次就可能把桌面端弄重启）。
// 需要 swap 时显式 --swap。
const result = await reapplyInstalled({ scheduleSwap: process.argv.includes("--swap") });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
