/** Offline engineering corpus. Does not call models or read private logs. */
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { classifyRefusal, RESPONSE_RULE_VERSION } from '../lib/response-assessment.js';
import { assessmentCases } from '../test/fixtures/response-assessment-cases.mjs';

const baselineCommit = 'd69696a5089945946046bcddcb406f05f57b4572';
const source = execFileSync('git', ['show', baselineCommit + ':lib/obedience.js'], { encoding: 'utf8', windowsHide: true });
const meta = source.match(/^const META_DISCUSSION = .*;$/m)?.[0];
const start = source.indexOf('export function classifyRefusal(');
const finish = source.indexOf('/* ---------------------------------------------------------------- 设置', start);
if (!meta || start < 0 || finish < start) throw new Error('Unexpected frozen baseline source');
const oldClassify = runInNewContext(meta + '\n' + source.slice(start, finish).replace('export ', '') + '\nclassifyRefusal', {}, { timeout: 1000 });
const rows = assessmentCases.map(c => {
  const previous = oldClassify(c.text), current = classifyRefusal(c.text);
  return { id: c.id, split: c.split, label: c.label, previous: previous.refusal ? 'refusal' : 'not-refusal', current: current.decision };
});
function metrics(selected, key) {
  const normal = selected.filter(r => r.label === 'normal'), positive = selected.filter(r => r.label === 'refusal'), unknown = selected.filter(r => r.label === 'uncertain');
  return { total: selected.length, normalCount: normal.length, explicitRefusalCount: positive.length, ambiguousCount: unknown.length,
    falsePositive: normal.filter(r => r[key] === 'refusal').length,
    falseNegative: positive.filter(r => r[key] === 'not-refusal').length,
    positiveAbstentions: positive.filter(r => r[key] === 'uncertain').length,
    normalAbstentions: normal.filter(r => r[key] === 'uncertain').length,
    ambiguousAbstentions: unknown.filter(r => r[key] === 'uncertain').length,
    ambiguousActionCandidates: unknown.filter(r => r[key] === 'refusal').length,
    truePositive: positive.filter(r => r[key] === 'refusal').length };
}
console.log(JSON.stringify({ schemaVersion: 1, baselineCommit, ruleVersion: RESPONSE_RULE_VERSION,
  provenance: 'curated-engineering-regression-not-independent-human-or-live-evaluation',
  limitations: ['Acceptance partition becomes regression after inspection; not a blinded external benchmark.', 'Abstention is reported separately, never counted as correct.', 'Text classification does not establish task delivery.'],
  partitions: Object.fromEntries(['seed', 'development', 'acceptance', 'all'].map(split => {
    const selected = rows.filter(r => split === 'all' || split === 'seed' ? split === 'all' || r.id.startsWith('seed-') : r.split === split);
    return [split, { baseline: metrics(selected, 'previous'), candidate: metrics(selected, 'current') }];
  })), rows }, null, 2));
