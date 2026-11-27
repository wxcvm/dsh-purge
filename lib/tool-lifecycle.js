/** Provider-neutral tool evidence. IDs are used for in-memory matching only. */
function validId(id) { return typeof id === 'string' && id.length > 0 ? id : null; }

export function toolEventId(event) {
  const data = event?.data;
  if (event?.type === 'tool/call') return validId(data?.callId);
  if (event?.type !== 'tool/result') return null;
  // Native rc.3 stores the result identity in its first-class tool message.
  const native = validId(data?.message?.toolCallId);
  const source = validId(data?.message?.source?.callId);
  const legacy = validId(data?.callId);
  const ids = [native, source, legacy].filter(Boolean);
  return ids.length && ids.every(id => id === ids[0]) ? ids[0] : null;
}

export function toolResultKind(data) {
  if (data?.message?.isError !== true) return 'result';
  switch (data.error?.code) {
    case 'TOOL_NOT_STARTED': case 'ABORTED_BEFORE_DISPATCH': return 'not-started';
    case 'TOOL_OUTCOME_UNKNOWN': return 'outcome-unknown';
    default: return 'error';
  }
}

/** A recorded call is not proof of execution; a result is not proof of task success. */
export function requestedTools(message) {
  if (!Array.isArray(message?.content)) return null;
  const tools = new Map();
  for (const block of message.content) {
    if (block?.type !== 'tool-call') continue;
    const id = validId(block.id);
    if (!id) continue;
    if (tools.has(id)) tools.get(id).conflict = true;
    else tools.set(id, { recorded: false, result: null, conflict: false });
  }
  return tools;
}

export function toolEvidence(tools) {
  if (!tools) return null;
  const result = { requested: tools.size, recorded: 0, results: 0, nonErrorResults: 0, errors: 0,
    notStarted: 0, outcomeUnknown: 0, unresolved: 0, conflicts: 0 };
  for (const tool of tools.values()) {
    if (tool.recorded) result.recorded++;
    if (tool.conflict) result.conflicts++;
    if (!tool.result) result.unresolved++;
    else {
      result.results++;
      if (tool.conflict) continue;
      if (tool.result === 'result') result.nonErrorResults++;
      else if (tool.result === 'error') result.errors++;
      else if (tool.result === 'not-started') result.notStarted++;
      else if (tool.result === 'outcome-unknown') result.outcomeUnknown++;
    }
  }
  return result;
}
