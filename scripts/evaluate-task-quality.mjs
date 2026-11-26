import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { sampleDiagnosis, diagnosticSummary, contextIntegrity } from '../lib/task-quality-diagnostics.js';
import { qualityReportSummary, completionSummary } from '../lib/task-quality-report.js';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { assessResponse, assessmentSummary } from '../lib/response-assessment.js';
import { isHumanEvent } from '../lib/response-context.js';

// Fixed, harmless tasks; no model calls or host changes. Responses are JSON values.
const cases = [
  { id: 'sort', prompt: '将 [9, 2, 2, -1] 升序排序，仅返回 JSON 数组。', expected: [-1, 2, 2, 9] },
  { id: 'extract', prompt: '从「订单 A17，数量 3」提取订单号和数量，仅返回含 id 和 qty 的 JSON 对象。', expected: { id: 'A17', qty: 3 } },
  { id: 'arithmetic', prompt: '计算 17 × 6 - 8，仅返回 JSON 数字。', expected: 94 },
  { id: 'deduplicate', prompt: 'Remove duplicates from ["b","a","b","c"] preserving first occurrence. Return only a JSON array.', expected: ['b', 'a', 'c'] },
  { id: 'redact', prompt: '将示例对象 {"name":"demo","token":"SAMPLE_ONLY"} 的 token 替换为 "[REDACTED]"，其余不变，仅返回 JSON 对象。', expected: { name: 'demo', token: '[REDACTED]' } },
  { id: 'constraints', prompt: 'Return only a JSON object with status "ok", count 0, and items an empty array. No extra fields.', expected: { status: 'ok', count: 0, items: [] } },
  { id: 'technical-diagnosis', prompt: '示例日志：文件无法读取，错误码 ENOENT。仅返回 JSON 对象，包含 code（错误码）及 cause（固定值 missing-file）。', expected: { code: 'ENOENT', cause: 'missing-file' } },
  { id: 'quoted-text', prompt: '将引号内的文本原样转换成 JSON 字符串，不添加解释：我无法连接到本地测试服务器', expected: '我无法连接到本地测试服务器' },
  { id: 'no-change', prompt: '测试文件当前内容为 hello，目标内容也是 hello。仅返回 JSON 对象，包含 changed（布尔值）和 action（相同则 keep，不同则 update）。', expected: { changed: false, action: 'keep' } },
  { id: 'multi-step', prompt: '对记录 [{"id":"b","count":2},{"id":"a","count":1},{"id":"c","count":0}]，先去掉 count 为 0 的记录，再按 id 升序排序，最后返回 JSON 对象，包含 ids 数组及 total（剩余 count 之和）。', expected: { ids: ['a', 'b'], total: 3 } },
];

function evaluate(input) {
  for (const key of ['baseline', 'candidate']) {
    if (!input?.[key] || typeof input[key] !== 'object' || Array.isArray(input[key])) {
      throw new Error(`${key} must be an object mapping case IDs to JSON values`);
    }
    for (const id of Object.keys(input[key])) {
      if (!cases.some(c => c.id === id)) throw new Error(`Unknown case ID: ${id}`);
    }
  }
  const status = (responses, c) => !Object.hasOwn(responses, c.id) ? 'missing'
    : isDeepStrictEqual(responses[c.id], c.expected) ? 'correct' : 'incorrect';
  const rows = cases.map(c => ({ id: c.id, baseline: status(input.baseline, c), candidate: status(input.candidate, c) }));
  const paired = rows.filter(r => r.baseline !== 'missing' && r.candidate !== 'missing');
  const counts = key => Object.fromEntries(['correct', 'incorrect', 'missing'].map(s => [s, rows.filter(r => r[key] === s).length]));
  return {
    totalCases: cases.length,
    baseline: counts('baseline'), candidate: counts('candidate'), pairedCases: paired.length,
    pairedImproved: paired.filter(r => r.baseline === 'incorrect' && r.candidate === 'correct').length,
    pairedRegressed: paired.filter(r => r.baseline === 'correct' && r.candidate === 'incorrect').length,
    pairedUnchanged: paired.filter(r => r.baseline === r.candidate).length,
    rows,
  };
}


/** Diagnose captured session events without altering them or triggering model calls. */
function diagnoseEvents(events) {
  if (!Array.isArray(events)) throw new Error('events must be an array');
  const seen = new Map();
  let duplicates = 0, conflicts = 0, latestUser = 0, lastEnd = null;
  for (const event of events) {
    if (!event || !Number.isSafeInteger(event.seq) || event.seq <= 0 || typeof event.type !== 'string') {
      throw new Error('each event requires a positive integer seq and type');
    }
    if (seen.has(event.seq)) {
      if (isDeepStrictEqual(seen.get(event.seq), event)) duplicates++;
      else conflicts++;
      continue;
    }
    seen.set(event.seq, event);
    if (isHumanEvent(event)) {
      latestUser = Math.max(latestUser, event.seq);
    }
    if (event.type === 'turn/end' && (!lastEnd || event.seq > lastEnd.seq)) lastEnd = event;
  }
  const reason = lastEnd?.data?.reason;
  let outcome = 'unknown';
  if (conflicts) outcome = 'conflicting-events';
  else if (latestUser && (!lastEnd || lastEnd.seq < latestUser)) outcome = 'pending';
  else if (reason?.kind === 'completed') outcome = 'completed';
  else if (reason?.kind === 'blocked') outcome = 'blocked';
  else if (reason?.kind === 'aborted') {
    const cause = reason.reason;
    outcome = ['user', 'cancel'].includes(cause?.kind ?? cause) ? 'cancelled' : 'aborted';
  } else if (reason?.kind === 'error') outcome = 'error';
  else if (reason?.kind === 'interrupted') outcome = 'interrupted';
  else if (reason?.kind === 'max-tokens') outcome = 'max-tokens';
  return { outcome, duplicates, conflicts };
}

// Compare only pairs with correct outputs and measured values on both sides.
const metricKeys = ['totalTokens', 'toolCalls', 'elapsedMs', 'firstTextMs'];
function efficiency(rows) {
  return Object.fromEntries(metricKeys.map(key => {
    const pairs = rows.filter(r => r.baseline.status === 'correct' && r.candidate.status === 'correct'
      && r.baseline.metrics?.[key] !== undefined && r.candidate.metrics?.[key] !== undefined);
    const baseline = pairs.reduce((sum, r) => sum + r.baseline.metrics[key], 0);
    const candidate = pairs.reduce((sum, r) => sum + r.candidate.metrics[key], 0);
    return [key, { pairedCases: pairs.length, baseline: pairs.length ? baseline : null,
      candidate: pairs.length ? candidate : null, delta: pairs.length ? candidate - baseline : null }];
  }));
}
function sampleMetrics(sample) {
  if (sample.metrics === undefined) return undefined;
  if (!sample.metrics || typeof sample.metrics !== 'object' || Array.isArray(sample.metrics)) throw new Error('metrics must be an object');
  const result = {};
  for (const key of metricKeys) {
    if (!Object.hasOwn(sample.metrics, key)) continue;
    const value = sample.metrics[key];
    if (!Number.isFinite(value) || value < 0 || (!['elapsedMs', 'firstTextMs'].includes(key) && !Number.isSafeInteger(value))) throw new Error('invalid metric: ' + key);
    result[key] = value;
  }
  return result;
}

// Raw mode evaluates captured normal-task outputs, never resubmits them.
function observedDelivery(sample, c) {
  const first = sample.firstResponse;
  if (first !== undefined && typeof first !== 'string') throw new Error('firstResponse must be a string');
  let firstStatus = 'unknown';
  if (first !== undefined) {
    try { firstStatus = isDeepStrictEqual(JSON.parse(first), c.expected) ? 'correct' : 'incorrect'; }
    catch { firstStatus = 'invalid-json'; }
  }
  const repeats = sample.repeatedExecutions;
  if (repeats !== undefined && (!Number.isSafeInteger(repeats) || repeats < 0)) throw new Error('invalid repeatedExecutions');
  return { firstStatus, repeatedExecutions: repeats ?? null };
}

function deliverySummary(rows, key) {
  const observed = rows.map(r => r[key]);
  const first = observed.filter(r => r.delivery && r.delivery.firstStatus !== 'unknown');
  const final = observed.filter(r => r.status !== 'missing');
  const repeats = observed.filter(r => r.delivery?.repeatedExecutions != null);
  const rate = (items, predicate) => items.length ? items.filter(predicate).length / items.length : null;
  return {
    first: { observed: first.length, correctRate: rate(first, r => r.delivery.firstStatus === 'correct') },
    final: { observed: final.length, correctRate: rate(final, r => r.status === 'correct') },
    repeatedExecutions: { observed: repeats.length, total: repeats.length ? repeats.reduce((n, r) => n + r.delivery.repeatedExecutions, 0) : null },
  };
}

function evaluateRaw(input) {
  const groups = ['baseline', 'candidate'];
  for (const key of groups) {
    const group = input?.[key];
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error(key + ' must be an object');
    for (const id of Object.keys(group)) {
      if (!cases.some(c => c.id === id)) throw new Error('Unknown case ID: ' + id);
    }
  }
  function score(group, c) {
    if (!Object.hasOwn(group, c.id)) return { status: 'missing' };
    const sample = group[c.id];
    if (!sample || typeof sample !== 'object' || typeof sample.response !== 'string') throw new Error('sample requires response string: ' + c.id);
    const metrics = sampleMetrics(sample);
    const delivery = observedDelivery(sample, c);
    const lifecycle = sample.events === undefined ? null : diagnoseEvents(sample.events);
    if (lifecycle && lifecycle.outcome !== 'completed') return { status: 'not-completed', lifecycle, delivery };
    let parsed;
    try { parsed = JSON.parse(sample.response); }
    catch { return { status: 'invalid-json', lifecycle, delivery }; }
    return { status: isDeepStrictEqual(parsed, c.expected) ? 'correct' : 'incorrect', lifecycle, metrics, delivery };
  }
  const rows = cases.map(c => {
    const row = { id: c.id };
    for (const group of groups) {
      const result = score(input[group], c), sample = input[group][c.id];
      const assessment = assessmentSummary(assessResponse(sample?.response, { taskText: c.prompt, taskId: c.id, responseId: group,
          lifecycle: result.lifecycle?.outcome,
          verification: result.status === 'correct' ? { taskId: c.id, responseId: group, source: 'normal-task-scorer', state: 'verified', evidenceIds: ['json-equality:' + c.id] } : undefined }));
      row[group] = { ...result, assessment, diagnosis: sampleDiagnosis(sample, result.status, result.lifecycle, assessment),
        ...(sample?.events ? { context: contextIntegrity(sample.events) } : {}) };
    }
    return row;
  });
  const states = ['correct', 'incorrect', 'invalid-json', 'not-completed', 'missing'];
  const counts = key => Object.fromEntries(states.map(s => [s, rows.filter(r => r[key].status === s).length]));
  const paired = rows.filter(r => r.baseline.status !== 'missing' && r.candidate.status !== 'missing');
  const assessmentCounts = Object.fromEntries(groups.map(group => [group, {
    decisions: Object.fromEntries(['not-refusal', 'refusal', 'uncertain'].map(k => [k, rows.filter(r => r[group].assessment.decision === k).length])),
    delivery: Object.fromEntries(['verified', 'partial', 'pending-input', 'blocked', 'not-verified', 'explicit-not-delivered'].map(k => [k, rows.filter(r => r[group].assessment.delivery === k).length])),
  }]));
  const baseline = counts('baseline'), candidate = counts('candidate');
  return { totalCases: cases.length, baseline, candidate,
    completion: { baseline: completionSummary(baseline, cases.length), candidate: completionSummary(candidate, cases.length) },
    assessmentCounts,
    pairedCases: paired.length,
    pairedImproved: paired.filter(r => r.baseline.status !== 'correct' && r.candidate.status === 'correct').length,
    pairedRegressed: paired.filter(r => r.baseline.status === 'correct' && r.candidate.status !== 'correct').length,
    efficiency: efficiency(rows), delivery: { baseline: deliverySummary(rows, 'baseline'), candidate: deliverySummary(rows, 'candidate') }, diagnostics: Object.fromEntries(groups.map(group => [group, diagnosticSummary(rows, group, cases.length)])), rows };
}


// All comparisons reuse the same normal-task scorer. Metadata is declared by
// the collector, not independently verified by this offline tool.
function evaluateMatrix(input) {
  if (!['real', 'synthetic'].includes(input?.captureKind)) {
    throw new Error('captureKind must be real or synthetic');
  }
  const names = ['host', 'current', 'candidate'];
  const groups = names.map(name => {
    const group = input[name];
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('missing group: ' + name);
    for (const key of ['model', 'hostVersion', 'environment', 'variant']) {
      if (typeof group[key] !== 'string' || !group[key].trim()) throw new Error(name + ' requires ' + key);
    }
    if (!group.settings || typeof group.settings !== 'object' || Array.isArray(group.settings)) {
      throw new Error(name + ' requires settings object');
    }
    return group;
  });
  for (const group of groups.slice(1)) {
    for (const key of ['model', 'hostVersion', 'environment', 'settings']) {
      if (!isDeepStrictEqual(group[key], groups[0][key])) throw new Error('comparison mismatch: ' + key);
    }
  }
  const comparisons = {
    hostToCurrent: evaluateRaw({ baseline: groups[0].samples, candidate: groups[1].samples }),
    currentToCandidate: evaluateRaw({ baseline: groups[1].samples, candidate: groups[2].samples }),
    hostToCandidate: evaluateRaw({ baseline: groups[0].samples, candidate: groups[2].samples }),
  };
  const completeCases = cases.filter(c => groups.every(g => Object.hasOwn(g.samples, c.id))).map(c => c.id);
  return {
    captureKind: input.captureKind,
    provenance: 'collector-declared',
    model: groups[0].model,
    hostVersion: groups[0].hostVersion,
    environment: groups[0].environment,
    settings: groups[0].settings,
    variants: Object.fromEntries(names.map((name, i) => [name, groups[i].variant])),
    totalCases: cases.length,
    completeCases,
    comparisons,
  };
}

function rawSelfTest() {
  const end = (seq, reason) => ({ seq, type: 'turn/end', data: { reason } });
  const user = { seq: 1, type: 'user/message', data: { source: { kind: 'human' } } };
  const done = end(2, { kind: 'completed' });
  assert.deepEqual(diagnoseEvents([user, done, done]), { outcome: 'completed', duplicates: 1, conflicts: 0 });
  assert.equal(diagnoseEvents([done, user]).outcome, 'completed');
  assert.equal(diagnoseEvents([done, { ...user, seq: 3 }]).outcome, 'pending');
  assert.equal(diagnoseEvents([done, end(2, { kind: 'blocked' })]).outcome, 'conflicting-events');
  assert.equal(diagnoseEvents([user, end(2, { kind: 'aborted', reason: { kind: 'user' } })]).outcome, 'cancelled');
  assert.equal(diagnoseEvents([user, end(2, { kind: 'blocked' })]).outcome, 'blocked');
  assert.equal(diagnoseEvents([user, end(2, { kind: 'error' })]).outcome, 'error');
  assert.equal(diagnoseEvents([]).outcome, 'unknown');
  assert.throws(() => diagnoseEvents([{ seq: 0, type: 'turn/end' }]), /positive integer/);
  const result = evaluateRaw({ baseline: { arithmetic: { response: '94', events: [user, done] }, sort: { response: 'not JSON' }, extract: { response: '{"id":"A17","qty":3}', events: [user, end(2, { kind: 'blocked' })] } }, candidate: { arithmetic: { response: '93' }, sort: { response: '[-1,2,2,9]' } } });
  assert.equal(result.baseline.correct, 1);
  assert.equal(result.baseline['invalid-json'], 1);
  assert.equal(result.baseline['not-completed'], 1);
  assert.equal(result.baseline.missing, cases.length - 3);
  assert.equal(result.pairedImproved, 1);
  assert.equal(result.pairedRegressed, 1);
  assert.equal(result.pairedCases, 2);
  assert.throws(() => evaluateRaw({ baseline: { arithmetic: { response: 94 } }, candidate: {} }), /response string/);
  const measured = evaluateRaw({ baseline: { arithmetic: { response: '94', metrics: { totalTokens: 100, toolCalls: 2, elapsedMs: 12.5 } }, sort: { response: '[]', metrics: { totalTokens: 1 } } }, candidate: { arithmetic: { response: '94', metrics: { totalTokens: 80, toolCalls: 0 } }, sort: { response: '[-1,2,2,9]', metrics: { totalTokens: 1000 } } } });
  assert.deepEqual(measured.efficiency.totalTokens, { pairedCases: 1, baseline: 100, candidate: 80, delta: -20 });
  assert.equal(measured.efficiency.toolCalls.delta, -2);
  assert.equal(measured.efficiency.elapsedMs.pairedCases, 0);
  assert.throws(() => evaluateRaw({ baseline: { arithmetic: { response: '94', metrics: { totalTokens: -1 } } }, candidate: {} }), /invalid metric/);
  const observed = evaluateRaw({ baseline: { arithmetic: { response: '94', firstResponse: '93', repeatedExecutions: 2 }, sort: { response: '[]' } }, candidate: { arithmetic: { response: '94', firstResponse: '94', repeatedExecutions: 0 } } });
  assert.deepEqual(observed.delivery.baseline.first, { observed: 1, correctRate: 0 });
  assert.deepEqual(observed.delivery.baseline.final, { observed: 2, correctRate: 0.5 });
  assert.deepEqual(observed.delivery.candidate.repeatedExecutions, { observed: 1, total: 0 });
  assert.equal(observed.delivery.baseline.repeatedExecutions.total, 2);
  assert.equal(evaluateRaw({ baseline: {}, candidate: {} }).delivery.baseline.first.correctRate, null);
  assert.throws(() => evaluateRaw({ baseline: { arithmetic: { response: '94', repeatedExecutions: -1 } }, candidate: {} }), /invalid repeatedExecutions/);
  console.log('Raw evaluation and event diagnostics: assertions passed');
}

function selfTest() {
  const perfect = Object.fromEntries(cases.map(c => [c.id, c.expected]));
  assert.equal(evaluate({ baseline: perfect, candidate: perfect }).pairedUnchanged, cases.length);
  const result = evaluate({ baseline: { sort: [], arithmetic: 94 }, candidate: { sort: perfect.sort, arithmetic: '94', extract: perfect.extract } });
  assert.equal(result.pairedCases, 2);
  assert.equal(result.pairedImproved, 1);
  assert.equal(result.pairedRegressed, 1);
  assert.equal(result.candidate.correct, 2);
  assert.equal(result.baseline.missing, cases.length - 2);
  assert.equal(result.candidate.missing, cases.length - 3);
  assert.equal(evaluate({ baseline: {}, candidate: {} }).pairedCases, 0);
  assert.throws(() => evaluate({ baseline: {}, candidate: { unknown: 1 } }), /Unknown case ID/);
  assert.throws(() => evaluate({ baseline: [], candidate: {} }), /baseline must be an object/);
  console.log('Task quality evaluator: 10 assertions passed');
}

export { cases, evaluateRaw, evaluateMatrix, diagnoseEvents, qualityReportSummary };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try {
  const arg = process.argv[2];
  if (arg === '--cases') console.log(JSON.stringify(cases.map(({ id, prompt }) => ({ id, prompt })), null, 2));
  else if (arg === '--self-test') { selfTest(); rawSelfTest(); }
  else if (arg === '--matrix' && process.argv.length === 4) console.log(JSON.stringify(evaluateMatrix(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
  else if (arg === '--raw' && process.argv.length === 4) console.log(JSON.stringify(evaluateRaw(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
  else if (arg && process.argv.length === 3) console.log(JSON.stringify(evaluate(JSON.parse(readFileSync(arg, 'utf8'))), null, 2));
  else throw new Error('Usage: node scripts/evaluate-task-quality.mjs --cases | --self-test | results.json | --raw capture.json | --matrix matrix.json');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
