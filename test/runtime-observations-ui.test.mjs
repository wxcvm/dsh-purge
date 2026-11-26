import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const runtimePanel = () => readFileSync(new URL('../lib/workspace/thinking-experiment.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('../lib/workspace/runtime-panel.js', import.meta.url), 'utf8');
const readState = (snapshot, { session = '', error = '', receivedAt = null } = {}) => ({
  query: { session }, snapshot, error, receivedAt,
});

test('runtime panel polls only while visible, projects a report locally and cleans up', async () => {
  let cleanup, timer, count = 0, visible = true;
  const state = [], requests = [];
  const ctx = { useState: value => [value, next => state.push(next)], useRef: () => ({ current: { getClientRects: () => visible ? [1] : [] } }),
    useEffect: fn => { cleanup = fn(); }, h: (type, props, ...children) => ({ type, props, children }),
    document: { visibilityState: 'visible' }, apiUrl: p => p, AbortController,
    setTimeout: (fn, ms) => { if (ms === 1000) timer = fn; return ++count; }, clearTimeout() {},
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({ ok: true, items: [], streamSupport: 'not-observed' }) }; },
  };
  const projection = readFileSync(new URL('../lib/task-quality-report.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const panel = runtimePanel();
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
  const ctx = { useState: v => [index++ === 0 ? readState({ items: [{ generation: 1, attemptId: 'a', assessment: { decision: 'uncertain', delivery: 'not-verified', reasonCodes: ['denied-object-uncertain'] } }] }) : v, () => {}],
    useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }) };
  vm.createContext(ctx);
  const rendered = vm.runInContext(runtimePanel() + '\nRuntimeObservationsSection()', ctx);
  const body = JSON.stringify(rendered);
  assert.match(body, /不确定（不触发动作） \/ 尚未验证/);
  assert.doesNotMatch(body, /明确拒答 \/ 有证据未交付/);
});

test('runtime cards separate missing evidence, cancellation and observed transport errors', () => {
  const rows = [
    { generation: 1, attemptId: 'pending', settlement: 'pending', firstTextMs: null },
    { generation: 1, attemptId: 'finished', finishObserved: true, finish: 'stop', hostReason: 'stop', streamEnded: true, reasonSource: 'host-stream', firstTextMs: 0 },
    { generation: 1, attemptId: 'cancelled', finish: 'aborted', turnOutcome: 'aborted' },
    { generation: 1, attemptId: 'lost', settlement: 'unobserved-end', finishObserved: false, durableArrival: 'exact-late' },
    { generation: 1, attemptId: 'failed', finish: 'error', errorCode: 'ECONNRESET', httpStatus: 503, terminalConflict: true, reasonSource: 'host-stream' },
  ];
  const panel = runtimePanel();
  const render = filter => {
    let i = 0;
    const updates = [];
    const disclosures = [{ open: true }, { open: false }];
    const ctx = { useState: v => { const at = i++; return [at === 0 ? readState({ items: rows }) : at === 3 ? filter : v, next => updates.push([at, next])]; },
      useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }) };
    vm.createContext(ctx);
    const tree = vm.runInContext(panel + '\nRuntimeObservationsSection()', ctx);
    const all = [];
    function walk(n) { if (Array.isArray(n)) { n.forEach(walk); return; } if (!n || typeof n !== 'object') return; all.push(n); walk(n.children); }
    walk(tree);
    all.find(n => n.props?.className === 'dshp-runtime-grid').props.ref.current = {
      querySelectorAll(selector) {
        assert.equal(selector, '.dshp-runtime-card > details');
        return disclosures;
      },
    };
    return { all, cards: all.filter(n => n.type === 'article'), updates, disclosures };
  };
  const all = render('all');
  assert.equal(all.cards.length, 5);
  assert.equal(all.cards.map(n => n.props['data-status']).join(','), 'attention,attention,running,ended,ended');
  assert.deepEqual(all.cards.map(n => n.props.key), ['1:lost', '1:failed', '1:pending', '1:finished', '1:cancelled']);
  assert.equal(all.all.find(n => n.type?.name === 'ThinkingExperimentPanel').props.rows[0], rows[0]);
  assert.equal(new Set(all.cards.map(n => n.props.key)).size, all.cards.length);
  for (const card of all.cards) {
    const details = card.children[0];
    assert.equal(details.type, 'details');
    assert.equal(details.props?.open, undefined);
    assert.equal(details.children[0].type, 'summary');
  }
  const body = JSON.stringify(all.cards);
  assert.match(body, /0 \/ 未观测 ms/);
  assert.match(body, /已取消/);
  assert.match(body, /结束未观测/);
  assert.match(body, /按同一会话的已提交序号关联/);
  assert.match(body, /ECONNRESET/);
  assert.match(body, /503/);
  assert.match(body, /终态证据冲突/);
  assert.equal(render('attention').cards.length, 2);
  assert.equal(render('running').cards.length, 1);
  assert.equal(render('ended').cards.length, 2);
  const button = all.all.find(n => n.type === 'button' && n.children.includes('异常 2'));
  assert.ok(button); button.props.onClick();
  assert.deepEqual(all.updates.at(-1), [3, 'attention']);
  all.all.find(n => n.type === 'button' && n.children.includes('展开当前记录')).props.onClick();
  assert.deepEqual(all.disclosures.map(node => node.open), [true, true]);
  all.all.find(n => n.type === 'button' && n.children.includes('收起当前记录')).props.onClick();
  assert.deepEqual(all.disclosures.map(node => node.open), [false, false]);
});

test('stream end without observed finish is not labelled an observed terminal', () => {
  const panel=runtimePanel()
  const ctx=vm.createContext({})
  const status=vm.runInContext(panel+'\nruntimeRowStatus',ctx)
  assert.equal(status({streamEnded:true,finishObserved:false}).key,'attention')
  assert.equal(status({streamEnded:true,finishObserved:false}).label,'结束未观测')
  assert.equal(status({turnOutcome:'completed',finishObserved:false}).key,'attention')
  assert.equal(status({turnOutcome:'aborted',interrupted:true}).label,'已取消')
  assert.equal(status({turnOutcome:'aborted',terminalConflict:true}).key,'attention')
})


test('runtime empty states distinguish loading, failed read, stale empty and active filters', () => {
  const panel=runtimePanel();
  const render=(snapshot,{error='',session='',filter='all',route='',receivedAt=null}={}) => {
    let i=0; const updates=[], nodes=[];
    const ctx=vm.createContext({useState:v=>{const at=i++;return [[readState(snapshot,{error,session,receivedAt}),null,'',filter,route][at] ?? v,n=>updates.push([at,n])]},useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})});
    const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx);
    function walk(n){if(Array.isArray(n)){n.forEach(walk);return}if(n&&typeof n==='object'){nodes.push(n);walk(n.children)}}walk(tree);
    return {body:JSON.stringify(tree),nodes,updates};
  };
  assert.match(render(null).body,/正在读取运行状态/);
  const failed=render(null,{error:'HTTP 503'});
  assert.match(failed.body,/暂时无法读取运行记录/);
  assert.doesNotMatch(failed.body,/流式接口：未观测|最近成功读取/);
  assert.match(render({items:[]}).body,/暂无运行记录/);
  const stale=render({items:[]},{error:'HTTP 503',receivedAt:Date.parse('2026-11-20T12:34:56Z')});
  assert.match(stale.body,/上次读取没有运行记录/);
  assert.match(stale.body,/计数未更新/);
  assert.equal(stale.nodes.find(n=>n.type==='time').props.dateTime,'2026-11-20T12:34:56.000Z');
  assert.doesNotMatch(stale.body,/暂无运行记录/);
  const filtered=render({items:[]},{session:'session-1',filter:'attention',route:'old-route'});
  assert.match(filtered.body,/当前筛选没有匹配记录/);
  filtered.nodes.find(n=>n.type==='button'&&n.children.includes('清除筛选')).props.onClick();
  assert.equal(filtered.updates.length,3);
  assert.deepEqual(filtered.updates[0],[3,'all']);
  assert.equal(filtered.updates[1][0],0);
  assert.equal(filtered.updates[1][1].query.session,'');
  assert.equal(filtered.updates[1][1].snapshot,null);
  assert.deepEqual(filtered.updates[2],[4,'']);
  for (const options of [{ filter:'attention' },{ route:'disappeared-route' }]) {
    const view=render({items:[]},options);
    assert.match(view.body,/当前筛选没有匹配记录/);
    assert.ok(view.nodes.find(n=>n.type==='button'&&n.children.includes('清除筛选')));
    assert.doesNotMatch(view.body,/展开当前记录/);
  }
});


test('runtime route filter uses actual observed provider/model pairs and keeps unknown values distinct', () => {
  const panel=runtimePanel()
  const rows=[
    {generation:1,attemptId:'a',provider:'local',model:'model-a',finishObserved:true},
    {generation:1,attemptId:'b',provider:'local',model:'model-b',finishObserved:false},
    {generation:1,attemptId:'c',provider:null,model:null,finishObserved:false}
  ]
  let i=0; const updates=[]
  const selected=JSON.stringify(['local','model-b'])
  const ctx=vm.createContext({useState:v=>{const at=i++;return [at===0?readState({items:rows}):at===4?selected:v,n=>updates.push([at,n])]},useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx)
  const nodes=[]; function walk(n){if(Array.isArray(n)){n.forEach(walk);return}if(n&&typeof n==='object'){nodes.push(n);walk(n.children)}}walk(tree)
  const cards=nodes.filter(n=>n.type==='article')
  assert.equal(cards.length,1)
  assert.match(JSON.stringify(cards),/model-b/)
  const select=nodes.find(n=>n.type==='select'&&n.props['aria-label']==='Provider / 模型筛选')
  assert.ok(select); assert.equal(select.props.value,selected)
  assert.ok(nodes.some(n=>n.type==='option'&&n.children.includes('未观测 / 未观测')))
  select.props.onChange({target:{value:''}})
  assert.deepEqual(updates,[[4,'']])
  assert.match(JSON.stringify(tree),/不代表全部 Provider 或协议已兼容/)
  assert.match(JSON.stringify(tree),/当前路由证据（请求数）：首文本 0 · 工具调用 0 · 已观测终态 0 · 取消 0/)
})


test('inactive runtime pane preserves local state without scheduling requests', () => {
 const panel=runtimePanel();
 let count=0,cleanup;
  const ctx=vm.createContext({useState:v=>[v,()=>{}],useRef:()=>({}),useEffect:f=>{cleanup=f()},h:(type,props,...children)=>({type,props,children}),fetch:()=>{count++},setTimeout:()=>{count++}});
 vm.runInContext(panel+'\nRuntimeObservationsSection({active:false})',ctx);
 assert.equal(count,0);assert.equal(cleanup,undefined);
});


test('runtime cards distinguish configured route from assistant-observed route', () => {
  const panel = runtimePanel()
  const rows=[{generation:1,attemptId:'a',provider:'local',model:'actual',providerSource:'request-header',modelSource:'assistant-event',finishObserved:true}]
  let i=0;
  const ctx=vm.createContext({useState:v=>[i++===0?readState({items:rows}):v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx)
  assert.match(JSON.stringify(tree),/Provider：请求头配置 · 模型：助手事件/)
})


test('runtime cards show separate live and durable evidence and count a request only once', () => {
  const panel=runtimePanel()
  const rows=[{generation:1,attemptId:'a',provider:'local',model:'model',toolCalls:0,durableToolStarts:2,durableTextObserved:true,firstTextMs:null,observedChunks:1,chunks:3,streamGap:true,finishObserved:true}]
  let i=0
  const ctx=vm.createContext({useState:v=>[i++===0?readState({items:rows}):v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx), output=JSON.stringify(tree)
  assert.match(output,/首文本 0 · 工具调用 1 · 已观测终态 1/)
  assert.match(output,/仅持久流文本证据/)
  assert.match(output,/工具开始（实时 \/ 持久）/)
  assert.match(output,/0 \/ 2/)
  assert.match(output,/实收分片 1 \/ 序号覆盖 3/)
})


test('runtime display masks identifiers and report when shared privacy is enabled', () => {
  const panel = runtimePanel();
  let i = 0;
  const ctx = vm.createContext({ __dshPurgeDrill: { api() {} },
    useState: v => { const at = i++; return [at === 0 ? readState({ items: [{ generation: 1, sessionId: 'private-session', attemptId: 'private-attempt', provider: 'local', model: 'model' }] })
      : at === 1 ? { secret: 'private-report' } : at === 5 ? { maskHistory: true } : v, () => {}]; },
    useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }) });
  const tree = vm.runInContext(panel + '\nRuntimeObservationsSection()', ctx);
  const cards = tree.children.find(node => node?.props?.className === 'dshp-runtime-grid');
  assert.match(JSON.stringify(cards.children), /会话 \/ 请求标识已隐藏/);
  const visible = [];
  const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') walk(n.children); else if (typeof n === 'string') visible.push(n); };
  walk(tree);
  assert.doesNotMatch(visible.join('\n'), /private-session|private-attempt|private-report/);
  assert.doesNotMatch(JSON.stringify(tree.children.filter(n => n !== cards)), /private-report/);
  assert.match(JSON.stringify(tree), /报告已读取，详细内容已隐藏/);
  assert.match(JSON.stringify(cards), /local \/ model/);
})


test('temporary runtime privacy overrides local reveal without changing routing', () => {
  const panel = runtimePanel()
  let i = 0
  const ctx = vm.createContext({
    __dshPurgeDrill: { api() {}, useTemporaryPrivacy: () => ({ task: 'sharing', maskHistory: true }) },
    useState: v => { const at = i++; return [at === 0 ? readState({ items: [{ generation: 1, sessionId: 'private-session', attemptId: 'private-attempt', provider: 'local', model: 'model' }] }) : at === 5 ? { maskHistory: false } : at === 7 ? true : v, () => {}] },
    useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children })
  })
  const tree = vm.runInContext(panel + '\nRuntimeObservationsSection()', ctx)
  const visible = []
  const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') walk(n.children); else if (typeof n === 'string') visible.push(n) }
  walk(tree)
  const text = visible.join('\n')
  assert.match(text, /本次工作区临时遮蔽已开启/)
  assert.doesNotMatch(text, /private-session|private-attempt/)
  assert.match(text, /local \/ model/)
})

test('runtime card shows usage source and separates live and durable totals', () => {
  const panel=runtimePanel()
  const rows=[{generation:1,attemptId:'a',usage:{totalTokens:20},usageSource:'host-stream',liveUsage:{totalTokens:20},durableUsage:{totalTokens:null},finishObserved:true}]
  let i=0
  const ctx=vm.createContext({useState:v=>[i++===0?readState({items:rows}):v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const output=JSON.stringify(vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx))
  assert.match(output,/实时流 · 实时 \/ 持久总量：20 \/ 未观测/)
})


test('clean workspace combines runtime observations under diagnostics and preserves privacy hooks', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const nav = source.slice(source.indexOf('const sections = [', source.indexOf('function SettingsRoot(props)')));
  assert.doesNotMatch(nav, /id: "runtime"|id: "profiles"/);
  assert.match(nav, /id: "diagnostics", title: "诊断中心"/);
  assert.match(source, /runtimeVisited \? h\("div", \{ className: "dshp-clean-pane", hidden: section !== "diagnostics" \|\| diagnosticsPane !== "runtime" \}/);
  assert.match(source, /active: section === "diagnostics" && diagnosticsPane === "runtime"/);
  assert.match(source, /profilesVisited \? h\("div", \{ className: "dshp-clean-pane", hidden: section !== "prompt"/);
  assert.match(source, /setRuntimeVisited\(true\)/);
  assert.match(source, /onNavigate: navigate/);
  assert.match(source, /hidden: section === "rules" \|\| \(section === "prompt" && !redteamExpanded\)/);
  assert.match(source, /api: api, useTemporaryPrivacy: useTemporaryPrivacy/);
});

test('runtime read separates missing route, disconnect, malformed response and recovery', async () => {
  const updates = [];
  let timer, i = 0, read;
  const responses = [
    async () => ({ ok: false, status: 404, json() { throw Error('must not read body'); } }),
    async () => ({ ok: true, json: async () => ({ ok: true, items: [{ attemptId: 'cached' }] }) }),
    async () => { throw Error('fixture-secret-in-network-error'); },
    async () => ({ ok: true, json: async () => ({ ok: false, items: [], error: 'fixture-secret-in-response' }) }),
    async () => ({ ok: true, json: async () => ({ ok: true, items: [null] }) }),
    async () => ({ ok: true, json: async () => ({ ok: true, items: [] }) }),
  ];
  const ctx = vm.createContext({
    useState(v) {
      if (i++ !== 0) return [v, () => {}];
      read = v;
      return [read, next => { read = next(read); updates.push(read); }];
    },
    useRef: () => ({ current: { getClientRects: () => [1] } }), useEffect: fn => fn(),
    h: (type, props, ...children) => ({ type, props, children }),
    document: { visibilityState: 'visible' }, apiUrl: p => p, AbortController,
    fetch: () => responses.shift()(),
    setTimeout: (fn, delay) => { if (delay === 1000) timer = fn; }, clearTimeout() {},
  });
  vm.runInContext(runtimePanel() + '\nRuntimeObservationsSection()', ctx);
  await new Promise(resolve => setImmediate(resolve));
  for (let step = 1; step < 6; step++) await timer();
  assert.deepEqual(updates.map(next => next.error), [
    'diag.runtime.missing', '', 'diag.runtime.offline', 'diag.runtime.invalid', 'diag.runtime.invalid', '',
  ]);
  assert.equal(updates[0].snapshot, null);
  assert.equal(updates[0].receivedAt, null);
  assert.equal(updates[1].snapshot.items[0].attemptId, 'cached');
  assert.ok(Number.isFinite(updates[1].receivedAt));
  for (const stale of updates.slice(2, 5)) {
    assert.equal(stale.snapshot, updates[1].snapshot);
    assert.equal(stale.receivedAt, updates[1].receivedAt);
  }
  assert.deepEqual(updates[5].snapshot, { ok: true, items: [] });
  assert.ok(updates[5].receivedAt >= updates[1].receivedAt);
  assert.doesNotMatch(JSON.stringify(updates), /fixture-secret/);
});

test('late observation responses cannot fill a replacement query with the same filter', async () => {
  let state, index, complete;
  const requests = [];
  const ctx = vm.createContext({
    useState(v) {
      if (index++ !== 0) return [v, () => {}];
      state ??= v;
      return [state, next => { state = typeof next === 'function' ? next(state) : next; }];
    },
    useRef: () => ({ current: { getClientRects: () => [1] } }),
    useEffect: fn => fn(),
    h: (type, props, ...children) => ({ type, props, children }),
    document: { visibilityState: 'visible' }, apiUrl: p => p, AbortController,
    fetch(url) {
      requests.push(url);
      if (requests.length === 1) return new Promise(resolve => { complete = resolve; });
      return new Promise(() => {});
    },
    setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(runtimePanel(), ctx);
  function change(value) {
    index = 0;
    const tree = vm.runInContext('RuntimeObservationsSection()', ctx);
    const toolbar = tree.children.find(n => n?.props?.className === 'dshp-runtime-toolbar');
    toolbar.children[0].children[1].props.onChange({ target: { value } });
  }
  change('different-session');
  change('');
  const replacement = state;
  assert.equal(replacement.query.session, '');
  assert.equal(requests.length, 2);
  complete({ ok: true, json: async () => ({ ok: true, items: [{ attemptId: 'old' }] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state, replacement);
  assert.equal(state.snapshot, null);
  assert.equal(state.receivedAt, null);
});

test('unknown privacy settings cannot reveal identifiers or a local imported report', () => {
  for (const privacy of [undefined, { api() {} }]) {
    let i = 0;
    const ctx = vm.createContext({ __dshPurgeDrill: privacy,
      useState: v => { const at = i++; return [at === 0 ? readState({ items: [{ generation: 1, sessionId: 'private-sample-session', attemptId: 'a' }] })
        : at === 1 ? { secret: 'private-sample-report' } : at === 7 ? true : v, () => {}]; },
      useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }) });
    const tree = vm.runInContext(runtimePanel() + '\nRuntimeObservationsSection()', ctx);
    const visible = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === 'string') visible.push(node);
      if (node && typeof node.type === 'string') walk(node.children);
    }
    walk(tree);
    const text = visible.join('\n');
    assert.doesNotMatch(text, /private-sample|重新隐藏详情|临时显示详情/);
    assert.match(text, /会话 \/ 请求标识已隐藏/);
    assert.match(text, /报告已读取，详细内容已隐藏/);
    const childPanels = tree.children.filter(node => typeof node?.type === 'function');
    assert.equal(childPanels.length, 2);
    assert.ok(childPanels.every(node => node.props.mask === true));
  }
});

test('runtime panel shows observed child lifecycle without treating unmatched events as live concurrency', () => {
  const panel = runtimePanel();
  const render = subagents => {
    let i = 0;
    const ctx = vm.createContext({
      useState: v => [i++ === 0 ? readState({ items: [], subagents }) : v, () => {}],
      useRef: () => ({}), useEffect() {}, h: (type, props, ...children) => ({ type, props, children }),
    });
    return JSON.stringify(vm.runInContext(panel + '\nRuntimeObservationsSection()', ctx));
  };
  const result = render({ observed: true, scope: 'direct-parent', startsObserved: 14, endsObserved: 13,
    pairedRuns: 13, startOnly: 1, endOnly: 0, outOfOrder: 0, peakPairedOverlap: 1, evicted: 0 });
  assert.match(result, /当前父会话.*启动 14.*结束 13.*配对区间峰值重叠 1/);
  assert.match(result, /不代表实时并发或任务完成/);
  assert.match(render({ observed: false }), /子智能体生命周期：未观测/);
});

test('thinking experiment is mounted with filtered real observations and no original reasoning payload', () => {
  let i = 0; const row = { generation:1, attemptId:'a', model:'fixture', reasoningChunks:2, reasoningChars:10, firstReasoningMs:5 };
  const ctx=vm.createContext({ useState:v=>[i++===0?readState({items:[row]}):v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children}) });
  const tree=vm.runInContext(runtimePanel()+'\nRuntimeObservationsSection()',ctx);
  const experiment=tree.children.find(n=>n?.type?.name==='ThinkingExperimentPanel');
  assert.ok(experiment); assert.equal(experiment.props.rows[0],row); assert.equal(experiment.props.snapshotAvailable,true);
});
