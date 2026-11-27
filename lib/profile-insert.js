/**
 * 用户层 profile/cordis.patch.yml 的本体 insert（#154 / #159）。
 *
 * 包内 overlay 只改已入队行的 inject/config，不能再 insert 一次（Hub 已入队会
 * already queued）。postinstall 和演练台子行都走这里：行不存在就写一条。
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const PURGE_NAME = "dsh-purge";

/** 原子写：先写同目录 tmp 再 rename，避免崩在写中途把用户的 profile 配置截断。 */
function writeAtomic(fp, text) {
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, fp);
}

export const INSERT_BLOCK = [
  "- insert:",
  "    - id: dsh-purge",
  "      name: dsh-purge",
  "      inject: [systemPrompt, tools]",
  "      config:",
  "        enabled: true",
  "        stripMnemon: true",
  "        capabilityProtocol: true",
  "        hooksDenyBypass: false",
  "        hooksDenyBypassOptIn: false",
  "",
].join("\n");

/**
 * 用 YAML AST 判定 insert 块里是否已有本插件条目。
 *
 * 字符串匹配版会漏：带引号 `id: "dsh-purge"`、行尾注释 `id: dsh-purge  # note`、
 * flow 写法 `id: {name: dsh-purge}` 全都不命中 → 重复 apply 会追加第二块 insert。
 * yaml 是生产依赖（package.json dependencies），这里直接吃 AST。
 * 返回 true/false；文件结构不认识时返回 null，让调用方走"宁可不动"分支。
 */
export function profileHasPurgeBodyInsertAst(text) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  let doc;
  try {
    doc = YAML.parse(raw);
  } catch {
    return null; // 解析失败：不是我们能安全操作的 YAML，交给调用方保守处理
  }
  if (doc === null || doc === undefined) return false; // 纯注释/空文档：没有 insert，允许追加
  const items = [];
  if (Array.isArray(doc.insert)) {
    items.push(...doc.insert);
  } else if (doc.insert && typeof doc.insert === "object") {
    items.push(doc.insert);
  }
  // 顶层也可以是 `- insert:` 列表形态
  for (const entry of Array.isArray(doc) ? doc : []) {
    if (entry && typeof entry === "object") {
      if (Array.isArray(entry.insert)) items.push(...entry.insert);
      else if (entry.insert && typeof entry.insert === "object") items.push(entry.insert);
    }
  }
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "").trim();
    const name = String(item.name ?? "").trim();
    if (id === "dsh-purge" || id === "dsh-purge-main" || name === "dsh-purge") return true;
  }
  return false;
}

export function profileHasPurgeBodyInsert(text) {
  const lines = String(text || "").split(/\r?\n/);
  let insertIndent = -1;
  for (const line of lines) {
    if (/^-\s*insert:\s*$/.test(line) || /^\s+-\s*insert:\s*$/.test(line)) {
      insertIndent = (line.match(/^[ \t]*/) || [""])[0].length;
      continue;
    }
    if (insertIndent < 0) continue;
    const indent = (line.match(/^[ \t]*/) || [""])[0].length;
    const trimmed = line.trim();
    if (trimmed && indent <= insertIndent && /^-\s/.test(trimmed)) {
      insertIndent = -1;
      if (/^-\s*insert:\s*$/.test(trimmed)) {
        insertIndent = indent;
      }
      continue;
    }
    // 本体行：id: dsh-purge，或用户按 #159 临时绕过写的 dsh-purge-main / name: dsh-purge
    if (/^-\s*id:\s*dsh-purge(-main)?\s*$/.test(trimmed)) return true;
    if (/^-\s*name:\s*dsh-purge\s*$/.test(trimmed)) return true;
  }
  return false;
}

function recoverGeneratedEmptyOverlay(text) {
  // Old Purge appended its exact default block after the native "[]".
  // Never repair a malformed overlay containing any other user entries.
  const normalized = text.replace(/\r\n/g, "\n");
  const tail = "\n\n" + INSERT_BLOCK;
  if (!normalized.endsWith(tail)) return null;
  const head = normalized.slice(0, -tail.length);
  if (!/^(?:[ \t]*#[^\n]*\n|[ \t]*\n)*\[\][ \t]*$/u.test(head)) return null;
  return head.replace(/\[\][ \t]*$/u, "") + INSERT_BLOCK;
}

function isPatchList(text) {
  const doc = YAML.parseDocument(text);
  return doc.errors.length === 0 && YAML.isSeq(doc.contents);
}

export function ensureProfileBodyInsert(profileDir) {
  const fp = path.join(profileDir, "cordis.patch.yml");
  let text;
  try { text = fs.readFileSync(fp, "utf8"); } catch (error) {
    if (error?.code !== "ENOENT") {
      return { ok: false, wrote: false, path: fp, reason: "unreadable-patch-body" };
    }
    text = "";
  }
  const existing = profileHasPurgeBodyInsertAst(text);
  if (existing === true) return { ok: true, wrote: false, path: fp, detected: "ast" };
  const failure = { ok: false, wrote: false, path: fp, reason: "unrecognized-patch-body" };
  if (existing === null) {
    const recovered = recoverGeneratedEmptyOverlay(text);
    if (!recovered || !isPatchList(recovered)) return failure;
    writeAtomic(fp, recovered);
    return { ok: true, wrote: true, path: fp, detected: "generated-empty-overlay" };
  }
  const doc = YAML.parseDocument(text);
  if (doc.errors.length || (doc.contents && !YAML.isSeq(doc.contents))) return failure;
  // Keep existing block-list bytes and comments when a plain append is valid.
  // Flow lists such as [] require a structural insertion instead.
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  let next = text + prefix + (text ? "\n" : "") + INSERT_BLOCK;
  if (!isPatchList(next) && YAML.isSeq(doc.contents)) {
    const entry = YAML.parseDocument(INSERT_BLOCK).contents.items[0];
    doc.contents.add(entry);
    doc.contents.flow = false;
    next = doc.toString();
  }
  if (!isPatchList(next) || profileHasPurgeBodyInsertAst(next) !== true) return failure;
  writeAtomic(fp, next);
  return { ok: true, wrote: true, path: fp, detected: "ast" };
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function profileOwnsPurge(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const bundles = pkg?.dsh?.profile?.bundles;
  if (Array.isArray(bundles) && bundles.includes(PURGE_NAME)) return true;
  try {
    return fs.existsSync(path.join(dir, "node_modules", PURGE_NAME, "package.json"));
  } catch {
    return false;
  }
}

export function listProfileDirs(dshHome) {
  const root = path.join(dshHome || "", "profiles");
  const out = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return out; }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (fs.statSync(dir).isDirectory()) out.push(dir);
    } catch { /* skip */ }
  }
  return out;
}

export function ensureProfileBundles(profileDir) {
  const fp = path.join(profileDir, "package.json");
  const pkg = readJson(fp);
  if (!pkg) return { ok: false, wrote: false, path: fp };
  pkg.dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : {};
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === "object" ? pkg.dsh.profile : {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (bundles.includes(PURGE_NAME)) return { ok: true, wrote: false, path: fp };
  pkg.dsh.profile.bundles = [...bundles, PURGE_NAME];
  writeAtomic(fp, `${JSON.stringify(pkg, null, 2)}\n`);
  return { ok: true, wrote: true, path: fp };
}

function readPurgeTarball() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg?.dsh?.install?.tarball || "").trim();
  } catch {
    return "https://codeload.github.com/wxcvm/dsh-purge/tar.gz/refs/heads/master";
  }
}

/** pnpm 12 会给 tarball 单独写一行 `dsh-purge@https://...: set this to true or false`。只写包名不够。 */
export function purgePnpmBuildSpecs() {
  const specs = ["dsh-purge"];
  const tarball = readPurgeTarball();
  if (tarball) specs.push(`${PURGE_NAME}@${tarball}`);
  return specs;
}

/** pnpm 版本大号：pnpm 12 起来源键才是有效审批，pnpm 11 见到 URL 键会崩（#185/#209）。
 *  取自 pnpm 自己写的 `node_modules/.modules.yaml`；读不到再退 package.json，都没有返回 null。 */
function pnpmMajor(profileDir) {
  const dir = String(profileDir || "");
  if (!dir) return null;
  try {
    const text = fs.readFileSync(path.join(dir, "node_modules", ".modules.yaml"), "utf8");
    const m = text.match(/packageManager["']?[ \t]*:[ \t]*["']?pnpm@(\d+)/i);
    if (m) return Number(m[1]);
  } catch { /* 没装过 / 抽象 fs：往下看 package.json */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const m = String(pkg?.packageManager || "").match(/^pnpm@(\d+)/i);
    if (m) return Number(m[1]);
  } catch { /* ignore */ }
  return null;
}

/** 来源键（`dsh-purge@git+https://…` / `dsh-purge@https://…`）：pnpm 12 只认这种写法（#209）。 */
function isSourcePurgeAllowBuildKey(key) {
  const name = String(key || '').replace(/^['"]|['"]$/g, '');
  if (!name.startsWith(`${PURGE_NAME}@`)) return false;
  return name.slice(PURGE_NAME.length + 1).includes('://');
}

function isPurgeAllowBuildKey(key) {
  const name = String(key || "").replace(/^['"]|['"]$/g, "");
  return name === PURGE_NAME || name.startsWith(`${PURGE_NAME}@`);
}

function parseAllowBuildLine(line) {
  const m = String(line || "").match(/^[ \t]+(?:"([^"]+)"|'([^']+)'|(\S+?))[ \t]*:(?=[ \t]|$)[ \t]*(.*?)\s*$/);
  if (!m) return null;
  return { key: m[1] || m[2] || m[3], value: String(m[4] || "").trim() };
}

function formatAllowBuildLine(key) {
  return `  ${key}: true`;
}

/** 把 dsh-purge 写成 true，避免装别的插件还报 ERR_PNPM_IGNORED_BUILDS（#168）。
 *
 *  #185：pnpm 11 见到 `dsh-purge@https://…` 会当成版本联合，触发 ERR_PNPM_INVALID_VERSION_UNION 直接崩，
 *        所以 11 下只写裸包名。
 *  #209：但 pnpm 12 只认解析后的来源键，把用户的来源键删掉，它每次 add 都重新弹构建审批。
 *        因此按 profile 里 pnpm 的大版本决定：11 剥掉来源键，12+（或判断不出）原样保留。 */
export function rewritePnpmAllowBuilds(raw, profileDir) {
  const major = pnpmMajor(profileDir);
  const keepSources = major === null || major >= 12;
  const wanted = keepSources ? purgePnpmBuildSpecs() : [PURGE_NAME];
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return `allowBuilds:\n${wanted.map(formatAllowBuildLine).join("\n")}\n`;
  }
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^allowBuilds[ \t]*:/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    const prefix = text.endsWith("\n") ? "" : "\n";
    return `${text}${prefix}\nallowBuilds:\n${wanted.map(formatAllowBuildLine).join("\n")}\n`;
  }
  let end = lines.length;
  const kept = [];
  const seen = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      end = i;
      break;
    }
    if (/^\S/.test(line)) {
      end = i;
      break;
    }
    const parsed = parseAllowBuildLine(line);
    if (!parsed) {
      kept.push(line);
      continue;
    }
    if (isPurgeAllowBuildKey(parsed.key)) {
      // A truncated URL is not a valid pnpm version selector.
      if (/^dsh-purge@https?$/.test(parsed.key)) continue;
      // pnpm 11 下来源键会让 install 崩（#185）；到 12 才开始认它（#209）。
      if (!keepSources && isSourcePurgeAllowBuildKey(parsed.key)) continue;
      if (seen.has(parsed.key)) continue;
      kept.push(formatAllowBuildLine(parsed.key));
      seen.add(parsed.key);
      continue;
    }
    kept.push(line);
  }
  for (const key of wanted) {
    if (!seen.has(key)) kept.push(formatAllowBuildLine(key));
  }
  const next = [...lines.slice(0, start + 1), ...kept, ...lines.slice(end)].join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

/** pnpm 11/12 默认拦 postinstall（ERR_PNPM_IGNORED_BUILDS）。写进 profile 的 allowBuilds，下次 add 能跑脚本。 */
export function ensurePnpmAllowBuild(profileDir) {
  const fp = path.join(profileDir, "pnpm-workspace.yaml");
  let text = "";
  try { text = fs.readFileSync(fp, "utf8"); } catch { text = ""; }
  const current = String(text || "").replace(/\r\n/g, "\n");
  const next = rewritePnpmAllowBuilds(current, profileDir);
  if (next === current) return { ok: true, wrote: false, path: fp };
  writeAtomic(fp, next);
  return { ok: true, wrote: true, path: fp };
}

/** 已装进 bundles / node_modules 但缺 insert 的 profile，补上本体行。 */
export function ensureAllProfileBodyInserts(dshHome) {
  return ensureAllProfileInstall(dshHome).map((item) => ({
    dir: item.dir,
    ok: item.ok,
    wrote: Boolean(item.insert?.wrote),
    path: item.insert?.path || path.join(item.dir || "", "cordis.patch.yml"),
    error: item.error,
  }));
}

/** bundles + 本体 insert + pnpm allowBuilds。postinstall 被跳过、升级覆盖 overlay 之后靠这条把按钮找回来。 */
export function ensureAllProfileInstall(dshHome) {
  const results = [];
  for (const dir of listProfileDirs(dshHome)) {
    if (!profileOwnsPurge(dir)) continue;
    try {
      const bundles = ensureProfileBundles(dir);
      const insert = ensureProfileBodyInsert(dir);
      const pnpm = ensurePnpmAllowBuild(dir);
      results.push({ dir, ok: true, bundles, insert, pnpm });
    } catch (error) {
      results.push({
        dir,
        ok: false,
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  return results;
}

/** 丢掉 insert 块里属于本插件的列表项（`- id: dsh-purge` / `- name: dsh-purge`）。 */
function dropPurgeInsertEntries(block) {
  const out = [];
  let i = 0;
  while (i < block.length) {
    const line = block[i];
    const head = line.match(/^([ \t]*)-[ \t]*(.*)$/);
    if (!head) {
      out.push(line);
      i += 1;
      continue;
    }
    const itemIndent = head[1].length;
    let end = i + 1;
    while (end < block.length) {
      const next = block[end];
      if (!next.trim()) {
        end += 1;
        continue;
      }
      const indent = (next.match(/^[ \t]*/) || [""])[0].length;
      if (indent <= itemIndent) break;
      end += 1;
    }
    const body = head[2].trim();
    const owned = /^id:[ \t]*dsh-purge(-main)?[ \t]*$/.test(body) || /^name:[ \t]*dsh-purge[ \t]*$/.test(body);
    if (!owned) out.push(...block.slice(i, end));
    i = end;
  }
  return out;
}

/**
 * ensureProfileBodyInsert 的反向操作（#199 卸载残留）。
 *
 * 卸载只摘 bundles / dependencies，`- insert: - id: dsh-purge` 会永远留在用户的
 * cordis.patch.yml 里，宿主下次启动仍去解析一个已被删掉的插件。这里按行摘除：
 * 先删块内的 dsh-purge 列表项；整块空了就连 `- insert:` 头一起删。
 */
export function removeProfileBodyInsert(profileDir) {
  const fp = path.join(String(profileDir || ""), "cordis.patch.yml");
  let text = "";
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    return { ok: true, removed: 0, path: fp, wrote: false };
  }
  const lines = text.split(/\r?\n/);
  const out = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^([ \t]*)-[ \t]*insert:[ \t]*$/);
    if (!head) {
      out.push(lines[i]);
      continue;
    }
    const insertIndent = head[1].length;
    let end = i + 1;
    while (end < lines.length) {
      const next = lines[end];
      if (!next.trim()) {
        end += 1;
        continue;
      }
      const indent = (next.match(/^[ \t]*/) || [""])[0].length;
      if (indent <= insertIndent) break;
      end += 1;
    }
    const block = lines.slice(i + 1, end);
    const kept = dropPurgeInsertEntries(block);
    if (kept.length === block.length) {
      out.push(lines[i]);
      i = end - 1;
      continue;
    }
    removed += 1;
    if (kept.some((line) => line.trim())) {
      out.push(lines[i], ...kept);
    } else if (out.length && !out[out.length - 1].trim()) {
      out.pop();
    }
    i = end - 1;
  }
  if (!removed) return { ok: true, removed: 0, path: fp, wrote: false };
  writeAtomic(fp, out.join("\n"));
  return { ok: true, removed, path: fp, wrote: true };
}
