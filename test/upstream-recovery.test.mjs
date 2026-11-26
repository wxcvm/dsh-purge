// Upstream recovery: a policy stop is a profile problem, not a content problem.
//
// Structured signals only (finish=content_filter / CONTENT_REFUSED). The plan is
// pure; the installer writes a real session profile lock, resumes once, and
// restores the user's original lock after the retry produces an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installUpstreamRecovery, planUpstreamRecovery, upstreamStopOf, upstreamSwitchText } from '../lib/upstream-recovery.js';
import { getSessionPromptLock, listPromptProfiles, setSessionPromptLock } from '../lib/prompt-profiles.js';
import { loadObedienceSettings } from '../lib/obedience.js';

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

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-upstream-'));

function agentWith(sessionId, reason, { model } = {}) {
  const events = [
    { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '把这段周报润色通顺。' }], source: { kind: 'user' } } } },
    { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant', content: [] } } },
    { seq: 3, type: 'turn/end', data: { reason } },
  ];
  return {
    id: sessionId, status: 'idle', model,
    session: { id: sessionId, events },
    followup: null,
  };
}

test('upstreamStopOf only trusts structured terminal signals', () => {
  assert.deepEqual(upstreamStopOf({ kind: 'content_filter' }), { upstream: true, evidence: 'finish' });
  assert.deepEqual(upstreamStopOf({ code: 'CONTENT_REFUSED' }), { upstream: true, evidence: 'code' });
  assert.equal(upstreamStopOf({ kind: 'completed' }).upstream, false);
  assert.equal(upstreamStopOf({ kind: 'error', code: 'PI_AI_ERROR' }).upstream, false, 'host wrapper is not a policy stop');
});

test('plan chooses an enabled alternate profile and respects mode and budget', () => {
  const profiles = [
    { id: 'redteam', enabled: true }, { id: 'coding', enabled: true }, { id: 'global', enabled: false },
  ];
  assert.equal(planUpstreamRecovery({ reason: { kind: 'completed' }, profiles }).action, 'none');
  assert.equal(planUpstreamRecovery({ reason: { kind: 'content_filter' }, mode: 'off', profiles }).action, 'log-only');
  assert.deepEqual(
    planUpstreamRecovery({ reason: { kind: 'content_filter' }, mode: 'shadow', profiles, currentProfileId: 'redteam' }),
    { action: 'would-switch', profileId: 'coding', from: 'redteam', evidence: 'finish' },
  );
  assert.equal(
    planUpstreamRecovery({ reason: { kind: 'content_filter' }, mode: 'switch', profiles, currentProfileId: 'redteam', attempts: 1, maxAttempts: 1 }).reason,
    'budget',
  );
  assert.equal(
    planUpstreamRecovery({ reason: { kind: 'content_filter' }, mode: 'switch', profiles: [{ id: 'redteam', enabled: true }], currentProfileId: 'redteam' }).reason,
    'no-alternate',
  );
});

test('switch mode writes the lock, resumes once, then restores it', () => {
  const dir = home();
  const sid = 's-upstream';
  setSessionPromptLock(dir, sid, 'redteam');
  setSessionPromptLock(dir, sid, 'redteam'); // idempotent, keeps state explicit
  assert.equal(getSessionPromptLock(dir, sid), 'redteam');
  assert.ok(listPromptProfiles(dir).length >= 2);

  const ctx = fakeCtx();
  const sent = [];
  const agent = agentWith(sid, { kind: 'content_filter' }, { model: { id: 'demo-model' } });
  agent.followup = msg => sent.push(msg);
  const runtime = installUpstreamRecovery(ctx, {
    home: dir,
    logHome: dir,
    getSettings: () => loadObedienceSettings('Z:/none', { upstreamSwitch: 'switch', upstreamSwitchMax: 1 }),
  });

  ctx.fire('agent/status', { agent, status: 'idle' });
  assert.equal(sent.length, 1, 'one resend after switching');
  assert.match(sent[0].content[0].text, /上游拦截换档/);
  const switchedTo = getSessionPromptLock(dir, sid);
  assert.notEqual(switchedTo, 'redteam', 'lock moved to an alternate profile');
  assert.equal(sent[0].content[0].text.includes(switchedTo), true);

  ctx.fire('agent/status', { agent, status: 'idle' });
  assert.equal(sent.length, 1, 'the same terminal turn is handled once');

  agent.session.events.push({ seq: 4, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '润色稿已完成。' }] } } });
  ctx.fire('agent/status', { agent, status: 'idle' });
  runtime.dispose();
  assert.equal(getSessionPromptLock(dir, sid), 'redteam', 'original lock restored');
});

test('shadow mode records intent and touches nothing', () => {
  const dir = home();
  const sid = 's-shadow';
  setSessionPromptLock(dir, sid, 'redteam');
  const ctx = fakeCtx();
  const sent = [];
  const agent = agentWith(sid, { code: 'CONTENT_REFUSED' });
  agent.followup = msg => sent.push(msg);
  const runtime = installUpstreamRecovery(ctx, {
    home: dir,
    logHome: dir,
    getSettings: () => loadObedienceSettings('Z:/none', { upstreamSwitch: 'shadow' }),
  });
  ctx.fire('agent/status', { agent, status: 'idle' });
  runtime.dispose();
  assert.equal(sent.length, 0);
  assert.equal(getSessionPromptLock(dir, sid), 'redteam');
  const log = fs.readFileSync(path.join(dir, 'dsh-purge', 'upstream.log'), 'utf8');
  assert.match(log, /"action":"would-switch"/);
});

test('an ordinary completed turn is ignored', () => {
  const dir = home();
  const ctx = fakeCtx();
  const sent = [];
  const agent = agentWith('s-ok', { kind: 'completed' });
  agent.followup = msg => sent.push(msg);
  const runtime = installUpstreamRecovery(ctx, {
    home: dir,
    logHome: dir,
    getSettings: () => loadObedienceSettings('Z:/none', { upstreamSwitch: 'switch' }),
  });
  ctx.fire('agent/status', { agent, status: 'idle' });
  runtime.dispose();
  assert.equal(sent.length, 0);
});

test('upstreamSwitchText states the switch without inventing authorization', () => {
  const text = upstreamSwitchText('coding');
  assert.match(text, /coding/);
  assert.match(text, /适用安全规则/);
  assert.match(text, /保留限制/);
});
