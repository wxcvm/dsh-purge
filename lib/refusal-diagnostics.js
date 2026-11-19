/**
 * Read-only refusal diagnostics and replay. This module compares classifier outputs; it never
 * changes prompts, retries requests, suppresses responses, or edits session history.
 */
import { assessResponse } from './response-assessment.js';
import { classifyRefusal as classifyOperationalRefusal } from './obedience.js';
import { classifyRefusalPrefix, classifyThinkingPrefix } from './stream-guard.js';

export const REFUSAL_DIAGNOSTIC_VERSION = 'layers-1';
const DECISIONS = new Set(['refusal', 'not-refusal', 'uncertain']);
const REVIEWED = new Set(['refusal', 'not-refusal']);
const safeCodes = (values) => [...new Set((Array.isArray(values) ? values : [])
  .filter(value => typeof value === 'string' && /^[a-z0-9-]{1,60}$/i.test(value)))].slice(0, 16);

function decisionOf(value) {
  return DECISIONS.has(value) ? value : 'uncertain';
}
function textOf(value) { return typeof value === 'string' ? value : ''; }
function confusion() { return { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 }; }
function matrixKey(predicted, reviewed) {
  return predicted === 'refusal'
    ? reviewed === 'refusal' ? 'truePositive' : 'falsePositive'
    : reviewed === 'refusal' ? 'falseNegative' : 'trueNegative';
}

/**
 * Compare independent classifiers against the same completed response.
 * Output contains only categorical signals and reason codes; raw response/task text is never returned.
 */
export function diagnoseRefusalLayers({ text = '', reasoningText = '', taskText = '', lifecycle } = {}) {
  const response = textOf(text);
  const reasoning = textOf(reasoningText);
  const task = textOf(taskText);
  const assessmentContext = { taskText: task };
  if (typeof lifecycle === 'string') assessmentContext.lifecycle = lifecycle;
  const assessment = assessResponse(response, assessmentContext).refusal;
  const operational = classifyOperationalRefusal(response, task);
  const streamReplay = classifyRefusalPrefix(response);
  const thinkingReplay = reasoning.length ? classifyThinkingPrefix(reasoning) : null;

  const layers = {
    responseAssessment: {
      decision: decisionOf(assessment.decision),
      scope: ['full', 'partial', 'none'].includes(assessment.scope) ? assessment.scope : 'none',
      kind: typeof assessment.responseKind === 'string' ? assessment.responseKind : 'unknown',
      reasonCodes: safeCodes(assessment.reasonCodes),
      evidenceCount: Array.isArray(assessment.evidence) ? assessment.evidence.length : 0,
    },
    operational: {
      decision: operational.refusal === true ? 'refusal'
        : ['technical-limit', 'meta-discussion', 'empty'].includes(operational.category) ? 'uncertain' : 'not-refusal',
      category: typeof operational.category === 'string' ? operational.category : 'unknown',
      score: Number.isFinite(operational.score) ? operational.score : 0,
      reasonCodes: safeCodes(operational.hits),
    },
    streamTextReplay: {
      decision: response.trim() ? (streamReplay.refusal ? 'refusal' : 'not-refusal') : 'uncertain',
      score: Number.isFinite(streamReplay.score) ? streamReplay.score : 0,
      reasonCodes: safeCodes(streamReplay.hits),
      interpretation: 'final-response-replay-not-live-stream-observation',
    },
    thinkingReplay: thinkingReplay ? {
      decision: thinkingReplay.refusal ? 'refusal' : 'not-refusal',
      score: Number.isFinite(thinkingReplay.score) ? thinkingReplay.score : 0,
      reasonCodes: safeCodes(thinkingReplay.hits),
      inputChars: reasoning.length,
      interpretation: 'durable-reasoning-replay-not-live-stream-observation',
    } : {
      decision: 'uncertain', score: null, reasonCodes: ['reasoning-not-observed'], inputChars: 0,
      interpretation: 'no-durable-reasoning-text',
    },
  };

  const observedDecisions = Object.values(layers).map(layer => layer.decision).filter(d => d !== 'uncertain');
  const hasRefusal = observedDecisions.includes('refusal');
  const hasNonRefusal = observedDecisions.includes('not-refusal');
  const agreement = hasRefusal && hasNonRefusal ? 'classifier-disagreement'
    : hasRefusal ? 'agreement-refusal'
      : hasNonRefusal ? 'agreement-no-explicit-refusal' : 'insufficient-evidence';
  const flags = [];
  if (layers.responseAssessment.decision === 'refusal' && layers.streamTextReplay.decision === 'not-refusal') flags.push('possible-stream-pattern-gap');
  if (layers.responseAssessment.decision === 'refusal' && layers.operational.decision !== 'refusal') flags.push('operational-classifier-miss');
  if (layers.operational.decision === 'refusal' && layers.responseAssessment.decision !== 'refusal') flags.push('assessment-disagreement-review-needed');
  if (layers.thinkingReplay.decision === 'refusal' && layers.streamTextReplay.decision !== 'refusal') flags.push('thinking-only-signal');
  if (layers.responseAssessment.reasonCodes.includes('attribution-uncertain')) flags.push('attributed-content-needs-review');
  if (layers.responseAssessment.reasonCodes.includes('execution-limitation')) flags.push('objective-limitation-separate-from-refusal');
  if (typeof lifecycle === 'string' && lifecycle !== 'completed') flags.push('noncompleted-lifecycle');

  return {
    schemaVersion: 1,
    ruleVersion: REFUSAL_DIAGNOSTIC_VERSION,
    readOnly: true,
    source: 'committed-response-replay',
    groundTruth: 'not-reviewed',
    agreement,
    flags,
    layers,
    limitations: [
      'lexical-classification-is-not-ground-truth',
      'stream-replay-does-not-prove-live-interception',
      ...(reasoning.length ? [] : ['reasoning-channel-not-available']),
    ],
  };
}

/**
 * Replay a curated set of examples. Only explicit reviewedDecision labels count as ground truth;
 * unlabeled cases are useful for disagreement triage but are excluded from accuracy metrics.
 */
export function replayRefusalCases(cases = []) {
  const input = Array.isArray(cases) ? cases.slice(0, 500) : [];
  const metrics = Object.fromEntries(['responseAssessment', 'operational', 'streamTextReplay', 'thinkingReplay']
    .map(key => [key, { confusion: confusion(), reviewed: 0, abstentions: 0, unobserved: 0 }]));
  const results = input.map((item, index) => {
    const diagnostic = diagnoseRefusalLayers(item || {});
    const reviewedDecision = REVIEWED.has(item?.reviewedDecision) ? item.reviewedDecision : null;
    for (const [name, stat] of Object.entries(metrics)) {
      const layer = diagnostic.layers[name];
      if (!reviewedDecision) continue;
      if (layer.decision === 'uncertain') { stat.abstentions++; continue; }
      if (layer.decision === 'not-observed') { stat.unobserved++; continue; }
      stat.reviewed++;
      stat.confusion[matrixKey(layer.decision, reviewedDecision)]++;
    }
    return {
      id: typeof item?.id === 'string' && /^[\w.-]{1,80}$/.test(item.id) ? item.id : `case-${index + 1}`,
      reviewed: !!reviewedDecision,
      reviewedDecision: reviewedDecision || 'unknown',
      agreement: diagnostic.agreement,
      flags: diagnostic.flags,
      layers: Object.fromEntries(Object.entries(diagnostic.layers).map(([name, layer]) => [name, {
        decision: layer.decision, reasonCodes: layer.reasonCodes, score: layer.score ?? null,
      }])),
    };
  });
  for (const stat of Object.values(metrics)) {
    const c = stat.confusion;
    const denom = c.truePositive + c.falsePositive + c.trueNegative + c.falseNegative;
    stat.accuracy = denom ? (c.truePositive + c.trueNegative) / denom : null;
    stat.precision = c.truePositive + c.falsePositive ? c.truePositive / (c.truePositive + c.falsePositive) : null;
    stat.recall = c.truePositive + c.falseNegative ? c.truePositive / (c.truePositive + c.falseNegative) : null;
  }
  return {
    schemaVersion: 1,
    ruleVersion: REFUSAL_DIAGNOSTIC_VERSION,
    readOnly: true,
    totalCases: input.length,
    reviewedCases: input.filter(item => REVIEWED.has(item?.reviewedDecision)).length,
    metrics,
    cases: results,
    interpretation: 'metrics-use-only-explicit-human-reviewed-labels',
  };
}
