import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installContinueRetry } from '../lib/continue-retry.js';

// Real Cordis waterfall, inert failure payloads. No Provider or model calls.
test('official Cordis request-error middleware preserves native policy in both registration orders', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires pinned official host fixture',
}, async () => {
  const req = createRequire(join(process.env.DSH_COMPAT_HOST_ROOT, 'package.json'));
  const { Context } = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href);
  const old = globalThis.__dshPurgeRetryPending;
  try {
    for (const order of ['purge-first', 'native-first']) {
      const ctx = new Context();
      let runtime, offNative, nativeCalls = 0, terminalCalls = 0;
      let nativeDecision;
      const installNative = () => ctx.on('agent/request-error', async (payload, next) => {
        nativeCalls++;
        if (payload.retryPolicy === undefined) return next();
        return nativeDecision === undefined ? next() : nativeDecision;
      }, { global: true });
      try {
        if (order === 'native-first') offNative = installNative();
        runtime = installContinueRetry(ctx);
        if (order === 'purge-first') offNative = installNative();
        const agent = Object.freeze({ id: order, session: Object.freeze({ id: order }) });
        const policy = Object.freeze({ mode: 'normal', retryableCodes: Object.freeze(['SERVER']),
          maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 });
        const payload = Object.freeze({ agent, turn: 1, step: 1, provider: 'fixture',
          failure: Object.freeze({ code: 'SERVER', status: 503 }), retryPolicy: policy,
          signal: new AbortController().signal });
        const dispatch = value => ctx.waterfall('agent/request-error', value, async () => {
          terminalCalls++; return undefined;
        });
        const before = globalThis.__dshPurgeRetryPending;
        assert.equal(await dispatch(payload), undefined, order);
        assert.equal(nativeCalls, 1);
        assert.equal(terminalCalls, 1);
        assert.equal(globalThis.__dshPurgeRetryPending, before);
        nativeDecision = Object.freeze({ kind: 'retry' });
        assert.equal(await dispatch(payload), nativeDecision, order);
        assert.equal(nativeCalls, 2);
        assert.equal(terminalCalls, 1);
        nativeDecision = undefined;
        assert.deepEqual(await dispatch({ ...payload, retryPolicy: undefined }), { kind: 'retry' });
        assert.equal(nativeCalls, 3);
        assert.equal(terminalCalls, 2);
        // The legacy fallback retains its per-request deduplication.
        assert.equal(await dispatch({ ...payload, retryPolicy: undefined }), undefined);
        runtime.dispose();
        assert.equal(await dispatch({ ...payload, retryPolicy: undefined }), undefined);
      } finally {
        runtime?.dispose();
        offNative?.();
        await ctx.fiber.dispose();
      }
    }
  } finally {
    if (old === undefined) delete globalThis.__dshPurgeRetryPending;
    else globalThis.__dshPurgeRetryPending = old;
  }
});
