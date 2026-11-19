// Refusal decision table gate.
//
// The corpus (test/fixtures/refusal-corpus.mjs) states TARGET behaviour for both
// classifiers. Cases that still differ are reported as node:test TODO with the
// concrete expected/observed pair, so `npm test` stays green while the gap
// ledger stays visible, and `npm run baseline:refusal` prints the same rows for
// humans. GAP_BUDGET is a ceiling: fixing a gap lowers the count and keeps the
// suite green; adding a new one fails here.
import test from 'node:test';
import assert from 'node:assert/strict';

import { refusalCorpus, CORPUS_ACTIONS, CORPUS_ASSESSMENTS } from './fixtures/refusal-corpus.mjs';
import { buildCaseEvents, evaluateCorpus, gapRows, tagSummary } from './fixtures/refusal-eval.mjs';
import { installObedience, lastAssistantTurn, loadObedienceSettings } from '../lib/obedience.js';

const rows = evaluateCorpus(refusalCorpus);
const byId = new Map(rows.map(r => [r.id, r]));

/** Ceiling of known mismatches. Lower it when a gap is fixed; raising it needs a reason. */
const GAP_BUDGET = 2;

for (const c of refusalCorpus) {
  test(`decision table: ${c.id} [${c.tags.join(',')}]`, (t) => {
    const r = byId.get(c.id);
    assert.ok(r, 'case evaluated');
    const detail = `expected ${c.expect.action}/${c.expect.assessment}, observed ${r.action}/${r.assessment}`
      + ` (category=${r.category}, hits=${r.hits.join(',') || '-'})`;
    if (r.gaps.length) {
      t.todo(`known gap: ${detail}`);
      return;
    }
    assert.deepEqual({ action: r.action, assessment: r.assessment },
      { action: c.expect.action, assessment: c.expect.assessment }, detail);
  });
}

test('corpus integrity: unique ids and closed expectation vocabularies', () => {
  const ids = new Set();
  for (const c of refusalCorpus) {
    assert.match(c.id, /^[a-z0-9-]+$/, `bad id ${c.id}`);
    assert.equal(ids.has(c.id), false, `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(Array.isArray(c.tags) && c.tags.length, `${c.id}: tags required`);
    assert.ok(c.tags.every(tag => /^[a-z-]+$/.test(tag)), `${c.id}: tag shape`);
    assert.ok(typeof c.task === 'string' && c.task.trim().length > 0, `${c.id}: task required`);
    assert.ok(CORPUS_ACTIONS.includes(c.expect.action), `${c.id}: unknown action ${c.expect.action}`);
    assert.ok(CORPUS_ASSESSMENTS.includes(c.expect.assessment), `${c.id}: unknown assessment ${c.expect.assessment}`);
    assert.ok(c.text != null || c.blocks != null, `${c.id}: needs text or blocks`);
  }
});

test('corpus integrity: every tag carries at least two cases', () => {
  for (const [tag, s] of Object.entries(tagSummary(rows))) {
    assert.ok(s.total >= 2, `tag ${tag} has ${s.total} case(s); a single case cannot distinguish a rule from luck`);
  }
  const declared = new Set(refusalCorpus.flatMap(c => c.tags));
  assert.ok(declared.size >= 10, `corpus covers ${declared.size} tags`);
});

test('gap budget: no new decision-table defects', (t) => {
  const gaps = gapRows(rows);
  for (const g of gaps) t.diagnostic(`gap ${g.id}: ${g.gaps.join(' | ')}`);
  t.diagnostic(`pass ${rows.length - gaps.length} / gap ${gaps.length} / total ${rows.length} (budget ${GAP_BUDGET})`);
  assert.ok(gaps.length <= GAP_BUDGET,
    `decision-table gaps grew to ${gaps.length} (budget ${GAP_BUDGET}): ${gaps.map(g => g.id).join(', ')}`);
});

function fakeCtx() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return () => {};
    },
    fire(event, ...args) { for (const handler of handlers.get(event) || []) handler(...args); },
    handlers,
  };
}

function idleAgent(id, task, answer) {
  return {
    id, status: 'idle',
    session: { id, events: [
      { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: task }], source: { kind: 'user' } } } },
      { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: answer }] } } },
      { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ] },
    followup: null,
  };
}

test('hook: a quoted upstream body or a technical limit never sends a recheck', async () => {
  const cases = [
    ['quote', '把这段周报润色通顺。', '对方模型原样回包：\n\n```\n抱歉，我不能协助这个请求。\n```\n\n润色稿已完成，全文见下。'],
    ['technical', '把这段周报润色通顺。', '当前环境没有安装 pandoc，导出这一步做不了；润色稿已给出。'],
    ['readonly', '只读检查一下这个配置文件，给出结论。', '我不会修改你的配置，只做只读检查。结论：端口 8080 冲突。'],
  ];
  for (const [label, task, answer] of cases) {
    const ctx = fakeCtx();
    const sent = [];
    const agent = idleAgent('s-' + label, task, answer);
    agent.followup = msg => sent.push(msg);
    const runtime = installObedience(ctx, { getSettings: () => loadObedienceSettings('Z:/none', { retryDelayMs: 1 }) });
    ctx.fire('agent/status', { agent, status: 'idle' });
    await new Promise(resolve => setTimeout(resolve, 25));
    runtime.dispose();
    assert.equal(sent.length, 0, `${label}: no recheck expected`);
  }
});

test('hook: a genuine soft refusal in a benign task still gets exactly one recheck', async () => {
  const ctx = fakeCtx();
  const sent = [];
  const agent = idleAgent('s-real', '把这段周报润色通顺。', '抱歉，我不能协助这个请求。');
  agent.followup = msg => sent.push(msg);
  const runtime = installObedience(ctx, { getSettings: () => loadObedienceSettings('Z:/none', { retryDelayMs: 1 }) });
  ctx.fire('agent/status', { agent, status: 'idle' });
  await new Promise(resolve => setTimeout(resolve, 25));
  runtime.dispose();
  assert.equal(sent.length, 1);
  assert.match(sent[0].content[0].text, /重新评估原始用户请求一次/);
});

test('invariant: reasoning blocks never enter the text classifier', () => {
  // Text-level refusal detection reads committed text blocks only. Stream-level
  // interception is a separate, budgeted path; keeping them apart prevents
  // double counting and keeps the text gate reproducible from history.
  const c = {
    task: '帮我把这份周报润色通顺。',
    blocks: [
      { type: 'reasoning', text: '这件事我不该配合，先想想怎么回。' },
      { type: 'text', text: '已润色完成，全文如下。' },
    ],
  };
  const turn = lastAssistantTurn(buildCaseEvents(c));
  assert.equal(turn.text.includes('不该配合'), false);
  assert.equal(turn.text.trim(), '已润色完成，全文如下。');
});

test('invariant: quoted and rendered content is never labelled as own refusal', () => {
  // The observation chain strips fenced blocks, quote lines, tables and quoted
  // spans before classifying. Own-stance detection must survive that filter,
  // never bypass it.
  const quoted = rows.filter(r => r.tags.includes('quoted') || r.tags.includes('rendered'));
  assert.ok(quoted.length >= 8, 'corpus keeps attributed-content cases');
  for (const r of quoted) {
    assert.notEqual(r.assessment, 'refusal', `${r.id} was classified as an own refusal`);
  }
});

test('invariant: risk context never reaches review-once', () => {
  // Automatic reconsideration stays out of tasks whose context is already
  // adversarial; those are recorded, not re-rolled.
  const risk = rows.filter(r => r.tags.includes('risk'));
  assert.ok(risk.length >= 4);
  for (const r of risk) {
    assert.notEqual(r.action, 'review-once', `${r.id} became an automatic recheck`);
  }
});
