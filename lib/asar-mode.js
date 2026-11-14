/**
 * 让 `resources/app/` 真正被加载（asar 让位）
 *
 * 事实：`lib/core.js` 的补丁全部写在解开目录 `resources/app/dsh/node_modules/**` 里，
 * 而 Electron 的默认应用解析顺序是 `resources/app.asar` → `resources/app`。
 * 只要 asar 还在，56 条已打补丁就是死代码——`purge_status` 自己也会报
 * 「✗ app.asar: 还在。补丁写在解开目录，当前进程读不到」。
 *
 * 历史上这件事成功过一次（`~/.dsh/dsh-purge/asar-swap.log` 2026-10-30），之后桌面自动更新
 * 又把 asar 写回来了，于是所有代码补丁再次失效。所以这里做成可重复、可回滚的一步：
 *
 *   1. 校验 `app/package.json`（要有 main）和 `app/lib/main.js`——不校验就改名，
 *      启动时 Electron 会落回 `default_app.asar`（白屏），比不生效更糟。
 *   2. 关掉应用后把 `app.asar` 改名成 `app.asar.dshpurge.bak`（不删除，回滚就是改回来）。
 *   3. 写收据 `$DSH_HOME/dsh-purge/asar-mode.json`，记录改名时间与备份路径。
 *
 * 插件层（stream-guard / obedience）不依赖这一步，它是给线级补丁 #89–#93 用的。
 */
import fs from "node:fs";
import path from "node:path";

export const ASAR_NAME = "app.asar";
export const BACKUP_SUFFIX = ".dshpurge.bak";
export const RECEIPT_FILE = "asar-mode.json";

/** 补丁写进解开目录后的标记：读到它就说明 `app/` 已经被清洗过。 */
const PATCH_MARKER = "[dsh-purge";
const MARKER_PROBE = [
  ["dsh", "node_modules", "@deepseek-ai", "dsh-llm-deepseek", "lib", "index.js"],
  ["dsh", "node_modules", "@deepseek-ai", "dsh-agent-loop", "lib", "index.js"],
];

/**
 * 猜 resources 目录。Electron 主进程里 `process.resourcesPath` 就是它；
 * 纯 node（web / headless profile）下退回到 exe 同级的 resources。
 */
export function guessResourcesDir() {
  const fromProcess = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  if (fromProcess && (fs.existsSync(path.join(fromProcess, ASAR_NAME)) || fs.existsSync(path.join(fromProcess, "app")))) {
    return fromProcess;
  }
  try {
    const beside = path.join(path.dirname(process.execPath), "resources");
    if (fs.existsSync(path.join(beside, ASAR_NAME)) || fs.existsSync(path.join(beside, "app"))) return beside;
  } catch { /* ignore */ }
  /* 纯 node（web / headless profile）下上面两条都不成立。
     退回到 purge 自己记的桌面安装目录：$DSH_HOME/dsh-purge/desktop-install.txt 里是一行安装目录。 */
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh");
  const hint = path.join(home, "dsh-purge", "desktop-install.txt");
  try {
    if (fs.existsSync(hint)) {
      const install = fs.readFileSync(hint, "utf8").trim().replace(/[\\/]+$/, "");
      if (install) {
        const candidate = path.join(install, "resources");
        if (fs.existsSync(path.join(candidate, ASAR_NAME)) || fs.existsSync(path.join(candidate, "app"))) return candidate;
      }
    }
  } catch { /* ignore */ }
  return "";
}

export function receiptPathOf(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", RECEIPT_FILE);
}

/**
 * 看当前到底会加载哪一份。
 * @param {string} resourcesDir
 */
export function inspect(resourcesDir) {
  const dir = String(resourcesDir || "");
  const asarPath = path.join(dir, ASAR_NAME);
  const backupPath = `${asarPath}${BACKUP_SUFFIX}`;
  const appDir = path.join(dir, "app");
  const asarPresent = fs.existsSync(asarPath);
  const backupPresent = fs.existsSync(backupPath);
  const appPackage = path.join(appDir, "package.json");
  const appMain = path.join(appDir, "lib", "main.js");
  const appPresent = fs.existsSync(appPackage) && fs.existsSync(appMain);
  let appMainDeclared = false;
  try {
    if (appPresent) appMainDeclared = Boolean(JSON.parse(fs.readFileSync(appPackage, "utf8")).main);
  } catch { /* ignore */ }
  return {
    resourcesDir: dir,
    asarPath,
    backupPath,
    appDir,
    asarPresent,
    backupPresent,
    appPresent,
    appMainDeclared,
    /** 'asar' = 补丁读不到；'app' = 补丁生效；'none' = 目录都不对 */
    active: asarPresent ? "asar" : appPresent ? "app" : "none",
  };
}

/** `app/` 里是否已经有清洗标记。 */
export function patchedInAppDir(resourcesDir) {
  const dir = String(resourcesDir || "");
  for (const rel of MARKER_PROBE) {
    const fp = path.join(dir, "app", ...rel);
    try {
      const text = fs.readFileSync(fp, "utf8");
      if (text.includes(PATCH_MARKER)) return { patched: true, path: fp };
    } catch { /* 文件不在就试下一个 */ }
  }
  return { patched: false, path: "" };
}

function writeReceipt(dshHome, payload) {
  const fp = receiptPathOf(dshHome);
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = `${fp}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, fp);
    return fp;
  } catch {
    return "";
  }
}

function readReceipt(dshHome) {
  try {
    return JSON.parse(fs.readFileSync(receiptPathOf(dshHome), "utf8"));
  } catch {
    return null;
  }
}

/**
 * 让 `resources/app/` 生效：需要在**应用关闭**时调用（文件被占用时 rename 会 EPERM）。
 * @param {{ resourcesDir?: string, dshHome?: string, dryRun?: boolean, log?: (...a:any[])=>void }} options
 */
export function ensureAppDirActive(options = {}) {
  const log = typeof options.log === "function" ? options.log : () => {};
  const resourcesDir = options.resourcesDir || guessResourcesDir();
  if (!resourcesDir) return { ok: false, action: "no-resources", detail: "找不到 resources 目录" };

  const state = inspect(resourcesDir);
  if (!state.asarPresent && state.appPresent) {
    return { ok: true, action: "already-app", state };
  }
  if (!state.appPresent || !state.appMainDeclared) {
    // 没有可回退的 app/：改掉 asar 只会让 Electron 落回 default_app.asar。
    return { ok: false, action: "no-app-dir", detail: "app/ 缺少 package.json(main) 或 lib/main.js", state };
  }
  if (options.dryRun) return { ok: true, action: "would-rename", state };

  if (state.backupPresent) {
    // 上一轮的备份还在：直接覆盖会丢掉原始 asar。
    try {
      fs.rmSync(state.backupPath, { force: true });
    } catch (error) {
      return { ok: false, action: "backup-locked", detail: String(error && error.message ? error.message : error), state };
    }
  }
  try {
    fs.renameSync(state.asarPath, state.backupPath);
  } catch (error) {
    return { ok: false, action: "rename-failed", detail: String(error && error.message ? error.message : error), state };
  }
  const receipt = {
    at: new Date().toISOString(),
    action: "asar->bak",
    resourcesDir,
    next: inspect(resourcesDir),
    previous: state,
  };
  const fp = writeReceipt(options.dshHome, receipt);
  log("asar-mode: renamed app.asar → app.asar.dshpurge.bak", fp);
  return { ok: true, action: "renamed", backup: state.backupPath, receipt: fp, state: receipt.next };
}

/** 回滚：把备份改回 asar（同样要在应用关闭时做）。 */
export function rollback(options = {}) {
  const resourcesDir = options.resourcesDir || guessResourcesDir();
  if (!resourcesDir) return { ok: false, action: "no-resources" };
  const state = inspect(resourcesDir);
  if (!state.backupPresent) return { ok: false, action: "no-backup", state };
  if (state.asarPresent) return { ok: true, action: "already-restored", state };
  try {
    fs.renameSync(state.backupPath, state.asarPath);
  } catch (error) {
    return { ok: false, action: "rename-failed", detail: String(error && error.message ? error.message : error), state };
  }
  writeReceipt(options.dshHome, { at: new Date().toISOString(), action: "bak->asar", resourcesDir, next: inspect(resourcesDir) });
  return { ok: true, action: "restored", state: inspect(resourcesDir) };
}

/** 状态页用的一句话。 */
export function describe(resourcesDir, dshHome) {
  const dir = resourcesDir || guessResourcesDir();
  if (!dir) return { level: "unknown", text: "resources 目录未知" };
  const state = inspect(dir);
  const patched = patchedInAppDir(dir);
  const receipt = readReceipt(dshHome);
  if (state.active === "app") {
    return {
      level: patched.patched ? "ok" : "warn",
      text: patched.patched ? "✓ app/ 生效（补丁可读）" : "✓ app/ 生效，但没读到 [dsh-purge] 标记（补丁还没打）",
      state,
      patched: patched.patched,
      receipt,
    };
  }
  if (state.active === "asar") {
    return {
      level: "bad",
      text: "✗ app.asar 还在。补丁写在解开目录，当前进程读不到",
      state,
      patched: patched.patched,
      receipt,
    };
  }
  return { level: "unknown", text: "既没有 app.asar 也没有可用的 app/", state, patched: patched.patched, receipt };
}
