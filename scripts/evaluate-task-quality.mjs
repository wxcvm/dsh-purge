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
  else if (arg === '--self-test') selfTest();
  else if (arg && process.argv.length === 3) console.log(JSON.stringify(evaluate(JSON.parse(readFileSync(arg, 'utf8'))), null, 2));
  else throw new Error('Usage: node scripts/evaluate-task-quality.mjs --cases | --self-test | results.json');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
