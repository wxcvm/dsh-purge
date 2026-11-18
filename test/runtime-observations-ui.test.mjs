import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const runtimePanel = () => readFileSync(new URL('../lib/workspace/thinking-experiment.js', import.meta.url), 'utf8').replace(/^export /gm, '') + '\n' + readFileSync(new URL('../lib/workspace/runtime-panel.js', import.meta.url), 'utf8');

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
  const ctx = { useState: v => [index++ === 0 ? { items: [{ generation: 1, attemptId: 'a', assessment: { decision: 'uncertain', delivery: 'not-verified', reasonCodes: ['denied-object-uncertain'] } }] } : v, () => {}],
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
    { generation: 1, attemptId: 'lost', settlement: 'unobserved-end', finishObserved: false },
    { generation: 1, attemptId: 'failed', finish: 'error', errorCode: 'ECONNRESET', httpStatus: 503, terminalConflict: true, reasonSource: 'host-stream' },
  ];
  const panel = runtimePanel();
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


test('runtime empty states distinguish loading, failed read and active filters', () => {
  const panel=runtimePanel();
  const render=(snapshot,error,session,filter) => {
    let i=0; const updates=[], nodes=[];
    const ctx=vm.createContext({useState:v=>{const at=i++;return [[snapshot,error,null,'',session,filter][at] ?? v,n=>updates.push([at,n])]},useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})});
    const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx);
    function walk(n){if(Array.isArray(n)){n.forEach(walk);return}if(n&&typeof n==='object'){nodes.push(n);walk(n.children)}}walk(tree);
    return {body:JSON.stringify(tree),nodes,updates};
  };
  assert.match(render(null,'','','all').body,/正在读取运行状态/);
  assert.match(render(null,'HTTP 503','','all').body,/暂时无法读取运行记录/);
  assert.match(render({items:[]},'','','all').body,/暂无运行记录/);
  const filtered=render({items:[]},'','session-1','attention');
  assert.match(filtered.body,/当前筛选没有匹配记录/);
  filtered.nodes.find(n=>n.type==='button'&&n.children.includes('清除筛选')).props.onClick();
  assert.deepEqual(filtered.updates,[[5,'all'],[0,null],[1,''],[4,'']]);
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
  const ctx=vm.createContext({useState:v=>{const at=i++;return [at===0?{items:rows}:at===6?selected:v,n=>updates.push([at,n])]},useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx)
  const nodes=[]; function walk(n){if(Array.isArray(n)){n.forEach(walk);return}if(n&&typeof n==='object'){nodes.push(n);walk(n.children)}}walk(tree)
  const cards=nodes.filter(n=>n.type==='article')
  assert.equal(cards.length,1)
  assert.match(JSON.stringify(cards),/model-b/)
  const select=nodes.find(n=>n.type==='select'&&n.props['aria-label']==='Provider / 模型筛选')
  assert.ok(select); assert.equal(select.props.value,selected)
  assert.ok(nodes.some(n=>n.type==='option'&&n.children.includes('未观测 / 未观测')))
  select.props.onChange({target:{value:''}})
  assert.deepEqual(updates,[[6,'']])
  assert.match(JSON.stringify(tree),/不代表全部 Provider 或协议已兼容/)
  assert.match(JSON.stringify(tree),/当前路由证据（请求数）：首文本 0 · 工具调用 0 · 已观测终态 0 · 取消 0/)
})


test('inactive runtime pane preserves local state without scheduling requests', () => {
 const panel=runtimePanel();
 let count=0,cleanup;
 const ctx=vm.createContext({useState:v=>[v,()=>{count++}],useRef:()=>({}),useEffect:f=>{cleanup=f()},h:(type,props,...children)=>({type,props,children}),fetch:()=>{count++},setTimeout:()=>{count++}});
 vm.runInContext(panel+'\nRuntimeObservationsSection({active:false})',ctx);
 assert.equal(count,0);assert.equal(cleanup,undefined);
});


test('runtime cards distinguish configured route from assistant-observed route', () => {
  const panel = runtimePanel()
  const rows=[{generation:1,attemptId:'a',provider:'local',model:'actual',providerSource:'request-header',modelSource:'assistant-event',finishObserved:true}]
  let i=0;
  const ctx=vm.createContext({useState:v=>[i++===0?{items:rows}:v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const tree=vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx)
  assert.match(JSON.stringify(tree),/Provider：请求头配置 · 模型：助手事件/)
})


test('runtime cards show separate live and durable evidence and count a request only once', () => {
  const panel=runtimePanel()
  const rows=[{generation:1,attemptId:'a',provider:'local',model:'model',toolCalls:0,durableToolStarts:2,durableTextObserved:true,firstTextMs:null,observedChunks:1,chunks:3,streamGap:true,finishObserved:true}]
  let i=0
  const ctx=vm.createContext({useState:v=>[i++===0?{items:rows}:v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
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
    useState: v => { const at = i++; return [at === 0 ? { items: [{ generation: 1, sessionId: 'private-session', attemptId: 'private-attempt', provider: 'local', model: 'model' }] }
      : at === 2 ? { secret: 'private-report' } : at === 7 ? { maskHistory: true } : v, () => {}]; },
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
    useState: v => { const at = i++; return [at === 0 ? { items: [{ generation: 1, sessionId: 'private-session', attemptId: 'private-attempt', provider: 'local', model: 'model' }] } : at === 7 ? { maskHistory: false } : at === 9 ? true : v, () => {}] },
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
  const ctx=vm.createContext({useState:v=>[i++===0?{items:rows}:v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children})})
  const output=JSON.stringify(vm.runInContext(panel+'\nRuntimeObservationsSection()',ctx))
  assert.match(output,/实时流 · 实时 \/ 持久总量：20 \/ 未观测/)
})


test('clean workspace combines runtime observations under diagnostics and preserves privacy hooks', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const nav = source.slice(source.indexOf('const sections = [', source.indexOf('function SettingsRoot(props)')));
  assert.doesNotMatch(nav, /id: "runtime"|id: "profiles"/);
  assert.match(nav, /id: "diagnostics", title: "诊断中心"/);
  assert.match(source, /section === "diagnostics" && diagnosticsPane === "runtime" \? h\(RuntimeObservationsSection/);
  assert.match(source, /onNavigate: \(\) => setDiagnosticsPane\("health"\)/);
  assert.match(source, /hidden: section === "rules" \|\| \(section === "prompt" && promptPane === "library"\)/);
  assert.match(source, /api: api, useTemporaryPrivacy: useTemporaryPrivacy/);
});

test('runtime panel shows observed child lifecycle without treating unmatched events as live concurrency', () => {
  const panel = runtimePanel();
  const render = subagents => {
    let i = 0;
    const ctx = vm.createContext({
      useState: v => [i++ === 0 ? { items: [], subagents } : v, () => {}],
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
  const ctx=vm.createContext({ useState:v=>[i++===0?{items:[row]}:v,()=>{}],useRef:()=>({}),useEffect(){},h:(type,props,...children)=>({type,props,children}) });
  const tree=vm.runInContext(runtimePanel()+'\nRuntimeObservationsSection()',ctx);
  const experiment=tree.children.find(n=>n?.type?.name==='ThinkingExperimentPanel');
  assert.ok(experiment); assert.equal(experiment.props.rows[0],row); assert.equal(experiment.props.snapshotAvailable,true);
});
