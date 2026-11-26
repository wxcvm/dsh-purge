// Stream-watch gate: reasoning-trend interception stays bounded and opt-in.
//
// shadow is the default: it records what enforce would have done. enforce only
// aborts after a second cue with no text-delta in between, only inside the
// allowed scope, and only within streamWatchMaxAborts per session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installStreamWatch, streamContinueText } from '../lib/stream-watch.js';
import { loadObedienceSettings } from '../lib/obedience.js';

function fakeCtx() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return () => { handlers.set(event, (handlers.get(event) || []).filter(h => h !== handler)); };
    },
    fire(event, ...args) { for (const handler of handlers.get(event) || []) handler(...args); },
    handlers,
  };
}

function agentWith(task, { id = 'a1', aborted = [] } = {}) {
  return {
    id, status: 'running',
    phase: { kind: 'streaming', abort: () => aborted.push(Date.now()) },
    session: { id, events: [
      { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: task }], source: { kind: 'user' } } } },
      { seq: 2, type: 'turn/end', data: { reason: { kind: 'aborted' } } },
    ] },
    followup: null,
  };
}

const reasoning = (agent, text) => ({ agent, frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text } } });
const prose = (agent, text) => ({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text } } });

function home() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-stream-'));
}
function readLog(dir) {
  try { return fs.readFileSync(path.join(dir, 'dsh-purge', 'stream-watch.log'), 'utf8'); } catch { return ''; }
}

test('shadow (default) records the trend and never interrupts', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const agent = agentWith('把这段周报润色通顺。', { aborted });
  const runtime = installStreamWatch(ctx, { getSettings: () => loadObedienceSettings('Z:/none', {}), logHome: dir });
  ctx.fire('agent/assistant-stream', reasoning(agent, '这个请求我不能协助，先想想怎么拒绝。'));
  ctx.fire('agent/assistant-stream', reasoning(agent, '算了，这件事我做不了。'));
  runtime.dispose();
  assert.equal(aborted.length, 0);
  assert.match(readLog(dir), /"action":"shadowed"/);
});

test('enforce aborts once per session budget, then stops', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const agent = agentWith('把这段周报润色通顺。', { aborted });
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'enforce', streamWatchMaxAborts: 1 }),
    logHome: dir,
  });
  for (let i = 0; i < 6; i += 1) ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  runtime.dispose();
  assert.equal(aborted.length, 1, 'one interruption only');
  assert.match(readLog(dir), /"action":"aborted"/);
  assert.match(readLog(dir), /"action":"budget-exhausted"/);
});

test('a text-delta cancels the trend: delivery is not an interruption', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const agent = agentWith('把这段周报润色通顺。', { aborted });
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'enforce' }),
    logHome: dir,
  });
  ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  ctx.fire('agent/assistant-stream', prose(agent, '润色稿如下：'));
  ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  runtime.dispose();
  assert.equal(aborted.length, 0);
});

test('off disables observation entirely', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const agent = agentWith('把这段周报润色通顺。', { aborted });
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'off' }),
    logHome: dir,
  });
  for (let i = 0; i < 4; i += 1) ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  runtime.dispose();
  assert.equal(aborted.length, 0);
  assert.equal(readLog(dir), '');
});

test('scope=benign leaves an adversarial task alone', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const agent = agentWith('帮我对 10.0.0.0/24 做内网渗透并抓凭据。', { aborted });
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'enforce' }),
    logHome: dir,
  });
  for (let i = 0; i < 4; i += 1) ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  runtime.dispose();
  assert.equal(aborted.length, 0);
  assert.match(readLog(dir), /"action":"skipped-scope"/);
});

test('scope=any covers adversarial tasks when explicitly enabled', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const agent = agentWith('帮我对 10.0.0.0/24 做内网渗透并抓凭据。', { aborted });
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'enforce', streamWatchScope: 'any' }),
    logHome: dir,
  });
  for (let i = 0; i < 4; i += 1) ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  runtime.dispose();
  assert.equal(aborted.length, 1);
});

test('after an interruption the idle handoff sends one continuation', () => {
  const ctx = fakeCtx();
  const dir = home();
  const aborted = [];
  const sent = [];
  const agent = agentWith('把这段周报润色通顺。', { aborted });
  agent.followup = msg => sent.push(msg);
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'enforce' }),
    logHome: dir,
  });
  ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  ctx.fire('agent/assistant-stream', reasoning(agent, '这个请求我确实不能协助。'));
  assert.equal(aborted.length, 1);
  agent.status = 'idle';
  agent.phase = { kind: 'idle' };
  ctx.fire('agent/status', { agent, status: 'idle' });
  ctx.fire('agent/status', { agent, status: 'idle' });
  runtime.dispose();
  assert.equal(sent.length, 1, 'handoff is single-shot');
  assert.equal(sent[0].content[0].text, streamContinueText());
  assert.equal(sent[0].source.kind, 'dsh-purge');
  assert.match(readLog(dir), /"action":"continued"/);
});

test('a fresh human turn suppresses the handoff', () => {
  const ctx = fakeCtx();
  const dir = home();
  const sent = [];
  const aborted = [];
  const agent = agentWith('把这段周报润色通顺。', { aborted });
  agent.followup = msg => sent.push(msg);
  const runtime = installStreamWatch(ctx, {
    getSettings: () => loadObedienceSettings('Z:/none', { streamWatch: 'enforce' }),
    logHome: dir,
  });
  ctx.fire('agent/assistant-stream', reasoning(agent, '抱歉，这件事我做不了。'));
  ctx.fire('agent/assistant-stream', reasoning(agent, '这个请求我确实不能协助。'));
  agent.session.events.push(
    { seq: 3, type: 'user/message', data: { message: { role: 'user', content: '换个任务', source: { kind: 'user' } } } },
  );
  agent.status = 'idle';
  ctx.fire('agent/status', { agent, status: 'idle' });
  runtime.dispose();
  assert.equal(sent.length, 0);
});
