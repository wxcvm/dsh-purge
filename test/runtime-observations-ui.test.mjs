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
test('native panel source renders abstention and missing delivery evidence independently', () => {
  let index = 0;
  const ctx = { useState: v => [index++ === 0 ? { items: [{ generation: 1, attemptId: 'a', assessment: { decision: 'uncertain', delivery: 'not-verified', reasonCodes: ['denied-object-uncertain'] } }] } : v, () => {}],
    useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }) };
  vm.createContext(ctx);
  const rendered = vm.runInContext(readFileSync(new URL('../lib/workspace/runtime-panel.js', import.meta.url), 'utf8') + '\nRuntimeObservationsSection()', ctx);
  const body = JSON.stringify(rendered);
  assert.match(body, /不确定（不触发动作） \/ 尚未验证/);
  assert.doesNotMatch(body, /明确拒答 \/ 有证据未交付/);
});

test('runtime cards separate missing evidence, cancellation and observed transport errors', () => {
  const rows = [
    { generation: 1, attemptId: 'pending', settlement: 'pending', firstTextMs: null },
    { generation: 1, attemptId: 'finished', finishObserved: true, finish: 'stop', hostReason: 'stop', streamEnded: true, reasonSource: 'host-stream', firstTextMs: 0 },
    { generation: 1, attemptId: 'cancelled', finish: 'aborted', turnOutcome: 'aborted' },
    { generation: 1, attemptId: 'lost', settlement: 'unobserved-end', finishObserved: false },
    { generation: 1, attemptId: 'failed', finish: 'error', errorCode: 'ECONNRESET', httpStatus: 503, terminalConflict: true, reasonSource: 'host-stream' },
  ];
  const panel = readFileSync(new URL('../lib/workspace/runtime-panel.js', import.meta.url), 'utf8');
  const render = filter => {
    let i = 0;
    const updates = [];
    const ctx = { useState: v => { const at = i++; return [at === 0 ? { items: rows } : at === 5 ? filter : v, next => updates.push([at, next])]; },
      useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }) };
    vm.createContext(ctx);
    const tree = vm.runInContext(panel + '\nRuntimeObservationsSection()', ctx);
    const all = [];
    function walk(n) { if (Array.isArray(n)) { n.forEach(walk); return; } if (!n || typeof n !== 'object') return; all.push(n); walk(n.children); }
    walk(tree);
    return { all, cards: all.filter(n => n.type === 'article'), updates };
  };
  const all = render('all');
  assert.equal(all.cards.length, 5);
  assert.equal(all.cards.map(n => n.props['data-status']).join(','), 'running,ended,ended,attention,attention');
  const body = JSON.stringify(all.cards);
  assert.match(body, /0 \/ 未观测 ms/);
  assert.match(body, /已取消/);
  assert.match(body, /结束未观测/);
  assert.match(body, /ECONNRESET/);
  assert.match(body, /503/);
  assert.match(body, /终态证据冲突/);
  assert.equal(render('attention').cards.length, 2);
  assert.equal(render('running').cards.length, 1);
  assert.equal(render('ended').cards.length, 2);
  const button = all.all.find(n => n.type === 'button' && n.children.includes('异常 2'));
  assert.ok(button); button.props.onClick();
  assert.deepEqual(all.updates.at(-1), [5, 'attention']);
});
