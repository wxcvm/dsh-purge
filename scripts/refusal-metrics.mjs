#!/usr/bin/env node
/**
 * 恢复指标 CLI。
 *
 *   node scripts/refusal-metrics.mjs            # 人类可读
 *   node scripts/refusal-metrics.mjs --json     # 机器可读
 *   node scripts/refusal-metrics.mjs --home DIR # 指定 DSH_HOME
 *
 * 数据来源：$DSH_HOME/dsh-purge/{refusal,stream-watch,upstream}.log
 * 只读聚合，退出码恒为 0（没有日志也算正常：全是 0）。
 */
import { readRecoveryLogs, summarizeRecovery, formatRecoverySummary } from '../lib/refusal-metrics.js';

const argv = process.argv.slice(2);
const homeFlag = argv.indexOf('--home');
const home = homeFlag >= 0 ? argv[homeFlag + 1] : (process.env.DSH_HOME || '');

const logs = readRecoveryLogs(home);
const summary = summarizeRecovery(logs);

if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ home, ...summary }, null, 2)}\n`);
else {
  console.log(`home: ${home || '(未设置 DSH_HOME)'}\n`);
  console.log(formatRecoverySummary(summary));
}
