import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import {
  findDshHome,
  defaultOverrideText,
  hangOperatorPrompt,
  hungOperatorPrompt,
  normalizeOverride,
  peekCommittedOverride,
  readPromptInjectFileSync,
  hashOverride,
  defaultOverrideHash,
  atomicWriteFile,
  atomicCopyFile,
} from "./core.js";

const RULE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MAX_RULE_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 64;
export const RULE_TARGETS = ["AGENTS.md", "CLAUDE.md"];
const BACKUP_SUFFIX = ".dsh-purge-rule.bak";

// CWD 规则:扫 cwd → projectRoot 范围内的工作区指令文件,给 UI 展示并允许勾选参与注入。
// 命中与 @deepseek-ai/dsh-agent-instructions 的默认候选保持一致。
const CWD_CANDIDATE_FILES = ["AGENTS.md", "CLAUDE.md", "AGENTS.local.md", "CLAUDE.local.md"];
const PROJECT_ROOT_MARKERS = [".git", ".hg", ".svn"];
export const WORKSPACE_POLICIES = ["fallback", "strict", "always"];
const DEFAULT_WORKSPACE_POLICY = "fallback";
export const WORKSPACE_RULE_MODES = ["fallback", "combine"];
const KNOWN_AGENT_PRESETS = ["standard", "ptc", "minimal", "cordis", "redteam"];
const emptyFileScope = () => ({
  allowModels: [], blockModels: [], allowProviders: [], blockProviders: [],
  restrictPresets: false, presets: [], includeOtherPresets: true,
});
function normalizeFileScope(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const lines = key => [...new Set((Array.isArray(src[key]) ? src[key] : [])
    .filter(x => typeof x === "string").map(x => x.trim()).filter(Boolean))];
  return {
    ...emptyFileScope(),
    allowModels: lines("allowModels"), blockModels: lines("blockModels"),
    allowProviders: lines("allowProviders"), blockProviders: lines("blockProviders"),
    restrictPresets: src.restrictPresets === true,
    presets: lines("presets"),
    includeOtherPresets: src.includeOtherPresets !== false,
  };
}
function globMatch(value, pattern) {
  if (!value || !pattern) return false;
  const actual = value.toLowerCase(), glob = pattern.toLowerCase();
  if (!glob.includes("*")) return actual === glob;
  const chunks = glob.split("*");
  let at = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) continue;
    const found = actual.indexOf(chunks[i], at);
    if (found < 0 || (i === 0 && !glob.startsWith("*") && found !== 0)) return false;
    at = found + chunks[i].length;
  }
  return glob.endsWith("*") || actual.endsWith(chunks.at(-1));
}
function fileScopeReason(scope, { model = "", provider = "", preset = "" } = {}) {
  const has = (values, input) => values.some(pattern => globMatch(String(input), pattern));
  // Explicit exclusions always take precedence over inclusions.
  if (has(scope.blockModels, model)) return "model-blocked";
  if (has(scope.blockProviders, provider)) return "provider-blocked";
  if (scope.allowModels.length && !model) return "model-unobserved";
  if (scope.allowProviders.length && !provider) return "provider-unobserved";
  if (scope.allowModels.length && !has(scope.allowModels, model)) return "model-not-allowed";
  if (scope.allowProviders.length && !has(scope.allowProviders, provider)) return "provider-not-allowed";
  if (scope.restrictPresets) {
    if (!preset) return "preset-unobserved";
    const normalized = preset === "code" ? "ptc" : preset === "creator" ? "cordis" : preset;
    if (KNOWN_AGENT_PRESETS.includes(normalized)) {
      if (!scope.presets.includes(normalized)) return "preset-not-allowed";
    } else if (!scope.includeOtherPresets) return "preset-not-allowed";
  }
  return null;
}
const observedAssemblies = new Map();
const MAX_CWD_WALK_DEPTH = 32;
const MAX_LOCAL_INJECT_BYTES = 512 * 1024;

export { findDshHome };

function purgeStateDir(dshHome) {
  return path.join(dshHome, "dsh-purge");
}

function cwdSelectionsPath(dshHome) {
  return path.join(purgeStateDir(dshHome), "cwd-selections.json");
}

function workspacePolicyPath(dshHome) {
  return path.join(purgeStateDir(dshHome), "workspace-policy.json");
}

function lastCwdPath(dshHome) {
  return path.join(purgeStateDir(dshHome), "last-cwd.txt");
}

export function rulesDir(dshHome) {
  return path.join(dshHome, "rules");
}

export function stateFile(dshHome) {
  return path.join(rulesDir(dshHome), "state.json");
}

export function rulePath(dshHome, id) {
  return path.join(rulesDir(dshHome), id + ".md");
}

export function ruleMetaPath(dshHome, id) {
  return path.join(rulesDir(dshHome), id + ".json");
}

export function validRuleId(id) {
  return typeof id === "string" && RULE_ID_RE.test(id);
}

export function validTarget(target) {
  return typeof target === "string" && RULE_TARGETS.includes(target);
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

export function targetPath(dshHome, target) {
  if (!validTarget(target)) throw new Error(`invalid target: ${target}`);
  return path.join(dshHome, target);
}

export function normalizeMeta(id, meta) {
  const name =
    typeof meta?.name === "string" && meta.name.trim()
      ? meta.name.trim().slice(0, MAX_NAME_LENGTH)
      : id;
  const target = validTarget(meta?.target) ? meta.target : "AGENTS.md";
  return { name, target };
}

export async function readRuleMeta(dshHome, id) {
  try {
    const parsed = JSON.parse(await fsp.readFile(ruleMetaPath(dshHome, id), "utf8"));
    return normalizeMeta(id, parsed);
  } catch {
    return normalizeMeta(id, null);
  }
}

export async function writeRuleMeta(dshHome, id, meta) {
  if (!validRuleId(id)) throw new Error(`invalid rule id: ${id}`);
  await fsp.mkdir(rulesDir(dshHome), { recursive: true });
  await atomicWriteFile(ruleMetaPath(dshHome, id), JSON.stringify(normalizeMeta(id, meta), null, 2));
}

function readRuleContentSync(dshHome, id) {
  try {
    return fs.readFileSync(rulePath(dshHome, id), "utf8");
  } catch {
    return null;
  }
}

async function collectRuleContents(dshHome) {
  const listed = await listRules(dshHome);
  const contents = new Set();
  for (const r of listed) {
    const c = readRuleContentSync(dshHome, r.id);
    if (c !== null) contents.add(c);
  }
  return contents;
}

export async function listRules(dshHome) {
  const dir = rulesDir(dshHome);
  const out = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const id = e.name.slice(0, -3);
      if (!validRuleId(id)) continue;
      let size = 0;
      try {
        size = (await fsp.stat(path.join(dir, e.name))).size;
      } catch {
      }
      const meta = await readRuleMeta(dshHome, id);
      out.push({ id, name: meta.name, target: meta.target, size });
    }
  } catch {
    // rules 目录不存在时按空列表返回
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function readRule(dshHome, id) {
  if (!validRuleId(id)) throw new Error(`invalid rule id: ${id}`);
  try {
    return await fsp.readFile(rulePath(dshHome, id), "utf8");
  } catch {
    return null;
  }
}

export async function saveRule(dshHome, id, content, meta) {
  if (!validRuleId(id)) throw new Error(`invalid rule id: ${id}`);
  if (Buffer.byteLength(content, "utf8") > MAX_RULE_BYTES) {
    throw new Error("rule too large (max 256KB)");
  }
  await fsp.mkdir(rulesDir(dshHome), { recursive: true });

  const rulePathStr = rulePath(dshHome, id);
  const metaPathStr = ruleMetaPath(dshHome, id);
  let prevRule = null;
  let prevMeta = null;
  try { prevRule = await fsp.readFile(rulePathStr, "utf8"); } catch { /* 新 rule */ }
  try { prevMeta = await fsp.readFile(metaPathStr, "utf8"); } catch { /* 新 rule */ }

  let wroteRule = false;
  let wroteMeta = false;
  try {
    await atomicWriteFile(rulePathStr, content);
    wroteRule = true;
    await writeRuleMeta(dshHome, id, meta);
    wroteMeta = true;
    if ((await readActive(dshHome)) === id) {
      await activateRule(dshHome, id);
    }
  } catch (e) {
    if (wroteRule) {
      try {
        if (prevRule === null) {
          await fsp.unlink(rulePathStr).catch(() => {});
        } else {
          await atomicWriteFile(rulePathStr, prevRule);
        }
      } catch { /* 回滚失败,原错继续抛 */ }
    }
    if (wroteMeta && prevMeta !== null) {
      try { await atomicWriteFile(metaPathStr, prevMeta); } catch { /* ignore */ }
    } else if (wroteMeta && prevMeta === null) {
      try { await fsp.unlink(metaPathStr).catch(() => {}); } catch { /* ignore */ }
    }
    throw e;
  }
}

export async function deleteRule(dshHome, id) {
  if (!validRuleId(id)) throw new Error(`invalid rule id: ${id}`);
  try {
    await fsp.unlink(rulePath(dshHome, id));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    await fsp.unlink(ruleMetaPath(dshHome, id));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if ((await readActive(dshHome)) === id) {
    try {
      await fsp.unlink(stateFile(dshHome));
    } catch {
    }
  }
}

export async function readActive(dshHome) {
  try {
    const parsed = JSON.parse(await fsp.readFile(stateFile(dshHome), "utf8"));
    return typeof parsed?.active === "string" && validRuleId(parsed.active) ? parsed.active : null;
  } catch {
    return null;
  }
}

export async function setActive(dshHome, id) {
  if (!validRuleId(id)) throw new Error(`invalid rule id: ${id}`);
  await fsp.mkdir(rulesDir(dshHome), { recursive: true });
  await fsp.writeFile(stateFile(dshHome), JSON.stringify({ active: id }, null, 2), "utf8");
}

/**
 * 本进程框内提交 > $DSH_HOME/prompt-inject.md > 加密槽。
 * 规则集只改 agents 目标文件，不参与 system 注入链（#74 磁盘与 UI/注入一致）。
 */
export function resolveInjectText(dshHome) {
  const home = path.normalize(String(dshHome || findDshHome() || ""));
  const pinned = peekCommittedOverride(home);
  if (typeof pinned === "string" && normalizeOverride(pinned)) {
    return { text: normalizeOverride(pinned), source: "prompt", ruleId: null };
  }
  const diskNorm = normalizeOverride(readPromptInjectFileSync(home));
  if (diskNorm) {
    const source = hashOverride(diskNorm) === defaultOverrideHash() ? "default" : "prompt";
    return { text: diskNorm, source, ruleId: null };
  }
  const bundled = normalizeOverride(defaultOverrideText());
  if (bundled) return { text: bundled, source: "default", ruleId: null };
  return { text: "", source: "none", ruleId: null };
}

/** 组装前挂上操作者正文（prompt-inject.md / 框内提交 / 加密槽）。 */
export function ensureOperatorBody(dshHome) {
  const resolved = resolveInjectText(dshHome);
  if (resolved.text) hangOperatorPrompt(resolved.text);
  return resolved.text || normalizeOverride(hungOperatorPrompt()) || "";
}

export async function activateRule(dshHome, id) {
  const content = await readRule(dshHome, id);
  if (content === null) throw new Error(`rule not found: ${id}`);
  const meta = await readRuleMeta(dshHome, id);
  const target = targetPath(dshHome, meta.target);
  const backup = `${target}${BACKUP_SUFFIX}`;
  if (!fs.existsSync(backup)) {
    try {
      const existing = await fsp.readFile(target, "utf8");
      const ruleContents = await collectRuleContents(dshHome);
      if (!ruleContents.has(existing)) {
        await atomicCopyFile(target, backup);
      }
    } catch { /* target 不存在 → 无需备份 */ }
  }
  await atomicWriteFile(target, content);
  await setActive(dshHome, id);
  return meta;
}

export async function ensureInitialState(dshHome) {
  const listed = await listRules(dshHome);
  let active = await readActive(dshHome);
  if (active !== null && !listed.some((r) => r.id === active)) {
    try {
      await fsp.unlink(stateFile(dshHome));
    } catch {
    }
    active = null;
  }
  return { active };
}

export async function resetToOriginal(dshHome) {
  const active = await readActive(dshHome);
  const removed = [];
  const skipped = [];
  const restored = [];

  for (const target of RULE_TARGETS) {
    const fp = targetPath(dshHome, target);
    const bak = `${fp}${BACKUP_SUFFIX}`;
    if (!fs.existsSync(bak)) continue;
    try {
      await atomicCopyFile(bak, fp);
      await fsp.unlink(bak);
      restored.push(fp);
    } catch { /* restore 失败,fall through 到老逻辑 */ }
  }

  if (active !== null) {
    const meta = await readRuleMeta(dshHome, active);
    const fp = targetPath(dshHome, meta.target);
    if (!restored.includes(fp)) {
      const ruleContent = await readRule(dshHome, active);
      try {
        const fileContent = await fsp.readFile(fp, "utf8");
        if (ruleContent !== null && fileContent === ruleContent) {
          await fsp.unlink(fp);
          removed.push(fp);
        } else {
          skipped.push(fp);
        }
      } catch {
      }
    }
  }
  try {
    await fsp.unlink(stateFile(dshHome));
  } catch {
  }
  return { removed, skipped, restored };
}

export async function rulesStatus(dshHome, cwdHint) {
  const listed = await listRules(dshHome);
  const active = await readActive(dshHome);
  let active_target = null;
  let agents_exists = false;
  let agents_synced = false;
  let agents_path = targetPath(dshHome, "AGENTS.md");
  if (active !== null) {
    const meta = await readRuleMeta(dshHome, active);
    active_target = meta.target;
    agents_path = targetPath(dshHome, meta.target);
    try {
      const content = await fsp.readFile(agents_path, "utf8");
      agents_exists = true;
      const ruleContent = await readRule(dshHome, active);
      agents_synced = ruleContent !== null && ruleContent === content;
    } catch {
    }
  }
  const inject = resolveInjectText(dshHome);
  const cwd = pickCwd(dshHome, cwdHint);
  const cwdCandidates = cwd ? scanCwdInstructions(cwd) : [];
  const selections = readCwdSelections(dshHome, cwd);
  const workspacePolicy = readWorkspacePolicy(dshHome);
  const workspaceRuleMode = readWorkspaceRuleMode(dshHome, cwd);
  const observation = latestWorkspaceAssembly(dshHome, cwd);
  return {
    rules: listed,
    active,
    injectSource: inject.source,
    injectRuleId: inject.ruleId,
    active_target,
    agents_exists,
    agents_synced,
    agents_path,
    rules_dir: rulesDir(dshHome),
    cwd,
    cwd_candidates: cwdCandidates.map((item) => ({
      ...item,
      selected: selections.includes(item.path),
      filter: readWorkspaceFileScope(dshHome, cwd, item.path),
    })),
    cwd_selections: selections,
    workspace_policy: workspacePolicy,
    workspace_policies: [...WORKSPACE_POLICIES],
    workspace_rule_mode: workspaceRuleMode,
    workspace_rule_modes: [...WORKSPACE_RULE_MODES],
    project_root: projectRootForCwd(cwd),
    last_workspace_assembly: observation,
  };
}

function pickCwd(dshHome, cwdHint) {
  const hint = typeof cwdHint === "string" ? cwdHint.trim() : "";
  if (hint) return path.resolve(hint);
  const last = readLastCwd(dshHome);
  return last ? path.resolve(last) : "";
}

/**
 * 向上走若干层,把 cwd 自身也算一层;遇到 .git/.hg/.svn 这类根标记就停住。
 * dsh-agent-instructions 的 findProjectRoot 用类似做法。没找到 root 就只扫 cwd 这一层。
 */
export function ancestorChainForCwd(cwd) {
  if (!cwd) return [];
  const normalized = path.resolve(cwd);
  let root = null;
  let cur = normalized;
  for (let i = 0; i < MAX_CWD_WALK_DEPTH; i += 1) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        if (fs.existsSync(path.join(cur, marker))) { root = cur; break; }
      } catch { /* ignore */ }
    }
    if (root) break;
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  const chain = [];
  const pushed = new Set();
  const stopAt = root ? path.resolve(root) : normalized;
  let walker = normalized;
  for (let i = 0; i < MAX_CWD_WALK_DEPTH; i += 1) {
    if (!pushed.has(walker)) { chain.push(walker); pushed.add(walker); }
    if (walker === stopAt) break;
    const parent = path.dirname(walker);
    if (!parent || parent === walker) break;
    walker = parent;
  }
  return chain.reverse();
}

export function scanCwdInstructions(cwd) {
  const out = [];
  if (!cwd) return out;
  const chain = ancestorChainForCwd(cwd);
  const seen = new Set();
  const leaf = path.resolve(cwd);
  for (const dir of chain) {
    for (const name of CWD_CANDIDATE_FILES) {
      const fp = path.join(dir, name);
      if (seen.has(fp)) continue;
      let stat = null;
      try { stat = fs.statSync(fp); } catch { continue; }
      if (!stat.isFile()) continue;
      seen.add(fp);
      let preview = "";
      try {
        const raw = fs.readFileSync(fp, "utf8");
        preview = raw.replace(/\s+/g, " ").trim().slice(0, 160);
      } catch { /* ignore */ }
      const scope = dir === leaf ? "cwd" : (dir === chain[0] ? "root" : "ancestor");
      out.push({
        path: fp,
        name,
        dir,
        scope,
        size: stat.size,
        mtime: stat.mtimeMs || stat.mtime?.getTime?.() || 0,
        preview,
      });
    }
  }
  return out;
}

export function readWorkspacePolicy(dshHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(workspacePolicyPath(dshHome), "utf8"));
    const policy = parsed?.policy;
    if (typeof policy === "string" && WORKSPACE_POLICIES.includes(policy)) return policy;
  } catch { /* ignore */ }
  return DEFAULT_WORKSPACE_POLICY;
}

export async function writeWorkspacePolicy(dshHome, policy) {
  if (!WORKSPACE_POLICIES.includes(policy)) {
    throw new Error(`invalid workspace policy: ${policy}`);
  }
  const fp = workspacePolicyPath(dshHome);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await atomicWriteFile(fp, JSON.stringify({ policy }, null, 2));
  return policy;
}

function normalizeSelectionList(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function projectRootForCwd(cwd) {
  if (!cwd) return "";
  const ancestors = ancestorChainForCwd(cwd);
  return ancestors[0] || path.resolve(cwd);
}

function readCwdSettings(dshHome) {
  try {
    const data = JSON.parse(fs.readFileSync(cwdSelectionsPath(dshHome), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function projectEntry(dshHome, cwd) {
  const key = projectRootForCwd(cwd);
  if (!key) return null;
  const data = readCwdSettings(dshHome);
  return data.projects && Object.hasOwn(data.projects, key) ? data.projects[key] : null;
}

// Older global selections remain readable; a project's first edit creates an isolated entry.
export function readCwdSelections(dshHome, cwd = "") {
  const data = readCwdSettings(dshHome);
  const entry = cwd && projectEntry(dshHome, cwd);
  const paths = normalizeSelectionList(Array.isArray(entry?.paths) ? entry.paths : data.paths);
  if (!cwd || Array.isArray(entry?.paths)) return paths;
  const candidates = new Set(scanCwdInstructions(cwd).map(item => item.path));
  return paths.filter(file => candidates.has(file));
}

export async function writeCwdSelections(dshHome, paths, cwd = "") {
  const unique = normalizeSelectionList(paths);
  const fp = cwdSelectionsPath(dshHome);
  const data = readCwdSettings(dshHome);
  const project = projectRootForCwd(cwd);
  if (project) {
    const projects = data.projects && typeof data.projects === "object" ? data.projects : {};
    const existing = projects[project] && typeof projects[project] === "object" ? projects[project] : {};
    projects[project] = { ...existing, paths: unique };
    data.projects = projects;
  } else data.paths = unique;
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await atomicWriteFile(fp, JSON.stringify(data, null, 2));
  return unique;
}

export async function toggleCwdSelection(dshHome, filePath, enabled, cwd = "") {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("invalid file path");
  const abs = path.resolve(filePath.trim());
  const current = readCwdSelections(dshHome, cwd);
  const set = new Set(current);
  if (enabled) set.add(abs); else set.delete(abs);
  return writeCwdSelections(dshHome, Array.from(set), cwd);
}

export function readWorkspaceFileScope(dshHome, cwd, filePath) {
  const data = projectEntry(dshHome, cwd);
  const raw = data?.filters && typeof data.filters === "object" ? data.filters[path.resolve(filePath)] : null;
  return normalizeFileScope(raw);
}

export async function writeWorkspaceFileScope(dshHome, cwd, filePath, value) {
  if (!cwd || typeof filePath !== "string" || !filePath.trim()) throw new Error("workspace and file required");
  const absolute = path.resolve(filePath);
  if (!scanCwdInstructions(cwd).some(item => item.path === absolute)) {
    throw new Error("file is not in the current workspace scan");
  }
  const fp = cwdSelectionsPath(dshHome);
  const data = readCwdSettings(dshHome);
  const key = projectRootForCwd(cwd);
  const projects = data.projects && typeof data.projects === "object" ? data.projects : {};
  const existing = projects[key] && typeof projects[key] === "object" ? projects[key] : {};
  const filters = existing.filters && typeof existing.filters === "object" ? existing.filters : {};
  filters[absolute] = normalizeFileScope(value);
  projects[key] = { ...existing, paths: readCwdSelections(dshHome, cwd), filters };
  data.projects = projects;
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await atomicWriteFile(fp, JSON.stringify(data, null, 2));
  return filters[absolute];
}

export function readWorkspaceRuleMode(dshHome, cwd = "") {
  const mode = projectEntry(dshHome, cwd)?.mode;
  return WORKSPACE_RULE_MODES.includes(mode) ? mode : "fallback";
}

export async function writeWorkspaceRuleMode(dshHome, cwd, mode) {
  if (!cwd || !WORKSPACE_RULE_MODES.includes(mode)) throw new Error("invalid workspace rule mode");
  const fp = cwdSelectionsPath(dshHome);
  const data = readCwdSettings(dshHome);
  const key = projectRootForCwd(cwd);
  const projects = data.projects && typeof data.projects === "object" ? data.projects : {};
  const existing = projects[key] && typeof projects[key] === "object" ? projects[key] : {};
  projects[key] = { ...existing, paths: readCwdSelections(dshHome, cwd), mode };
  data.projects = projects;
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await atomicWriteFile(fp, JSON.stringify(data, null, 2));
  return mode;
}

export function readLastCwd(dshHome) {
  try {
    const txt = fs.readFileSync(lastCwdPath(dshHome), "utf8").trim();
    return txt || "";
  } catch { return ""; }
}

export function writeLastCwd(dshHome, cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return;
  try {
    const fp = lastCwdPath(dshHome);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, cwd.trim(), "utf8");
  } catch { /* ignore */ }
}

/**
 * Evaluate selected workspace instruction files for the current assembly.
 * Never return raw instructions in the status/diagnostics API.
 */
export function planCwdRuleInject(dshHome, cwd, { hasPrompt = false, enabled = true,
  nativeText = "", injectionOff = false, model = "", provider = "", preset = "" } = {}) {
  const mode = readWorkspaceRuleMode(dshHome, cwd);
  const candidates = cwd ? scanCwdInstructions(cwd) : [];
  const selections = new Set(readCwdSelections(dshHome, cwd));
  const decisions = [];
  const blocks = [];
  const accepted = new Set();
  let total = 0;
  for (const item of candidates) {
    const row = { path: item.path, name: item.name, selected: selections.has(item.path),
      reason: "not-selected", bytes: 0 };
    if (!row.selected) { decisions.push(row); continue; }
    if (!enabled || injectionOff) { row.reason = injectionOff ? "injection-off" : "disabled"; decisions.push(row); continue; }
    if (mode === "fallback" && hasPrompt) { row.reason = "prompt-present"; decisions.push(row); continue; }
    const scope = readWorkspaceFileScope(dshHome, cwd, item.path);
    const scopedReason = fileScopeReason(scope, { model, provider, preset });
    if (scopedReason) { row.reason = scopedReason; decisions.push(row); continue; }
    let body;
    try { body = fs.readFileSync(item.path, "utf8").trim(); }
    catch { row.reason = "read-failed"; decisions.push(row); continue; }
    if (!body) { row.reason = "empty-file"; decisions.push(row); continue; }
    const marker = `<!-- dsh-purge:cwd-rule ${path.basename(item.path)} -->`;
    const block = `${marker}\n${body}`;
    const size = Buffer.byteLength(block, "utf8");
    row.bytes = size;
    if (String(nativeText || "").includes(body)) { row.reason = "native-present"; decisions.push(row); continue; }
    if (accepted.has(body)) { row.reason = "duplicate-selected"; decisions.push(row); continue; }
    if (total + size > MAX_LOCAL_INJECT_BYTES) { row.reason = "size-limit"; decisions.push(row); continue; }
    total += size;
    accepted.add(body);
    row.reason = "planned";
    row.block = block;
    blocks.push(block);
    decisions.push(row);
  }
  return { mode, text: blocks.join("\n\n---\n\n"), decisions };
}


/**
 * DSH's agent-instructions plugin inserts durable user-role messages independently
 * of Purge's system-prompt workspace plan. Honour an explicit per-project
 * deselection at the pre-step request boundary when the native message contains
 * exclusively deselected files. Mixed source batches are intentionally retained:
 * deleting one would silently delete unrelated instructions.
 */
export function filterDeselectedNativeInstructionMessages(dshHome, cwd, messages) {
  const unchanged = { messages, suppressed: 0, mixed: 0 };
  if (!Array.isArray(messages) || !cwd) return unchanged;
  const entry = projectEntry(dshHome, cwd);
  if (!Array.isArray(entry?.paths)) return unchanged;
  const selected = new Set(readCwdSelections(dshHome, cwd));
  const root = projectRootForCwd(cwd);
  const blocked = new Set(scanCwdInstructions(cwd)
    .filter(item => !selected.has(item.path))
    .map(item => path.relative(root, item.path).replaceAll("\\", "/").replace(/^\.\//, "")));
  if (!blocked.size) return unchanged;
  let suppressed = 0, mixed = 0;
  const next = messages.filter(message => {
    if (message?.source?.kind !== "agent-instructions") return true;
    const changes = message.source.changes;
    if (!Array.isArray(changes) || !changes.length) return true;
    const included = changes.filter(change => change?.action !== "remove");
    if (!included.length || included.some(change => typeof change?.path !== "string")) return true;
    const seen = included.map(change => blocked.has(change.path.replaceAll("\\", "/").replace(/^\.\//, "")));
    if (seen.every(Boolean)) { suppressed++; return false; }
    if (seen.some(Boolean)) mixed++;
    return true;
  });
  return { messages: suppressed ? next : messages, suppressed, mixed };
}

export function recordWorkspaceAssembly(dshHome, cwd, plan, assembled, details = {}) {
  if (!cwd || !dshHome) return;
  const sectionText = Array.isArray(assembled?.sections)
    ? assembled.sections.map(x => typeof x?.text === "string" ? x.text : "").join("\n\n") : "";
  const decisions = plan.decisions.map(item => ({
    path: item.path, name: item.name, selected: item.selected, bytes: item.bytes,
    reason: item.reason === "planned"
      ? (sectionText.includes(item.block) ? "assembled" : "not-observed-in-assembly")
      : item.reason,
  }));
  const key = dshHome + "|" + path.resolve(cwd);
  observedAssemblies.set(key, {
    observed_at: new Date().toISOString(), cwd, mode: plan.mode, decisions,
    prompt_used: Boolean(details.promptUsed), preset: details.preset || "",
    note: "仅确认最近一次服务端组装结果，非模型最终执行证明",
  });
  if (observedAssemblies.size > 32) observedAssemblies.delete(observedAssemblies.keys().next().value);
}

export function latestWorkspaceAssembly(dshHome, cwd) {
  if (!dshHome || !cwd) return null;
  return observedAssemblies.get(dshHome + "|" + path.resolve(cwd)) || null;
}

/** Legacy call: same fallback behavior for consumers that request only text. */
export function readSelectedCwdInject(dshHome, cwd) {
  return planCwdRuleInject(dshHome, cwd).text;
}
