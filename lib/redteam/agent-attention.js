/**
 * Structured, per-engagement Agent handoff attention.
 * Adapted from CallMeGuLab/dsh-purge-safe v2.0.0 (d96c5f25):
 * structured redteamReport, latest-per-child pending queue and explicit ack.
 *
 * This is a view of completed subagent reports, not a live-running/capacity
 * ledger or a second task scheduler. The full assistant message is not stored.
 */
import { redactCredentialText } from "./report-shareable.js";
import { sessionBindings } from "./session-bindings.js";

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

/**
 * Capture a genuine host subagent/end event after the existing reservation
 * correlator confirms its root, or the direct parent has a saved binding.
 * No matched target means no write: never fall back to another engagement.
 */
export function captureAgentEndReport(store, reservations, info, onObservationError) {
  const linked = reservations.matchRun(info);
  reservations.end(info); // Always preserve existing lifecycle accounting.
  if (!store || typeof store.recordAgentReport !== "function"
      || info?.id == null || info?.runId == null) return null;
  const parent = String(info.parentSessionId ?? "");
  const owner = linked?.owner ?? parent;
  const bindings = sessionBindings(store);
  const engagement = bindings.get(owner) ?? bindings.get(parent);
  if (typeof engagement !== "string" || !engagement) return null;
  // Optional durable work ledger: exact session/run and bound engagement only.
  // Even when a structured report is absent, host end evidence can be noted.
  // Never settle a task here; a failed observation must not suppress attention.
  if (typeof store.observeWorkItemEnd === "function") {
    try {
      store.observeWorkItemEnd(engagement, {
        session_id: String(info.id), run_id: String(info.runId), stop_reason: info.stopReason,
      });
    } catch (error) {
      if (typeof onObservationError === "function") onObservationError(error);
    }
  }
  const parsed = parseAgentAttention(info.lastAssistantMessage);
  if (typeof store.recordExperience === 'function') {
    const stopReason=String(info.stopReason || 'unknown')
    const outcome=parsed?.status || (stopReason==='error'?'failed':stopReason==='aborted'||stopReason==='max-tokens'?'interrupted':stopReason==='refusal'?'blocked':'inconclusive')
    const lessons={ ready:'子 Agent 自报 ready；主会话仍须核对产物和证据，不能自动视为验收完成。',
      failed:'子 Agent 报告失败；先复核失败原因、依赖和环境，再决定是否重派。',
      blocked:'子 Agent 被阻断；先处理明确的 needs 或 blocked_reason，不重复启动相同尝试。',
      waiting:'子 Agent 仍在等待依赖；先补齐前置条件，不把等待状态当作完成。',
      progress:'子 Agent 结束事件与报告状态不一致；先核对实际宿主状态，不推断任务完成。',
      dropped:'子 Agent 任务被终止或放弃；保留原因和已有进度，不当作成功。',
      interrupted:'宿主观察到子 Agent 中断；先核对已保存进度，再决定是否续作。',
      inconclusive:'宿主观察到子 Agent 结束，但没有结构化回报；结果未知，下一轮先补齐结果与证据。' }
    const details=parsed?[parsed.blocked_reason,...(parsed.needs||[]).map(item=>item.kind+': '+item.detail)].filter(Boolean).join('；')
      :'宿主结束原因：'+stopReason+'；未收到 redteamReport 结构化回报'
    try { store.recordExperience(engagement,{task_type:'agent-task',outcome,subject_key:'subagent',
      summary:details || ('子 Agent 报告状态：'+outcome),lesson:lessons[outcome] || '子 Agent 状态已记录；仍需核对实际产物与证据。',
      source_tool:'subagent/end',evidence_ref:'agent:'+String(info.runId),
      context:{stop_reason:stopReason,report_present:Boolean(parsed),status:outcome} }) }
    catch (error) { if (typeof onObservationError==='function') onObservationError(error) }
  }
  if (!parsed) return null;
  return store.recordAgentReport(engagement, {
    session_id: String(info.id), parent_session: owner, run_id: String(info.runId), ...parsed,
  });
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

export function countPendingAttention(db) {
  // After acknowledging the latest report, never count an older one for that session.
  return db.prepare("SELECT COUNT(*) AS n " + LATEST).get()?.n ?? 0;
}

export function listAttention(db, options = {}) {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested >= 1
    ? Math.min(100, Math.trunc(requested)) : 20;
  const total = countPendingAttention(db);
  const requestedOffset = Number(options.offset);
  const lastOffset = Math.max(0, Math.floor((total - 1) / limit) * limit);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0
    ? Math.min(lastOffset, Math.floor(requestedOffset / limit) * limit) : 0;
  const rows = db.prepare("SELECT a.id, a.session_id, a.parent_session, a.status, " +
    "a.blocked_reason, a.needs, a.created_at " + LATEST +
    " ORDER BY CASE a.status " +
    "WHEN 'waiting' THEN 0 WHEN 'blocked' THEN 1 WHEN 'failed' THEN 2 " +
    "WHEN 'ready' THEN 3 WHEN 'progress' THEN 4 ELSE 5 END, a.id DESC LIMIT ? OFFSET ?").all(limit, offset);
  const items = rows.map(({ needs, ...row }) => {
    let parsed = [];
    try { parsed = JSON.parse(needs || "[]"); } catch { /* old malformed data */ }
    return { ...row, needs: Array.isArray(parsed) ? parsed : [] };
  });
  const awaiting_person = db.prepare("SELECT COUNT(*) AS n " + LATEST +
    " AND a.status IN ('waiting','blocked')").get()?.n ?? 0;
  return { total, awaiting_person, items, truncated: total > items.length,
    ...(options.offset === undefined ? {} : { offset, limit, has_more: offset + items.length < total }),
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
