/**
 * Structured, per-engagement Agent handoff attention.
 * Adapted from CallMeGuLab/dsh-purge-safe v2.0.0 (d96c5f25):
 * structured redteamReport, latest-per-child pending queue and explicit ack.
 *
 * This is a view of completed subagent reports, not a live-running/capacity
 * ledger or a second task scheduler. The full assistant message is not stored.
 */
import { redactCredentialText } from "./report-shareable.js";

const STATUSES = new Set(["progress", "waiting", "ready", "blocked", "failed", "dropped"]);

function short(value, max = 180) {
  if (typeof value !== "string") return "";
  return redactCredentialText(value.trim()).slice(0, max);
}

function extractMessage(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text).join("\n");
}

function balancedObject(source, start) {
  let depth = 0, quote = "", escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return "";
}

/** Parse only a final explicit redteamReport marker; never infer status from prose. */
export function parseAgentAttention(message) {
  const raw = extractMessage(message);
  const marker = raw.lastIndexOf("redteamReport:");
  if (marker < 0) return null;
  const tail = raw.slice(marker + "redteamReport:".length, marker + "redteamReport:".length + 8000);
  const brace = tail.indexOf("{");
  if (brace < 0 || brace > 60) return null;
  const body = balancedObject(tail, brace);
  if (!body) return null;
  let object;
  try { object = JSON.parse(body); } catch {
    // Upstream prompt also permits { status: waiting, ... }. Do not interpret
    // unparsed fields (especially credential-shaped needs) as structured data.
    const match = body.match(/(?:^|[,{\s])["']?status["']?\s*:\s*["']?(progress|waiting|ready|blocked|failed|dropped)\b/i);
    if (!match) return null;
    object = { status: match[1] };
  }
  if (!object || typeof object !== "object" || Array.isArray(object)) return null;
  const status = String(object.status || "").toLowerCase().trim();
  if (!STATUSES.has(status)) return null;
  const needs = Array.isArray(object.needs) ? object.needs.slice(0, 8).map(item => {
    if (typeof item === "string") return { kind: "other", detail: short(item) };
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    return { kind: short(String(item.kind || "other"), 32) || "other",
      detail: short(String(item.detail || ""), 180) };
  }).filter(Boolean) : [];
  return { status, blocked_reason: short(object.blocked_reason || "", 300), needs };
}

export function recordAttention(db, info) {
  const { session_id, parent_session, run_id, status } = info || {};
  if (![session_id, parent_session, run_id].every(x => typeof x === "string" && x.trim())) return null;
  if (!STATUSES.has(status)) return null;
  const result = db.prepare("INSERT INTO agent_attention " +
    "(session_id, parent_session, run_id, status, blocked_reason, needs, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(parent_session, run_id) DO NOTHING").run(
    session_id, parent_session, run_id, status,
    short(info.blocked_reason || "", 300),
    JSON.stringify(Array.isArray(info.needs) ? info.needs.slice(0, 8)
      .map(item => {
        if (typeof item === "string") return { kind: "other", detail: short(item) };
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        return { kind: short(String(item.kind || "other"), 32) || "other",
          detail: short(String(item.detail || ""), 180) };
      }).filter(Boolean) : []),
    new Date().toISOString(),
  );
  const row = db.prepare("SELECT id FROM agent_attention WHERE parent_session = ? AND run_id = ?")
    .get(parent_session, run_id);
  return { id: row?.id ?? null, recorded: result.changes === 1 };
}

const LATEST = "FROM agent_attention a " +
  "JOIN (SELECT session_id, MAX(id) AS id FROM agent_attention GROUP BY session_id) current " +
  "ON current.id = a.id WHERE a.acknowledged_at IS NULL";

export function listAttention(db, options = {}) {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested >= 1
    ? Math.min(100, Math.trunc(requested)) : 20;
  // Do not resurrect an older unacknowledged report after its newest one was
  // acknowledged. The latest report of each child is the only active state.
  const total = db.prepare("SELECT COUNT(*) AS n " + LATEST).get()?.n ?? 0;
  const rows = db.prepare("SELECT a.id, a.session_id, a.parent_session, a.status, " +
    "a.blocked_reason, a.needs, a.created_at " + LATEST +
    " ORDER BY CASE a.status " +
    "WHEN 'waiting' THEN 0 WHEN 'blocked' THEN 1 WHEN 'failed' THEN 2 " +
    "WHEN 'ready' THEN 3 WHEN 'progress' THEN 4 ELSE 5 END, a.id DESC LIMIT ?").all(limit);
  const items = rows.map(({ needs, ...row }) => {
    let parsed = [];
    try { parsed = JSON.parse(needs || "[]"); } catch { /* old malformed data */ }
    return { ...row, needs: Array.isArray(parsed) ? parsed : [] };
  });
  const awaiting_person = db.prepare("SELECT COUNT(*) AS n " + LATEST +
    " AND a.status IN ('waiting','blocked')").get()?.n ?? 0;
  return { total, awaiting_person, items, truncated: total > items.length,
    note: "Reported states only; running capacity and actual task completion are not inferred." };
}

export function acknowledgeAttention(db, reportId) {
  const id = Number(reportId);
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("report_id must be a positive report ID");
  const result = db.prepare("UPDATE agent_attention SET acknowledged_at = ? " +
    "WHERE id = ? AND acknowledged_at IS NULL " +
    "AND id = (SELECT MAX(id) FROM agent_attention WHERE session_id = " +
    "(SELECT session_id FROM agent_attention WHERE id = ?))")
    .run(new Date().toISOString(), id, id);
  return { report_id: id, acknowledged: result.changes === 1 };
}
