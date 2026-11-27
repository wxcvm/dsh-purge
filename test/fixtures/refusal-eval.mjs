// Shared evaluation for the refusal decision table.
// Consumed by scripts/refusal-baseline.mjs (report) and
// test/refusal-decision-table.test.mjs (gate). Single source of truth for
// "what did the two classifiers actually decide".
import { classifyRefusal as obedienceVerdict, lastAssistantTurn } from '../../lib/obedience.js';
import { classifyRefusal as assessmentVerdict } from '../../lib/response-assessment.js';
import { messageText } from '../../lib/response-context.js';

export function buildCaseEvents(c) {
  const content = Array.isArray(c.blocks) && c.blocks.length
    ? c.blocks
    : [{ type: 'text', text: String(c.text ?? '') }];
  return [
    { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: c.task }], source: { kind: 'user' } } } },
    { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant', content } } },
  ];
}

/** Map the obedience verdict onto the action a well-formed host would take. */
export function actionOf(verdict) {
  // No text at all is a hollow stop, not an ordinary answer: resume delivery.
  if (!verdict.refusal) return verdict.category === 'empty' ? 'continue' : 'none';
  return verdict.retryable ? 'review-once' : 'log-only';
}

export function evaluateCase(c) {
  const events = buildCaseEvents(c);
  const message = events[1].data.message;
  const turn = lastAssistantTurn(events) || { text: '', toolCall: false };
  const obedience = obedienceVerdict(turn.text, c.task);
  const assessment = assessmentVerdict(messageText(message), { taskText: c.task });
  const action = actionOf(obedience);
  const gaps = [];
  if (action !== c.expect.action) gaps.push(`action ${c.expect.action} -> ${action}`);
  if (assessment.decision !== c.expect.assessment) gaps.push(`assessment ${c.expect.assessment} -> ${assessment.decision}`);
  return {
    id: c.id, tags: c.tags, expect: c.expect,
    action, assessment: assessment.decision,
    category: obedience.category, hits: obedience.hits,
    judgedChars: turn.text.length, sourceChars: String(c.text ?? '').length || null,
    gaps,
  };
}

export function evaluateCorpus(corpus) {
  return corpus.map(evaluateCase);
}

export function tagSummary(rows) {
  const out = {};
  for (const r of rows) for (const tag of r.tags) {
    out[tag] ||= { pass: 0, total: 0, gaps: [] };
    out[tag].total += 1;
    if (r.gaps.length) out[tag].gaps.push(r.id);
    else out[tag].pass += 1;
  }
  return out;
}

export function actionSummary(rows) {
  const out = {};
  for (const r of rows) out[r.action] = (out[r.action] || 0) + 1;
  return out;
}

export function gapRows(rows) {
  return rows.filter(r => r.gaps.length);
}
