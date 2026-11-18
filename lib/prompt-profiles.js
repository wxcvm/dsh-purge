import fs from "node:fs";
import path from "node:path";
import { latestHuman, messageOf, messageText } from "./response-context.js";

// The original prompt-inject.md is now the body of the redteam LOCAL profile.
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const DEFAULTS = Object.freeze([
  // 通用全局提示词 = 拒答层：常驻基线，勾选全部预设（含红队），任何会话都注入。
  {
    id: "global", name: "通用全局提示词", scope: "global", enabled: true, priority: 0,
    keywords: [], excludes: [],
    presetSwitches: { standard: true, ptc: true, minimal: true, cordis: true, redteam: true },
    injectOtherPresets: true, body: "",
  },
  // 红队专用 = 局部提示词：只靠「勾选红队预设」命中，不跟随其它预设。
  {
    id: "redteam", name: "红队专用", enabled: true, priority: 100,
    keywords: [], excludes: [],
    presetSwitches: { redteam: true }, injectOtherPresets: false,
    body: "",
  },
  {
    id: "coding", name: "编程开发", enabled: true, priority: 50,
    keywords: ["修复代码", "编译错误", "调试代码", "代码审查", "debug", "fix bug", "code review"],
    excludes: [],
    body: "Assist with software engineering tasks. Follow the user's requirements, inspect evidence before changes, prefer minimal fixes, and report what was actually verified.",
  },
  {
    id: "writing", name: "写作翻译", enabled: true, priority: 40,
    keywords: ["翻译", "润色", "改写", "写邮件", "translate", "proofread", "rewrite"],
    excludes: [],
    body: "Assist with writing and translation. Preserve the user's intent, requested format and tone; avoid inventing facts.",
  },
]);

const stateDir = (home) => path.join(home, "dsh-purge");
const manifestPath = (home) => path.join(stateDir(home), "prompt-profiles.json");
/** 红队局部规则的正文文件：仍是 $DSH_HOME/prompt-inject.md（面板红队页签编辑同一份）。 */
const injectPath = (home) => path.join(home, "prompt-inject.md");
const KEEP_MARK = "<!-- dsh-purge:keep · 用户自定义稿：插件默认同步不得覆盖本文件 -->";
const bodyPath = (home, id) => path.join(stateDir(home), "prompt-profiles", id + ".md");
const lockPath = (home) => path.join(stateDir(home), "prompt-session-locks.json");
const overridePath = (home) => path.join(stateDir(home), "prompt-session-overrides.json");
const TARGETS = ["models", "providers", "sessions", "presets"];
// Preset switches are independent of the advanced model/provider allowlist.
const PRESET_IDS = ["standard", "ptc", "minimal", "cordis", "redteam"];
function presetId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (/^red[\s_-]*team$/.test(id) || id === "红队") return "redteam";
  if (id === "creator" || id === "创造") return "cordis";
  if (id === "code") return "ptc"; // legacy DSH PTC name
  return id;
}
function normalizePresetSwitches(value, fallback = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  const result = {};
  for (const [name, enabled] of Object.entries(input || {})) {
    const id = presetId(name);
    if (id && id.length <= 128 && typeof enabled === "boolean") result[id] = enabled;
  }
  return result;
}
const emptyTargets = () => ({ models: [], providers: [], sessions: [], presets: [] });
const strings = (values) => Array.isArray(values)
  ? [...new Set(values.filter(x => typeof x === "string").map(x => x.trim()).filter(Boolean))]
  : [];
function targetSet(value, fallback) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : fallback || {};
  return Object.fromEntries(TARGETS.map(key => [key, strings(v[key])]));
}
function targetMatch(value, pattern) {
  if (!value || typeof pattern !== "string") return false;
  const name = value.toLowerCase(), glob = pattern.toLowerCase();
  if (!glob.includes("*")) return name === glob;
  const parts = glob.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const found = name.indexOf(parts[i], pos);
    if (found < 0 || (i === 0 && !glob.startsWith("*") && found !== 0)) return false;
    pos = found + parts[i].length;
  }
  return glob.endsWith("*") || name.endsWith(parts.at(-1));
}
function allowedByTargets(profile, context, explicitLock = false) {
  const check = (list, key) => list[key].some(entry => targetMatch(context[key.slice(0, -1)] || "", entry));
  if (profile.blockEnabled && TARGETS.some(key => check(profile.blockTargets, key))) return "blocklist-match";
  const preset = presetId(context.preset);
  if (!preset && Object.keys(profile.presetSwitches).length) return "preset-unobserved";
  if (!explicitLock && profile.id !== "redteam" && preset === "redteam" && profile.presetSwitches.redteam !== true)
    return "preset-disabled"; // only explicit opt-in can combine with the redteam preset
  if (Object.hasOwn(profile.presetSwitches, preset)) {
    if (profile.presetSwitches[preset] === false) return "preset-disabled";
  } else if (!profile.injectOtherPresets) {
    return "preset-unselected";
  }
  if (profile.allowEnabled) {
    const selected = TARGETS.filter(key => profile.allowTargets[key].length);
    if (!selected.length) return "allowlist-empty";
    if (!selected.every(key => check(profile.allowTargets, key))) return "allowlist-miss";
  }
  return null;
}


function parseJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* already renamed */ }
  }
}
function normalizeProfile(value, baseline = {}) {
  if (!value || !ID.test(String(value.id || ""))) return null;
  // global 固定为全局；redteam 与普通规则一样按配置落 local/global，不再有专属 scope。
  const scope = value.id === "global" || value.scope === "global" ? "global" : "local";
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : baseline.name || value.id,
    scope,
    enabled: value.enabled !== false,
    priority: Number.isFinite(value.priority) ? value.priority : baseline.priority || 0,
    keywords: strings(value.keywords ?? baseline.keywords),
    excludes: strings(value.excludes ?? baseline.excludes),
    body: typeof value.body === "string" ? value.body : baseline.body || "",
    allowEnabled: value.allowEnabled === true,
    blockEnabled: value.blockEnabled === true,
    allowTargets: targetSet(value.allowTargets, baseline.allowTargets),
    blockTargets: targetSet(value.blockTargets, baseline.blockTargets),
    presetSwitches: normalizePresetSwitches(value.presetSwitches, baseline.presetSwitches),
    injectOtherPresets: value.injectOtherPresets !== false,
  };
}

export function listPromptProfiles(home) {
  const overrides = parseJson(manifestPath(home), {});
  const custom = Array.isArray(overrides.profiles) ? overrides.profiles : [];
  const byId = new Map(DEFAULTS.map((p) => [p.id, { ...p }]));
  for (const item of custom) {
    const current = byId.get(item?.id) || {};
    const normalized = normalizeProfile(item, current);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].map((raw) => {
    const profile = normalizeProfile(raw, raw);
    // 红队层正文仍读 $DSH_HOME/prompt-inject.md；其余规则读 prompt-profiles/<id>.md。
    const file = profile.id === "redteam" ? injectPath(home) : bodyPath(home, profile.id);
    try {
      return { ...profile, body: fs.readFileSync(file, "utf8") };
    } catch {
      return profile;
    }
  });
}

export function savePromptProfile(home, input) {
  if (!input || !ID.test(String(input.id || ""))) throw new Error("invalid profile id");
  const current = listPromptProfiles(home).find((p) => p.id === input.id) || {};
  const profile = normalizeProfile({ ...current, ...input }, current);
  if (typeof input.body === "string") {
    const file = profile.id === "redteam" ? injectPath(home) : bodyPath(home, profile.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 红队正文必须保留 keep 标记，否则插件默认同步会覆盖用户自定义稿。
    let body = input.body;
    if (profile.id === "redteam" && !body.includes("dsh-purge:keep")) {
      body = body.replace(/\s+$/, "") + "\n\n" + KEEP_MARK + "\n";
    }
    fs.writeFileSync(file, body, "utf8");
  }
  const stored = parseJson(manifestPath(home), {});
  const entries = Array.isArray(stored.profiles) ? stored.profiles.filter((p) => p?.id !== profile.id) : [];
  entries.push({
    id: profile.id, name: profile.name, enabled: profile.enabled, priority: profile.priority,
    keywords: profile.keywords, excludes: profile.excludes, scope: profile.scope,
    allowEnabled: profile.allowEnabled, blockEnabled: profile.blockEnabled,
    allowTargets: profile.allowTargets, blockTargets: profile.blockTargets,
    presetSwitches: profile.presetSwitches, injectOtherPresets: profile.injectOtherPresets,
  });
  atomicJson(manifestPath(home), { profiles: entries });
  return profile;
}

export function deletePromptProfile(home, id) {
  if (!ID.test(String(id || ""))) throw new Error("invalid profile id");
  if (DEFAULTS.some((profile) => profile.id === id)) throw new Error("built-in profile: disable instead of deleting");
  const stored = parseJson(manifestPath(home), {});
  const profiles = Array.isArray(stored.profiles) ? stored.profiles : [];
  if (!profiles.some((item) => item?.id === id)) throw new Error("profile not found");
  atomicJson(manifestPath(home), { profiles: profiles.filter((item) => item?.id !== id) });
  try { fs.unlinkSync(bodyPath(home, id)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const locks = parseJson(lockPath(home), {});
  if (locks && typeof locks === "object") {
    for (const key of Object.keys(locks)) if (locks[key] === id) delete locks[key];
    atomicJson(lockPath(home), locks);
  }
  const overrides = parseJson(overridePath(home), {});
  for (const value of Object.values(overrides || {})) if (value && typeof value === "object") delete value[id];
  if (fs.existsSync(overridePath(home))) atomicJson(overridePath(home), overrides);
}

export function getSessionPromptLock(home, sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim()) return null;
  const locks = parseJson(lockPath(home), {});
  return locks && typeof locks === "object" && Object.hasOwn(locks, sessionId)
    ? locks[sessionId] : null;
}

export function setSessionPromptLock(home, sessionId, profileId) {
  if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("session id required");
  if (profileId !== null && profileId !== "none" && !listPromptProfiles(home).some((p) => p.id === profileId)) {
    throw new Error("unknown profile");
  }
  const existing = parseJson(lockPath(home), {});
  const locks = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  if (profileId === null) delete locks[sessionId];
  else locks[sessionId] = profileId;
  atomicJson(lockPath(home), locks);
}

/** Per-session pause for one rule; does not turn off any other rule. */
export function getSessionPromptOverrides(home, sessionId) {
  if (!sessionId || typeof sessionId !== "string") return {};
  const data = parseJson(overridePath(home), {});
  const row = data && typeof data === "object" ? data[sessionId] : null;
  return row && typeof row === "object" && !Array.isArray(row) ? row : {};
}
export function setSessionPromptPause(home, sessionId, profileId, paused) {
  if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("session id required");
  if (!listPromptProfiles(home).some(p => p.id === profileId)) throw new Error("unknown profile");
  const data = parseJson(overridePath(home), {});
  const records = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const row = records[sessionId] && typeof records[sessionId] === "object" ? records[sessionId] : {};
  if (paused) row[profileId] = "off";
  else delete row[profileId];
  if (Object.keys(row).length) records[sessionId] = row;
  else delete records[sessionId];
  atomicJson(overridePath(home), records);
}

export function routePromptForSession({ home, preset = "", text = "", sessionId = "", inheritedSessionId = "", model = "", provider = "" }) {
  const inherited = inheritedSessionId && inheritedSessionId !== sessionId ? inheritedSessionId : "";
  const chosen = sessionId && getSessionPromptLock(home, sessionId) !== null
    ? sessionId : inherited || sessionId;
  return routePrompt({ home, preset, text, sessionId, lockSessionId: chosen,
    inheritedSessionId: inherited, model, provider });
}

function matches(text, profile, preset = "") {
  const value = String(text || "").toLowerCase();
  if (profile.excludes.some(term => value.includes(term.toLowerCase()))) return false;
  if (!profile.keywords.length) {
    const mode = presetId(preset);
    return (profile.allowEnabled && TARGETS.some(key => profile.allowTargets[key].length > 0))
      || (mode && profile.presetSwitches[mode] === true)
      || (mode && !Object.hasOwn(profile.presetSwitches, mode) &&
          profile.injectOtherPresets && Object.keys(profile.presetSwitches).length > 0);
  }
  return profile.keywords.some(term => value.includes(term.toLowerCase()));
}

/** Last real user instruction, supporting native rc.3 and legacy wrapped events. */
export function latestPromptTask(events = []) {
  const event = latestHuman(events);
  return event ? messageText(messageOf(event)) : "";
}

/** Redteam uses its own preset/body; ordinary modes combine all eligible global and local rules. */
export function routePrompt({ home, preset = "", text = "", sessionId = "", lockSessionId = sessionId,
  inheritedSessionId = "", model = "", provider = "" }) {
  const profiles = listPromptProfiles(home);
  const byId = new Map(profiles.map(p => [p.id, p]));
  const locks = lockSessionId ? parseJson(lockPath(home), {}) : {};
  const lock = lockSessionId && Object.hasOwn(locks || {}, lockSessionId) ? locks[lockSessionId] : undefined;
  const none = (reason, decisions = []) => ({ id: null, reason, body: "", selected: [], decisions });
  if (lock === "none") return none("session-locked-off");
  const profileContext = { model: String(model || ""), provider: String(provider || ""),
    session: String(sessionId || ""), preset: presetId(preset) };
  const pauses = { ...getSessionPromptOverrides(home, inheritedSessionId),
    ...getSessionPromptOverrides(home, sessionId) };
  const decisions = [];
  const policy = (profile, explicitLock = false) => {
    if (!profile.enabled) return "disabled";
    if (pauses[profile.id] === "off") return "session-paused";
    return allowedByTargets(profile, profileContext, explicitLock);
  };
  // A legacy manual lock keeps its explicit single-profile meaning, without bypassing the rule's own off switch.
  if (typeof lock === "string" && lock !== "none") {
    const p = byId.get(lock);
    if (!p) return none("session-lock-missing");
    const blocked = policy(p, true);
    if (blocked) return none(blocked, [{ id: p.id, reason: blocked }]);
    if (!p.body.trim()) return none("empty-body", [{ id: p.id, reason: "empty-body" }]);
    return { id: p.id, reason: "session-lock", body: p.body, selected: [p.id],
      decisions: [{ id: p.id, reason: "session-lock" }] };
  }
  // 红队不再有专属分支：它是一条 scope=local 的规则，靠 presetSwitches.redteam 命中，
  // 与全局拒答层一起按「全局优先 → 局部 priority 降序」合并。
  const selected = [];
  for (const p of profiles) {
    const blocked = policy(p);
    const reason = blocked || (p.scope === "global" || matches(text, p, profileContext.preset) ? (p.body.trim() ? "matched" : "empty-body") : "keyword-miss");
    decisions.push({ id: p.id, reason });
    if (reason === "matched") selected.push(p);
  }
  // Globals first; local rules by explicit priority then stable id.
  selected.sort((a, b) => (a.scope === "global" ? 0 : 1) - (b.scope === "global" ? 0 : 1)
    || b.priority - a.priority || a.id.localeCompare(b.id));
  if (!selected.length) return none("no-match", decisions);
  return { id: selected[0].id, reason: selected.some(p => p.scope === "global") ? "combined" : "task-match",
    body: selected.filter(p => p.body.trim()).map(p => p.body).join("\n\n"),
    selected: selected.map(p => p.id), decisions };
}
