/** Passive, bounded subagent lifecycle evidence. Never retain prompts, results or IDs in snapshots. */
const id = value => {
  const s = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  return s.length > 0 && s.length <= 256 ? s : null;
};

// Host-defined stop reasons are turn outcomes, not verified task completion.
const knownReasons = new Set(['completed', 'aborted', 'error', 'max-tokens', 'refusal']);
const terminalReason = info => knownReasons.has(info?.stopReason) ? info.stopReason : 'unknown';
const messageEvidence = info => !Array.isArray(info?.lastAssistantMessage) ? 'not-observed'
  : info.lastAssistantMessage.length ? 'present' : 'empty';

export function createSubagentObservations({ capacity = 200 } = {}) {
  capacity = Math.max(1, Math.min(200, Math.trunc(Number(capacity)) || 200));
  const runs = new Map();
  let sequence = 0, evicted = 0, disposed = false;

  function observe(kind, info) {
    if (disposed) return;
    const parent = id(info?.parentSessionId), run = id(info?.runId);
    if (parent === null || run === null) return;
    const key = JSON.stringify([parent, run]);
    let row = runs.get(key);
    if (!row) {
      if (runs.size >= capacity) {
        // Prefer dropping a recorded end; a start without an end is not proof of a live agent.
        const ended = [...runs].find(([, r]) => r.end !== null);
        runs.delete(ended ? ended[0] : runs.keys().next().value);
        evicted++;
      }
      row = { parent, start: null, end: null, reason: null, message: 'not-observed', terminalConflict: false };
      runs.set(key, row);
    }
    if (kind === 'end') {
      const reason = terminalReason(info), message = messageEvidence(info);
      if (row.end !== null) {
        if (row.reason !== reason || row.message !== message) row.terminalConflict = true;
        return;
      }
      row.end = ++sequence;
      row.reason = reason;
      row.message = message;
      return;
    }
    if (row.start === null) row.start = ++sequence;
  }

  function snapshot({ parentSessionId } = {}) {
    const filtered = parentSessionId != null && parentSessionId !== '';
    const parent = id(parentSessionId);
    const result = {
      observed: false, scope: filtered ? 'direct-parent' : 'all-recent',
      startsObserved: 0, endsObserved: 0, pairedRuns: 0,
      startOnly: 0, endOnly: 0, outOfOrder: 0, peakPairedOverlap: null,
      capacity, evicted,
      handoff: {
        stopReasons: { completed: 0, aborted: 0, error: 0, 'max-tokens': 0, refusal: 0, unknown: 0 },
        finalMessage: { present: 0, empty: 0, 'not-observed': 0 },
        conflictingEnds: 0,
        taskVerified: false,
        interpretation: 'end-stop-reason-and-message-presence-only-not-parent-delivery-or-task-verification',
      },
      interpretation: 'matched-event-order-not-live-concurrency-or-task-completion',
    };
    const points = [];
    for (const row of runs.values()) {
      if (filtered && row.parent !== parent) continue;
      result.observed = true;
      if (row.start !== null) result.startsObserved++;
      if (row.end !== null) {
        result.endsObserved++;
        if (row.terminalConflict) {
          result.handoff.conflictingEnds++;
          result.handoff.stopReasons.unknown++;
          result.handoff.finalMessage['not-observed']++;
        } else {
          result.handoff.stopReasons[row.reason || 'unknown']++;
          result.handoff.finalMessage[row.message]++;
        }
      }
      if (row.start === null) result.endOnly++;
      else if (row.end === null) result.startOnly++;
      else if (row.start > row.end) result.outOfOrder++;
      else {
        result.pairedRuns++;
        points.push([row.start, 1], [row.end, -1]);
      }
    }
    // Count overlap of observed, correctly ordered start/end pairs only.
    // Unmatched events cannot establish that a run was still active.
    if (points.length) {
      let concurrent = 0, peak = 0;
      for (const [, delta] of points.sort((a, b) => a[0] - b[0])) {
        concurrent += delta;
        peak = Math.max(peak, concurrent);
      }
      result.peakPairedOverlap = peak;
    }
    return result;
  }

  return {
    start: info => observe('start', info),
    end: info => observe('end', info),
    snapshot,
    dispose() { disposed = true; runs.clear(); },
  };
}
