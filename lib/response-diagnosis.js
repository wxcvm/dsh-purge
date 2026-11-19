/**
 * Read-only source attribution for Harness attempts.
 * Distinguishes a committed refusal from transport/provider failure without
 * guessing task completion or converting safety refusals into retry requests.
 */
const POLICY_CODES = new Set(["CONTENT_FILTER", "CONTENT_POLICY_VIOLATION", "POLICY_VIOLATION", "CONTENT_REFUSED"]);

export function diagnoseAttempt(row = {}) {
  const code = String(row.errorCode || "").toUpperCase();
  const failure = row.finish === "error" || row.turnOutcome === "error" ||
    (Number.isInteger(row.httpStatus) && row.httpStatus >= 400) || Boolean(code);
  if (row.terminalConflict) return { kind: "uncertain", evidence: "conflicting-terminal" };
  if (row.finish === "content_filter" || POLICY_CODES.has(code)) {
    return { kind: "upstream-policy", evidence: row.finish === "content_filter" ? "structured-finish" : "structured-error-code" };
  }
  if (failure) {
    // PI_AI_ERROR is a host wrapper, not proof of the provider's safety policy.
    return { kind: "provider-failure", evidence: code ? "host-error-code" : row.httpStatus >= 400 ? "http-status" : "host-terminal" };
  }
  if (row.interrupted || ["aborted", "max-tokens"].includes(row.finish) ||
    ["aborted", "cancelled", "interrupted"].includes(row.turnOutcome)) {
    return { kind: "incomplete", evidence: "host-lifecycle" };
  }
  if (row.turnOutcome !== "completed" || row.finish !== "stop" ||
    row.eventType !== "assistant/message" || row.settlement !== "committed") {
    return { kind: "uncertain", evidence: "insufficient-terminal-evidence" };
  }
  const assessment = row.assessment;
  if (assessment?.decision === "refusal") {
    return { kind: "explicit-refusal", evidence: "assistant-text-classifier" };
  }
  if (assessment?.decision === "not-refusal") {
    return { kind: "no-explicit-refusal", evidence: "assistant-text-classifier" };
  }
  return { kind: "uncertain", evidence: "insufficient-response-evidence" };
}
