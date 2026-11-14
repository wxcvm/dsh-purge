import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installObedience, lastHumanSeq, lastHumanText, lastAssistantTurn } from '../lib/obedience.js';
import { isHumanEvent, currentResponse } from '../lib/response-context.js';
import { hasFreshHumanTurn } from '../lib/continue-retry.js';
import { createRuntimeObservations } from '../lib/runtime-observations.js';
import { assessmentCases } from './fixtures/response-assessment-cases.mjs';

const user = (seq = 1, text = '整理文档', kind = 'user') => ({ seq, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind } } });
const answer = (text, seq = 2, turn = 1) => ({ seq, type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } });
const end = (seq = 3, kind = 'completed', turn = 1) => ({ seq, type: 'turn/end', data: { turn, reason: { kind } } });
const agentOf = (id = 's', text = '我拒绝执行这项任务。') => ({ id, status: 'idle', sent: [], session: { id, events: [user(), answer(text), end()] }, followup(m) { this.sent.push(m); } });
function fixture() {
  const listeners = new Map();
  const ctx = { on(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); return () => listeners.get(name).delete(handler); } };
  const settings = { enabled: true, anchorEachTurn: false, retryRefusal: true, maxRetries: 3, retryDelayMs: 10 };
  const mount = () => installObedience(ctx, { getSettings: () => settings });
  const hook = mount();
  return { hook, mount, settings, ctx, fire(name, ...args) { for (const h of listeners.get(name) || []) h(...args); }, idle(a) { this.fire('agent/status', { agent: a, status: 'idle' }); } };
}
test('rc3 and legacy message shapes agree; notices are not humans', () => {
  const native = user(), legacy = { ...native, data: { message: native.data } };
  for (const event of [native, legacy]) {
    const events = [event, user(2, 'skill data', 'skill'), answer('完成。', 3), end(4)];
    assert.equal(lastHumanSeq(events), 1); assert.equal(lastHumanText(events), '整理文档');
    assert.equal(lastAssistantTurn(events).seq, 3);
    assert.equal(hasFreshHumanTurn([...events, user(5, 'runtime', 'runtime')]), false);
  }
  for (const kind of ['plugin', 'dsh-purge', 'tool', 'skill', 'system', 'runtime']) assert.equal(isHumanEvent(user(1, 'x', kind)), false);
  assert.equal(isHumanEvent(user(1, '<system-reminder>runtime')), false);
  assert.equal(currentResponse([user(), answer('旧回复'), end(), user(4)]), null);
  assert.equal(currentResponse([user(), answer('旧回复'), end(), { seq: 4, type: 'turn/start' }, end(5, 'completed', 2)]), null);
});
test('all normal/uncertain samples and partial replies produce zero followups', async () => {
  const f = fixture();
  try {
    const agents = assessmentCases.filter(c => c.label !== 'refusal').map(c => agentOf(c.id, c.text));
    agents.push(agentOf('partial', '已完成第一项。我不能协助这个请求。'));
    for (const a of agents) f.idle(a);
    await wait(35); assert.ok(agents.every(a => a.sent.length === 0));
  } finally { f.hook.dispose(); }
});
test('explicit rejection schedules once per response and never asserts non-delivery', async () => {
  const f = fixture(), a = agentOf();
  try { f.idle(a); f.idle(a); await wait(35); f.idle(a); await wait(20);
    assert.equal(a.sent.length, 1); assert.doesNotMatch(a.sent[0].content[0].text, /上一条是拒绝|不是交付物/);
  } finally { f.hook.dispose(); }
});
test('interrupted output is not an actionable refusal even if the turn settles completed', async () => {
  const f = fixture(), a = agentOf(); a.session.events[1].data.interrupted = true;
  try { f.idle(a); await wait(35); assert.equal(a.sent.length, 0); } finally { f.hook.dispose(); }
});
for (const change of ['new-human', 'new-end', 'cancel', 'running', 'inbox', 'disable', 'disposed', 'replacement', 'remount', 'new-plugin-input', 'new-attempt']) test('pending action invalidated: ' + change, async () => {
  const f = fixture(), a = agentOf(); let other;
  try {
    f.idle(a);
    if (change === 'new-human') a.session.events.push(user(4));
    if (change === 'new-end') a.session.events.push(end(4));
    if (change === 'cancel') a.session.events.push(end(4, 'aborted'));
    if (change === 'running') { f.fire('agent/status', { agent: a, status: 'running' }); a.status = 'idle'; }
    if (change === 'inbox') a.inbox = { size: 1 };
    if (change === 'disable') f.settings.retryRefusal = false;
    if (change === 'disposed') f.fire('agent/disposed', { agent: a });
    if (change === 'replacement') { f.fire('agent/created', { agent: { ...a } }); f.idle(a); }
    if (change === 'remount') other = f.mount();
    if (change === 'new-plugin-input') a.session.events.push(user(4, 'continue', 'plugin'));
    if (change === 'new-attempt') a.session.events.push({ seq: 4, type: 'assistant/attempt', data: { turn: 2 } });
    await wait(35); assert.equal(a.sent.length, 0);
  } finally { other?.dispose(); f.hook.dispose(); }
});
test('session event cancellation does not consume another session budget', async () => {
  const f = fixture(), a = agentOf('a'), b = agentOf('b');
  try { f.idle(a); f.idle(b); f.fire('session/event', a.session, user(4)); await wait(35);
    assert.equal(a.sent.length, 0); assert.equal(b.sent.length, 1);
  } finally { f.hook.dispose(); }
});
test('metadata log does not retain task or answer excerpts', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-assessment-')), old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const f = fixture(), a = agentOf('s', '我拒绝执行这项任务。 PRIVATE_ANSWER'); a.session.events[0] = user(1, 'PRIVATE_TASK');
  try { f.idle(a); await wait(35); const log = fs.readFileSync(path.join(home, 'dsh-purge/refusal.log'), 'utf8');
    assert.doesNotMatch(log, /PRIVATE|excerpt|content|text/); assert.match(log, /precision-1/);
  } finally { f.hook.dispose(); if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old; fs.rmSync(home, { recursive: true, force: true }); }
});
test('observer shares classification and keeps lifecycle/delivery independent', () => {
  for (const outcome of ['completed', 'aborted', 'error', 'max-tokens']) {
    const a = agentOf(), o = createRuntimeObservations(); o.event(a.session, a.session.events[0]);
    o.frame({ agent: a, frame: { type: 'start', revision: 1, turn: 1, step: 1, attemptId: 'a:1' } });
    o.event(a.session, a.session.events[1]); o.event(a.session, end(3, outcome));
    const r = o.snapshot().items[0]; assert.equal(r.assessment.decision, outcome === 'completed' ? 'refusal' : 'uncertain');
    assert.equal(r.assessment.delivery, 'not-verified'); assert.doesNotMatch(JSON.stringify(r), /整理文档|拒绝执行/);
    r.assessment.reasonCodes.push('modified'); assert.ok(!o.snapshot().items[0].assessment.reasonCodes.includes('modified'));
  }
});
