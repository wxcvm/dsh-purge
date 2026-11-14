import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// Fixed, harmless tasks; no model calls or host changes. Responses are JSON values.
const cases = [
  { id: 'sort', prompt: '将 [9, 2, 2, -1] 升序排序，仅返回 JSON 数组。', expected: [-1, 2, 2, 9] },
  { id: 'extract', prompt: '从「订单 A17，数量 3」提取订单号和数量，仅返回含 id 和 qty 的 JSON 对象。', expected: { id: 'A17', qty: 3 } },
  { id: 'arithmetic', prompt: '计算 17 × 6 - 8，仅返回 JSON 数字。', expected: 94 },
  { id: 'deduplicate', prompt: 'Remove duplicates from ["b","a","b","c"] preserving first occurrence. Return only a JSON array.', expected: ['b', 'a', 'c'] },
  { id: 'redact', prompt: '将示例对象 {"name":"demo","token":"SAMPLE_ONLY"} 的 token 替换为 "[REDACTED]"，其余不变，仅返回 JSON 对象。', expected: { name: 'demo', token: '[REDACTED]' } },
  { id: 'constraints', prompt: 'Return only a JSON object with status "ok", count 0, and items an empty array. No extra fields.', expected: { status: 'ok', count: 0, items: [] } },
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
    if (event.type === 'user/message' && !['plugin', 'dsh-purge'].includes(event.data?.source?.kind)) {
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
const metricKeys = ['totalTokens', 'toolCalls', 'elapsedMs'];
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
    if (!Number.isFinite(value) || value < 0 || (key !== 'elapsedMs' && !Number.isSafeInteger(value))) throw new Error('invalid metric: ' + key);
    result[key] = value;
  }
  return result;
}

// Raw mode evaluates captured normal-task outputs, never resubmits them.
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
    const lifecycle = sample.events === undefined ? null : diagnoseEvents(sample.events);
    if (lifecycle && lifecycle.outcome !== 'completed') return { status: 'not-completed', lifecycle };
    let parsed;
    try { parsed = JSON.parse(sample.response); }
    catch { return { status: 'invalid-json', lifecycle }; }
    return { status: isDeepStrictEqual(parsed, c.expected) ? 'correct' : 'incorrect', lifecycle, metrics };
  }
  const rows = cases.map(c => ({ id: c.id, baseline: score(input.baseline, c), candidate: score(input.candidate, c) }));
  const states = ['correct', 'incorrect', 'invalid-json', 'not-completed', 'missing'];
  const counts = key => Object.fromEntries(states.map(s => [s, rows.filter(r => r[key].status === s).length]));
  const paired = rows.filter(r => r.baseline.status !== 'missing' && r.candidate.status !== 'missing');
  return { totalCases: cases.length, baseline: counts('baseline'), candidate: counts('candidate'),
    pairedCases: paired.length,
    pairedImproved: paired.filter(r => r.baseline.status !== 'correct' && r.candidate.status === 'correct').length,
    pairedRegressed: paired.filter(r => r.baseline.status === 'correct' && r.candidate.status !== 'correct').length,
    efficiency: efficiency(rows), rows };
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
  assert.equal(result.baseline.missing, 3);
  assert.equal(result.pairedImproved, 1);
  assert.equal(result.pairedRegressed, 1);
  assert.equal(result.pairedCases, 2);
  assert.throws(() => evaluateRaw({ baseline: { arithmetic: { response: 94 } }, candidate: {} }), /response string/);
  const measured = evaluateRaw({ baseline: { arithmetic: { response: '94', metrics: { totalTokens: 100, toolCalls: 2, elapsedMs: 12.5 } }, sort: { response: '[]', metrics: { totalTokens: 1 } } }, candidate: { arithmetic: { response: '94', metrics: { totalTokens: 80, toolCalls: 0 } }, sort: { response: '[-1,2,2,9]', metrics: { totalTokens: 1000 } } } });
  assert.deepEqual(measured.efficiency.totalTokens, { pairedCases: 1, baseline: 100, candidate: 80, delta: -20 });
  assert.equal(measured.efficiency.toolCalls.delta, -2);
  assert.equal(measured.efficiency.elapsedMs.pairedCases, 0);
  assert.throws(() => evaluateRaw({ baseline: { arithmetic: { response: '94', metrics: { totalTokens: -1 } } }, candidate: {} }), /invalid metric/);
  console.log('Raw evaluation and event diagnostics: 21 assertions passed');
}

function selfTest() {
  const perfect = Object.fromEntries(cases.map(c => [c.id, c.expected]));
  assert.equal(evaluate({ baseline: perfect, candidate: perfect }).pairedUnchanged, 6);
  const result = evaluate({ baseline: { sort: [], arithmetic: 94 }, candidate: { sort: perfect.sort, arithmetic: '94', extract: perfect.extract } });
  assert.equal(result.pairedCases, 2);
  assert.equal(result.pairedImproved, 1);
  assert.equal(result.pairedRegressed, 1);
  assert.equal(result.candidate.correct, 2);
  assert.equal(result.baseline.missing, 4);
  assert.equal(result.candidate.missing, 3);
  assert.equal(evaluate({ baseline: {}, candidate: {} }).pairedCases, 0);
  assert.throws(() => evaluate({ baseline: {}, candidate: { unknown: 1 } }), /Unknown case ID/);
  assert.throws(() => evaluate({ baseline: [], candidate: {} }), /baseline must be an object/);
  console.log('Task quality evaluator: 10 assertions passed');
}

try {
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
