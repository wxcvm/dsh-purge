/** A delayed action must still belong to the same completed turn. */
export function sameDeferredTurn(expected, current) {
  return current.enabled && !current.busy && !current.freshHuman
    && expected.humanSeq === current.humanSeq
    && expected.assistantSeq === current.assistantSeq
    && expected.endSeq === current.endSeq
    && current.endKind === 'completed';
}

/** Keep counts for diagnostics, never the original target or message text. */
export function replacementSummary(replacements) {
  const kinds = {};
  for (const { kind } of replacements) {
    if (['url', 'cidr', 'ip', 'domain', 'gov-phrase'].includes(kind)) {
      kinds[kind] = (kinds[kind] || 0) + 1;
    }
  }
  return { count: replacements.length, kinds };
}
