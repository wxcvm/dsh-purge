import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const moduleUrl = new URL('../lib/stream-guard.js', import.meta.url).href;
for (const kind of ['chunk', 'done', 'error']) {
  test(`empty initial stream deadline yields the event loop: ${kind}`, () => {
    const source = `
      import assert from 'node:assert/strict';
      import { installStreamGuard, DEFAULT_SETTINGS } from ${JSON.stringify(moduleUrl)};
      let handler, pulls = 0, heartbeat = false;
      const guard = installStreamGuard({ on: (_event, callback) => { handler = callback; return () => {}; } },
        { getSettings: () => ({ ...DEFAULT_SETTINGS, holdMs: 10, log: false }) });
      const timer = setTimeout(() => { heartbeat = true; }, 25);
      const upstream = { [Symbol.asyncIterator]() { return {
        next: async () => {
          if (pulls++ > 0) return { done: true };
          await new Promise(resolve => setTimeout(resolve, 70));
          if (${JSON.stringify(kind)} === 'error') throw new Error('fixture upstream error');
          return ${JSON.stringify(kind)} === 'done' ? { done: true } : { done: false, value: { type: 'usage', inputTokens: 1 } };
        }, return: async () => ({ done: true }),
      }; } };
      let count = 0, error;
      try { for await (const chunk of handler({ sessionId: 'liveness-fixture', tools: [{ name: 'fixture' }] }, () => upstream)) count++; }
      catch (e) { error = e.message; }
      clearTimeout(timer);
      assert.equal(heartbeat, true);
      assert.equal(guard.stats().releasedByBudget, 1);
      assert.equal(count, ${kind === 'chunk' ? 1 : 0});
      if (${JSON.stringify(kind)} === 'error') assert.equal(error, 'fixture upstream error');
      guard.dispose();
    `;
    // External watchdog is essential: an event-loop spin also prevents node:test timers firing.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', timeout: 3000, windowsHide: true,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr);
  });
}
