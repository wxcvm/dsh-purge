import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('runtime panel polls only while visible, projects a report locally and cleans up', async () => {
  let cleanup, timer, count = 0, visible = true;
  const state = [], requests = [];
  const ctx = { useState: value => [value, next => state.push(next)], useRef: () => ({ current: { getClientRects: () => visible ? [1] : [] } }),
    useEffect: fn => { cleanup = fn(); }, h: (type, props, ...children) => ({ type, props, children }),
    document: { visibilityState: 'visible' }, apiUrl: p => p, AbortController,
    setTimeout: (fn, ms) => { if (ms === 1000) timer = fn; return ++count; }, clearTimeout() {},
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({ items: [], streamSupport: 'not-observed' }) }; },
  };
  const projection = readFileSync(new URL('../lib/task-quality-report.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const panel = readFileSync(new URL('../lib/workspace/runtime-panel.js', import.meta.url), 'utf8');
  vm.createContext(ctx); vm.runInContext(projection + '\n' + panel + '\nRuntimeObservationsSection()', ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1); assert.equal(requests[0].init.credentials, 'same-origin');
  visible = false; await timer(); assert.equal(requests.length, 1);
  visible = true; ctx.document.visibilityState = 'hidden'; await timer(); assert.equal(requests.length, 1);
  cleanup(); assert.equal(requests[0].init.signal.aborted, true);
  await timer(); assert.equal(requests.length, 1);
  assert.doesNotMatch(panel, /innerHTML|dangerouslySetInnerHTML/);
});

test('runtime route is GET only and reuses plugin access guard rather than disk state scans', () => {
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('path: "/dsh-purge/runtime-observations"');
  const route = source.slice(start, source.indexOf('"dsh-purge: read-only runtime observations"', start));
  assert.match(route, /request.method !== "GET"/); assert.match(route, /runtimeObservations\(ctx/);
  assert.doesNotMatch(route, /gatherState|readFile|writeFile/);
  assert.match(source, /if \(!allowPluginRequest\(request, response\)\) return/);
});
