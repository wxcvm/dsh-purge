import fs from "node:fs";
import path from "node:path";
import { latestHuman, messageOf, messageText } from "./response-context.js";

// The original prompt-inject.md remains the redteam profile's source of truth.
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const DEFAULTS = Object.freeze([
  {
    id: "redteam", name: "原全局 · 红队", enabled: true, priority: 100,
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
  const strings = (xs) => Array.isArray(xs)
    ? xs.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
    : [];
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : baseline.name || value.id,
    enabled: value.enabled !== false,
    priority: Number.isFinite(value.priority) ? value.priority : baseline.priority || 0,
    keywords: strings(value.keywords ?? baseline.keywords),
    excludes: strings(value.excludes ?? baseline.excludes),
    body: typeof value.body === "string" ? value.body : baseline.body || "",
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
    keywords: profile.keywords, excludes: profile.excludes,
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

function matches(text, profile) {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return false;
  if (profile.excludes.some((term) => value.includes(term.toLowerCase()))) return false;
  return profile.keywords.some((term) => value.includes(term.toLowerCase()));
}

/** Last real user instruction, supporting native rc.3 and legacy wrapped events. */
export function latestPromptTask(events = []) {
  const event = latestHuman(events);
  return event ? messageText(messageOf(event)) : "";
}

/**
 * Deterministic routing. Explicit per-session lock > redteam preset > task match.
 * A missing/ambiguous match leaves the host's native prompt untouched.
 * No model calls, no guessing from tool descriptions or prior assistant replies.
 */
export function routePrompt({ home, preset = "", text = "", sessionId = "" }) {
  const profiles = listPromptProfiles(home);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const locks = sessionId ? parseJson(lockPath(home), {}) : {};
  const lock = sessionId && Object.hasOwn(locks || {}, sessionId) ? locks[sessionId] : undefined;
  if (lock !== undefined) {
    if (lock === "none") return { id: null, reason: "session-locked-off", body: "" };
    const selected = byId.get(lock);
    if (selected) return { id: selected.id, reason: "session-lock", body: selected.body };
  }
  if (/^(?:red[\s_-]*team|红队)$/i.test(String(preset).trim()) || /红队/.test(String(preset).replace(/不是红队|非红队/g, ""))) {
    return { id: "redteam", reason: "redteam-preset", body: "" };
  }
  const matched = profiles.filter((p) => p.enabled && matches(text, p))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
  return matched ? { id: matched.id, reason: "task-match", body: matched.body }
    : { id: null, reason: "no-match", body: "" };
}
