import test from 'node:test';
import assert from 'node:assert/strict';
import { installContinueRetry, shouldAutoRetry, shouldAutoContinue } from '../lib/continue-retry.js';

test('request error classification recognizes HTTP statuses and provider aliases', () => {
  for (const status of [400, 401, 402, 403, 404, 405, 410, 413, 415, 422, 451]) {
    assert.equal(shouldAutoRetry({ status }), false);
    assert.equal(shouldAutoRetry({ statusCode: String(status) }), false);
    assert.equal(shouldAutoContinue({ kind: 'error', failure: { status } }), false);
  }
  for (const code of ['context_length_exceeded', 'exceed_context_size_error', 'insufficient_quota', 'invalid_api_key', 'content_filter', 'content_policy_violation', 'policy_violation', 'CONTENT_REFUSED', 'content_refused']) {
    assert.equal(shouldAutoRetry({ code }), false);
    assert.equal(shouldAutoContinue({ kind: 'error', error: { code } }), false);
  }
  assert.equal(shouldAutoRetry({ code: "CONTENT_REFUSED", status: 503 }), false);
  assert.equal(shouldAutoContinue({ kind: "error", failure: { code: "CONTENT_REFUSED", status: 503 } }), false);
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

test('official provider policy owns the retry decision, including no retry', async () => {
  const { runtime, handler, agent } = fixture();
  const old = globalThis.__dshPurgeRetryPending;
  try {
    const policy = Object.freeze({ mode: 'normal', retryableCodes: ['SERVER'], maxRetries: 2, maxDelayMs: 1000, initialDelayMs: 100, jitterRatio: 0 });
    const payload = { agent, turn: 1, step: 1, retryPolicy: policy, provider: 'fixture', failure: { code: 'SERVER', status: 503 } };
    const original = JSON.parse(JSON.stringify(payload));
    let calls = 0;
    assert.equal(await handler(payload, async () => { calls++; return undefined; }), undefined);
    assert.equal(calls, 1);
    const decision = { kind: 'retry' };
    assert.equal(await handler(payload, async () => decision), decision);
    assert.equal(await handler({ ...payload, failure: { code: 'TIMEOUT' } }, async () => undefined), undefined);
    assert.equal(await handler({ ...payload, failure: { code: 'SERVER', providerRetryAfterMs: 3000 } }, async () => undefined), undefined);
    assert.equal(await handler({ ...payload, retryPolicy: { mode: 'always' } }, async () => undefined), undefined);
    assert.deepEqual(payload, original);
    assert.equal(globalThis.__dshPurgeRetryPending, old);
    // Legacy policy-less transient fallback is unchanged and hasn't spent its budget.
    assert.deepEqual(await handler({ ...payload, retryPolicy: undefined }, async () => undefined), { kind: 'retry' });
  } finally {
    if (old === undefined) delete globalThis.__dshPurgeRetryPending; else globalThis.__dshPurgeRetryPending = old;
    runtime.dispose();
  }
});

test('legacy recovery does not ignore a provider requested wait', async () => {
  const { runtime, handler, agent } = fixture();
  const old = globalThis.__dshPurgeRetryPending;
  try {
    const payload = { agent, turn: 1, step: 1, failure: { code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 2000 } };
    assert.equal(await handler(payload, async () => undefined), undefined);
    assert.equal(globalThis.__dshPurgeRetryPending, old);
    assert.deepEqual(await handler({ ...payload, failure: { code: 'RATE_LIMIT', status: 429 } }, async () => undefined), { kind: 'retry' });
  } finally {
    if (old === undefined) delete globalThis.__dshPurgeRetryPending; else globalThis.__dshPurgeRetryPending = old;
    runtime.dispose();
  }
});

test('official machine codes distinguish repair-required failures from technical transients', () => {
  for (const code of ['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_422', 'ABORTED', 'ACCOUNT_SIGN_IN_REQUIRED', 'ACCOUNT_TOKEN_INVALID', 'CLIENT_UPGRADE_REQUIRED', 'INVALID_MODEL_MAX_TOKENS', 'INVALID_REPLAY_STATE', 'IMAGE_OFFLOAD_REQUIRED', 'MODEL_SWITCH_COMPACTION_FAILED', 'MODEL_UNSUPPORTED', 'UNKNOWN_MODEL', 'UNSUPPORTED_CONTENT', 'UNSUPPORTED_OPTION', 'UNSUPPORTED_REASONING_EFFORT']) {
    assert.equal(shouldAutoRetry({ code }), false, code);
    assert.equal(shouldAutoContinue({ kind: 'error', failure: { code } }), false, code);
  }
  for (const code of ['HTTP_408', 'HTTP_429', 'HTTP_503', 'SERVER', 'TIMEOUT', 'STREAM_CLOSED', 'TRANSPORT', 'EMPTY_RESPONSE']) {
    assert.equal(shouldAutoRetry({ code }), true, code);
  }
});

test('disposal during downstream request-error handling prevents a stale plugin retry', async () => {
  const { runtime, handler, agent } = fixture();
  const old = globalThis.__dshPurgeRetryPending;
  const payload = { agent, turn: 1, step: 1, failure: { code: 'SERVER', status: 503 } };
  assert.equal(await handler(payload, async () => { runtime.dispose(); return undefined; }), undefined);
  assert.equal(await handler(payload, async () => undefined), undefined);
  assert.equal(globalThis.__dshPurgeRetryPending, old);
});
