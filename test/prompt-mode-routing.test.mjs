import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRedteamPresetId,
  isRedteamSession,
  modePromptText,
  sessionAgentPreset,
} from '../lib/identity.js';

test('redteam preset labels are recognized without treating explicit negatives as redteam', () => {
  for (const value of ['redteam', 'Red-Team', '红队', { id: 'redteam' }, { name: '红队预设' }]) {
    assert.equal(isRedteamPresetId(value), true, String(value));
  }
  for (const value of ['', 'standard', 'not-redteam', '不是红队', '非红队']) {
    assert.equal(isRedteamPresetId(value), false, String(value));
  }
});

test('mounted preset takes precedence over persisted session selection', () => {
  const session = {
    header: { agentPreset: 'standard' },
    events: [{ type: 'agent-preset/selected', data: { agentPreset: 'standard' } }],
  };
  const context = {
    agent: {
      session,
      ctx: {
        get(name) {
          if (name !== 'agentPresets') return undefined;
          return { composedPreset: () => ({ id: 'redteam' }) };
        },
      },
    },
  };
  assert.equal(sessionAgentPreset(context), 'redteam');
  assert.equal(isRedteamSession(context), true);
});

test('session event, projection and header remain supported preset fallbacks', () => {
  const selected = { events: [{ type: 'agent-preset/selected', data: { agentPreset: { id: 'redteam' } } }] };
  const projected = { projectionValues: { agentPreset: { name: 'redteam' } } };
  const header = { header: { agentPreset: 'redteam' } };
  assert.equal(sessionAgentPreset({ session: selected }), 'redteam');
  assert.equal(sessionAgentPreset({ session: projected }), 'redteam');
  assert.equal(sessionAgentPreset({ session: header }), 'redteam');
});

test('subagent inherits the parent preset when the parent session is available', () => {
  const parent = { id: 'parent', header: { agentPreset: 'redteam' } };
  const child = {
    id: 'child',
    header: { origin: 'subagent', parentSession: 'parent', agentPreset: 'standard' },
  };
  const context = {
    agent: {
      session: child,
      ctx: { agents: { get: (id) => id === 'parent' ? { session: parent } : undefined } },
    },
  };
  assert.equal(sessionAgentPreset(context), 'redteam');
  assert.equal(isRedteamSession(context), true);
});

test('missing parent registry falls back to the child session preset', () => {
  const child = {
    id: 'child',
    header: { origin: 'subagent', parentSession: 'missing', agentPreset: 'standard' },
  };
  const context = { agent: { session: child, ctx: { agents: { get: () => undefined } } } };
  assert.equal(sessionAgentPreset(context), 'standard');
  assert.equal(isRedteamSession(context), false);
});

test('only the CTF contract tail is mode-specific in a supplied prompt', () => {
  const prompt = 'Common prompt rules.\n\nCTF CORE CONTRACT\nChallenge-only rules.';
  assert.equal(modePromptText(prompt, false), prompt);
  assert.equal(modePromptText(prompt, true), 'Common prompt rules.');
});
