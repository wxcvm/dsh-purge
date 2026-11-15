import test from 'node:test';
import assert from 'node:assert/strict';
import { installContinueRetry, shouldAutoRetry, shouldAutoContinue } from '../lib/continue-retry.js';

test('request error classification recognizes HTTP statuses and provider aliases', () => {
  for (const status of [400, 401, 402, 403, 404, 405, 410, 413, 415, 422, 451]) {
    assert.equal(shouldAutoRetry({ status }), false);
    assert.equal(shouldAutoRetry({ statusCode: String(status) }), false);
    assert.equal(shouldAutoContinue({ kind: 'error', failure: { status } }), false);
  }
  for (const code of ['context_length_exceeded', 'exceed_context_size_error', 'insufficient_quota', 'invalid_api_key', 'content_filter', 'content_policy_violation', 'policy_violation']) {
    assert.equal(shouldAutoRetry({ code }), false);
    assert.equal(shouldAutoContinue({ kind: 'error', error: { code } }), false);
  }
  assert.equal(shouldAutoRetry({ status: 503, retryable: false }), false);
  assert.equal(shouldAutoContinue({ kind: 'error', error: { status: 503, retryable: false } }), false);
});

test('existing transient recovery stays available and cancellation takes precedence', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(shouldAutoRetry({ status }), true);
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'TRANSPORT']) assert.equal(shouldAutoRetry({ code }), true);
  assert.equal(shouldAutoRetry({ code: 'ECONNRESET' }, { aborted: true }), false);
  assert.equal(shouldAutoContinue({ kind: 'aborted', reason: 'user' }), false);
});

function fixture() {
  const listeners = new Map();
  const ctx = { on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); } };
  const runtime = installContinueRetry(ctx);
  const agent = { id: 'test', session: { id: 'test' } };
  const handler = listeners.get('agent/request-error');
  return { runtime, handler, agent, listeners };
}

test('request hook preserves explicit host decisions and cancellation while awaiting next', async () => {
  const { runtime, handler, agent } = fixture();
  const old = globalThis.__dshPurgeRetryPending;
  try {
    for (const decision of [{ kind: 'retry', delayMs: 500 }, { kind: 'abort' }, { kind: 'blocked' }, { kind: 'fail' }]) {
      let calls = 0;
      const result = await handler({ agent, turn: 1, step: 1, failure: { status: 503 } }, async () => { calls++; return decision; });
      assert.equal(result, decision);
      assert.equal(calls, 1);
    }
    const signal = { aborted: false };
    assert.equal(await handler({ agent, turn: 1, step: 1, signal, failure: { status: 503 } }, async () => { signal.aborted = true; }), undefined);
    assert.equal(globalThis.__dshPurgeRetryPending, old);
  } finally { runtime.dispose(); }
});

test('request hook retries only eligible failures and retains deduplication and session isolation', async () => {
  const { runtime, handler, agent, listeners } = fixture();
  const old = globalThis.__dshPurgeRetryPending;
  try {
    const payload = { agent, turn: 1, step: 1, failure: { code: 'ECONNRESET', status: 503 } };
    assert.equal(await handler({ ...payload, failure: { status: 413 } }, async () => undefined), undefined);
    assert.equal(await handler({ ...payload, failure: { code: 'content_filter' } }, async () => undefined), undefined);
    assert.deepEqual(await handler(payload, async () => undefined), { kind: 'retry' });
    assert.equal(await handler(payload, async () => undefined), undefined);
    assert.deepEqual(await handler({ ...payload, agent: { id: 'other' } }, async () => undefined), { kind: 'retry' });
  } finally {
    if (old === undefined) delete globalThis.__dshPurgeRetryPending; else globalThis.__dshPurgeRetryPending = old;
    runtime.dispose();
  }
  assert.equal(listeners.size, 0);
});
