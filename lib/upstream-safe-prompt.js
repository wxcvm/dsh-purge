/**
 * Optional, isolated source and persona-prefix delivery adapter based on
 * CallMeGuLab/dsh-purge-safe v2.0.0 (d96c5f25).
 *
 * Retains Purge's existing routing, per-rule scopes, session off switch,
 * native host contexts/tools, and runtime permissions. This does NOT install
 * upstream approval/tool gate hooks or rewrite the host policy.
 * Source: https://github.com/CallMeGuLab/dsh-purge-safe
 * License: Apache-2.0; see NOTICE.
 */
import { createDecipheriv } from "node:crypto";
import { inflateSync } from "node:zlib";
import { IV, MASK, SLOT, TAG } from "./upstream-safe/asset-table.js";
import { mixKey } from "./table-key.js";

export const BACKUP_BEGIN = "<!-- dsh-purge:upstream-safe:begin -->";
export const BACKUP_END = "<!-- dsh-purge:upstream-safe:end -->";
const BACKUP_BLOCK = /<!-- dsh-purge:upstream-safe:begin -->\n[\s\S]*?\n<!-- dsh-purge:upstream-safe:end -->(?:\n\n)?/g;
const PERSONA_NAMES = new Set(["deployment:persona-prefix", "persona-prefix"]);
// Keep the original host properties on the folded section itself: host assemblies
// can be cloned/reused between turns, so a process-local WeakMap is not enough.
const FOLD_STATE = "__dshPurgeUpstreamSafePersona";

/** Upstream's own sealed default prompt, never written into the user's primary slot. */
export function readUpstreamSafePrompt() {
  try {
    const decipher = createDecipheriv("aes-256-gcm", mixKey(MASK), Buffer.from(IV, "base64"));
    decipher.setAuthTag(Buffer.from(TAG, "base64"));
    const raw = Buffer.concat([decipher.update(Buffer.from(SLOT, "base64")), decipher.final()]);
    const text = inflateSync(raw).toString("utf8");
    return text.trim() ? { ok: true, code: "OK", text } : { ok: false, code: "EMPTY_TEXT", text: "" };
  } catch {
    return { ok: false, code: "SOURCE_UNAVAILABLE", text: "" };
  }
}

/**
 * Reuse Purge's route decisions. Only the redteam or explicitly enabled
 * bundled-default source can be replaced; user-created global/local prompt
 * text always stays as authored. Disabled/paused/locked-off rules stay off.
 */
export function chooseUpstreamSafeSource(route, currentText, enabled) {
  const original = { text: String(currentText || ""), source: "primary", status: "not-selected" };
  if (!enabled || !route || (route.id !== "redteam" && route.reason !== "bundled-default")) return original;
  const result = readUpstreamSafePrompt();
  return result.ok
    ? { text: result.text, source: "upstream-safe", status: result.code }
    : { ...original, status: result.code };
}

/** Remove prior folded payload when the host reuses an assembly between turns. */
export function stripUpstreamSafeFold(assembled) {
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  let changed = false;
  const sections = [];
  for (const section of assembled.sections) {
    if (!section || typeof section.text !== "string" || !section.text.includes(BACKUP_BEGIN)) {
      sections.push(section);
      continue;
    }
    // Only remove our own delimited payload. Native whitespace belongs to the host.
    const text = section.text.replace(BACKUP_BLOCK, "");
    if (text === section.text) {
      sections.push(section);
      continue;
    }
    changed = true;
    const { [FOLD_STATE]: previous, ...rest } = section;
    // No native persona existed: do not leave an empty synthetic section behind.
    if (previous?.version === 1 && previous.synthetic === true) continue;
    const restored = { ...rest, text };
    if (previous?.version === 1) {
      if (previous.hadOrder) restored.order = previous.order;
      else delete restored.order;
      if (previous.hadInterpolate) restored.interpolate = previous.interpolate;
      else delete restored.interpolate;
    }
    sections.push(restored);
  }
  return changed ? { ...assembled, sections } : assembled;
}

/** Fold exactly one selected Purge body into the upstream-style persona-prefix slot. */
export function foldUpstreamSafePrompt(assembled) {
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  const clean = stripUpstreamSafeFold(assembled);
  const own = clean.sections.find(section => section?.name === "dsh-purge" && String(section.text || "").trim());
  if (!own) return clean;
  const rest = clean.sections.filter(section => section?.name !== "dsh-purge");
  const index = rest.findIndex(section => PERSONA_NAMES.has(String(section?.name || "")));
  const prior = index >= 0 ? rest[index] : null;
  // A native, interpolated persona may have {{cwd}} or provider-specific tokens.
  // Folding would force interpolate:false on that native text. Keep the selected
  // dsh-purge section instead of changing the host's template semantics.
  if (prior?.interpolate === true && /\{\{/.test(String(prior.text || ""))) {
    // Keep the native section first-class and the selected plugin section at the head.
    return { ...clean, sections: [own, ...rest] };
  }
  const content = BACKUP_BEGIN + "\n" + own.text + "\n" + BACKUP_END;
  const original = prior
    ? { version: 1, synthetic: false,
      hadOrder: Object.hasOwn(prior, "order"), order: prior.order,
      hadInterpolate: Object.hasOwn(prior, "interpolate"), interpolate: prior.interpolate }
    : { version: 1, synthetic: true };
  const folded = prior
    ? { ...prior, text: content + (String(prior.text || "") ? "\n\n" + prior.text : ""),
      order: -100000, interpolate: false, [FOLD_STATE]: original }
    : { name: "deployment:persona-prefix", text: content, order: -100000,
      interpolate: false, [FOLD_STATE]: original };
  const sections = prior ? rest.filter((_, i) => i !== index) : rest;
  return { ...clean, sections: [folded, ...sections] };
}

/** Diagnostics are about assembled sections, not real Provider delivery. */
export function upstreamSafeAssemblyProbe(assembled) {
  const first = Array.isArray(assembled?.sections) ? assembled.sections[0] : null;
  const text = typeof first?.text === "string" ? first.text : "";
  const begin = text.indexOf(BACKUP_BEGIN);
  const end = text.indexOf(BACKUP_END, begin + BACKUP_BEGIN.length);
  const body = begin >= 0 && end > begin
    ? text.slice(begin + BACKUP_BEGIN.length, end).trim() : "";
  const folded = PERSONA_NAMES.has(String(first?.name || "")) && Boolean(body);
  // The fallback still contains the selected prompt as a single dsh-purge
  // section. Report that honestly rather than claiming the prompt disappeared.
  const separate = first?.name === "dsh-purge" && Boolean(text.trim());
  return {
    assembledBytes: Buffer.byteLength(folded ? body : separate ? text : "", "utf8"),
    injectHead: folded || separate,
    assemblyMode: folded ? "persona-prefix" : separate ? "native-section" : "none",
  };
}
