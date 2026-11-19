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
const BACKUP_BLOCK = /(?:\n)?<!-- dsh-purge:upstream-safe:begin -->\n?[\s\S]*?\n?<!-- dsh-purge:upstream-safe:end -->(?:\n)?/g;
const PERSONA_NAMES = new Set(["deployment:persona-prefix", "persona-prefix"]);

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
  const sections = assembled.sections.map(section => {
    if (!section || typeof section.text !== "string" || !section.text.includes(BACKUP_BEGIN)) return section;
    const next = section.text.replace(BACKUP_BLOCK, "").trim();
    if (next === section.text) return section;
    changed = true;
    return { ...section, text: next };
  });
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
  const content = BACKUP_BEGIN + "\n" + own.text + "\n" + BACKUP_END;
  const prior = index >= 0 ? rest[index] : null;
  const folded = prior
    ? { ...prior, text: content + (String(prior.text || "").trim() ? "\n\n" + prior.text : ""),
      order: -100000, interpolate: false }
    : { name: "deployment:persona-prefix", text: content, order: -100000, interpolate: false };
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
  return {
    assembledBytes: Buffer.byteLength(body, "utf8"),
    injectHead: PERSONA_NAMES.has(String(first?.name || "")) && Boolean(body),
  };
}
