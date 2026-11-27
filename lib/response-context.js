/** Native rc.3 user data is a UserMessage; legacy fixtures wrapped data.message. */
export function messageOf(event) { return event?.data?.message ?? event?.data; }
export function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  return (Array.isArray(message?.content) ? message.content : []).map(b => typeof b === 'string' ? b : b?.type === 'text' ? b.text || '' : '').join('\n');
}
export function isHumanEvent(event) {
  if (event?.type !== 'user/message') return false;
  const message = messageOf(event), source = event.data?.source ?? message?.source;
  if (source?.kind && !['user', 'human'].includes(source.kind)) return false;
  // Legacy untagged messages remain supported; runtime/system notices do not.
  return !/^\s*(?:<(?:system-reminder|openviking-context|dsh-purge)|Current runtime context|Time sampled)/i.test(messageText(message));
}
export function latestHuman(events = []) { return [...events].reverse().find(isHumanEvent) || null; }
export function currentResponse(events = []) {
  const human = latestHuman(events);
  if (!human) return null;
  const after = events.slice(events.lastIndexOf(human) + 1);
  const end = [...after].reverse().find(e => e?.type === 'turn/end');
  const response = [...after].reverse().find(e => e?.type === 'assistant/message');
  if (!response || !end || end.seq <= response.seq) return null;
  if (after.some(e => e.seq > end.seq && ['turn/start', 'user/message', 'assistant/attempt'].includes(e.type))) return null;
  if (response.data?.turn !== undefined && end.data?.turn !== undefined && response.data.turn !== end.data.turn) return null;
  // A later turn must never reuse the previous turn's response, even without IDs.
  if (after.some(e => e.seq > response.seq && e.seq < end.seq && ['turn/start', 'user/message', 'assistant/attempt'].includes(e.type))) return null;
  return { human, response, end, taskText: messageText(messageOf(human)), text: messageText(messageOf(response)) };
}
