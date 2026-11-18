import fs from "node:fs";
import path from "node:path";
import { latestHuman, messageOf, messageText } from "./response-context.js";

// The original prompt-inject.md remains the redteam profile's source of truth.
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const DEFAULTS = Object.freeze([
  { id: "global", name: "通用全局提示词", scope: "global", enabled: false, priority: 0, keywords: [], excludes: [], body: "" },
  {
    id: "redteam", name: "红队模式专用", enabled: true, priority: 100,
    keywords: ["开展红队演练", "进行红队演练", "执行授权渗透测试", "run a red team assessment"],
    excludes: ["什么是", "介绍", "讨论", "比较", "对比", "解释"],
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
const bodyPath = (home, id) => path.join(stateDir(home), "prompt-profiles", id + ".md");
const lockPath = (home) => path.join(stateDir(home), "prompt-session-locks.json");
const overridePath = (home) => path.join(stateDir(home), "prompt-session-overrides.json");
const TARGETS = ["models", "providers", "sessions", "presets"];
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
function allowedByTargets(profile, context) {
  const check = (list, key) => list[key].some(entry => targetMatch(context[key.slice(0, -1)] || "", entry));
  if (profile.blockEnabled && TARGETS.some(key => check(profile.blockTargets, key))) return "blocklist-match";
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
  const scope = value.id === "redteam" ? "redteam"
    : value.id === "global" || value.scope === "global" ? "global" : "local";
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
  return [...byId.values()].map((profile) => {
    if (profile.id === "redteam") return { ...profile, body: "" }; // legacy source never copied
    try {
      return { ...profile, body: fs.readFileSync(bodyPath(home, profile.id), "utf8") };
    } catch {
      return profile;
    }
  });
}

export function savePromptProfile(home, input) {
  if (!input || !ID.test(String(input.id || ""))) throw new Error("invalid profile id");
  const current = listPromptProfiles(home).find((p) => p.id === input.id) || {};
  const profile = normalizeProfile({ ...current, ...input }, current);
  if (profile.id !== "redteam" && typeof input.body === "string") {
    const file = bodyPath(home, profile.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, input.body, "utf8");
  }
  const stored = parseJson(manifestPath(home), {});
  const entries = Array.isArray(stored.profiles) ? stored.profiles.filter((p) => p?.id !== profile.id) : [];
  entries.push({
    id: profile.id, name: profile.name, enabled: profile.enabled, priority: profile.priority,
    keywords: profile.keywords, excludes: profile.excludes, scope: profile.scope,
    allowEnabled: profile.allowEnabled, blockEnabled: profile.blockEnabled,
    allowTargets: profile.allowTargets, blockTargets: profile.blockTargets,
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

function matches(text, profile) {
  const value = String(text || "").toLowerCase();
  if (profile.excludes.some(term => value.includes(term.toLowerCase()))) return false;
  if (!profile.keywords.length) return profile.allowEnabled &&
    TARGETS.some(key => profile.allowTargets[key].length > 0);
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
  const redteam = /^(?:red[\s_-]*team|红队)$/i.test(String(preset).trim());
  const profileContext = { model: String(model || ""), provider: String(provider || ""),
    session: String(sessionId || ""), preset: String(preset || "") };
  const pauses = { ...getSessionPromptOverrides(home, inheritedSessionId),
    ...getSessionPromptOverrides(home, sessionId) };
  const decisions = [];
  const policy = profile => {
    if (!profile.enabled) return "disabled";
    if (pauses[profile.id] === "off") return "session-paused";
    return allowedByTargets(profile, profileContext);
  };
  // A legacy manual lock keeps its explicit single-profile meaning, without bypassing the rule's own off switch.
  if (typeof lock === "string" && lock !== "none") {
    const p = byId.get(lock);
    if (!p) return none("session-lock-missing");
    const blocked = policy(p);
    if (blocked) return none(blocked, [{ id: p.id, reason: blocked }]);
    if (p.id !== "redteam" && !p.body.trim()) return none("empty-body", [{ id: p.id, reason: "empty-body" }]);
    return { id: p.id, reason: "session-lock", body: p.body, selected: [p.id],
      decisions: [{ id: p.id, reason: "session-lock" }] };
  }
  if (redteam) {
    const p = byId.get("redteam");
    const blocked = p ? policy(p) : "redteam-missing";
    return blocked ? none(blocked, [{ id: "redteam", reason: blocked }])
      : { id: "redteam", reason: "redteam-preset", body: "", selected: ["redteam"],
        decisions: [{ id: "redteam", reason: "redteam-preset" }] };
  }
  const selected = [];
  for (const p of profiles) {
    if (p.id === "redteam") { decisions.push({ id: p.id, reason: "redteam-only" }); continue; }
    const blocked = policy(p);
    const reason = blocked || (p.scope === "global" || matches(text, p) ? (p.body.trim() ? "matched" : "empty-body") : "keyword-miss");
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
