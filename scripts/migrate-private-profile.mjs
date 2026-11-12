#!/usr/bin/env node
import { findDshHome } from "../lib/core.js";
import { migratePrivateProfile } from "../lib/private-profile-migration.js";

const args = process.argv.slice(2);
const usage = "用法: node scripts/migrate-private-profile.mjs <profile> <完整SHA> --host-stopped [--pnpm <完整路径>]";
async function main() {
  if (args.includes("--help") || args.includes("-h")) { console.log(usage); return; }
  const [profile, sha, ...flags] = args;
  let pnpm, hostStopped = false;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--host-stopped") hostStopped = true;
    else if (flags[i] === "--pnpm" && flags[i + 1] && !flags[i + 1].startsWith("--")) pnpm = flags[++i];
    else throw new Error(usage);
  }
  if (!profile || !sha || !hostStopped) throw new Error(usage);
  const result = await migratePrivateProfile({ home: findDshHome(), profile, sha, hostStopped, pnpm });
  console.log(JSON.stringify(result, null, 2));
  console.log("安装来源及磁盘版本已核验；请重启 Harness 后核对实际运行版本。");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
