// Display-only experiment. Never forwards text to a model or writes host history.
export const THINKING_EXPERIMENT_KEY = 'dshp.thinking-experiment.v1';
export const THINKING_DEFAULT_TEMPLATE = '模型：{{model}}\n思考事件：{{reasoning_chunks}}\n首思考延迟：{{first_reasoning_ms}} ms\n{{reasoning}}';
export function renderThinkingExperiment(template, values = {}) {
  return String(template ?? '').replace(/\{\{(model|provider|reasoning_chunks|reasoning_chars|first_reasoning_ms|last_reasoning_ms|first_text_ms|first_tool_ms|reasoning_span_ms|reasoning)\}\}/g,
    (_, key) => values[key] == null ? '未观测' : String(values[key]));
}
export function thinkingEventValues(row) {
  return { model: row?.model ?? null, provider: row?.provider ?? null,
    reasoning_chunks: row?.reasoningChunks ?? null, reasoning_chars: row?.reasoningChars ?? null,
    first_reasoning_ms: row?.firstReasoningMs ?? null, last_reasoning_ms: row?.lastReasoningMs ?? null,
    first_text_ms: row?.firstTextMs ?? null, first_tool_ms: row?.firstToolMs ?? null,
    reasoning_span_ms: thinkingTimeline(row).span, reasoning: null };
}
// These are client-observed offsets, not model-side compute duration.
export function thinkingTimeline(row) {
  const valid = value => Number.isFinite(value) && value >= 0 ? value : null;
  const first = valid(row?.firstReasoningMs), last = valid(row?.lastReasoningMs);
  const text = valid(row?.firstTextMs), tool = valid(row?.firstToolMs), end = valid(row?.elapsedMs);
  const span = first !== null && last !== null && last >= first ? last - first : null;
  const interleaved = row?.reasoningAfterText === true;
  return { first, last, text, tool, end, span, interleaved, gap: row?.streamGap === true,
    textGap: !interleaved && last !== null && text !== null && text >= last ? text - last : null };
}
export function compareThinkingTemplates(enabled, a, b, values, original) {
  return { baseline: String(original ?? ''), a: enabled ? renderThinkingExperiment(a, values) : String(original ?? ''),
    b: enabled ? renderThinkingExperiment(b, values) : String(original ?? ''), enabled: !!enabled };
}
export function parseThinkingExperiment(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.profiles)) throw new Error('profiles');
    const profiles = data.profiles.filter(p => typeof p?.name === 'string' && p.name.trim() && typeof p.template === 'string')
      .map(p => ({ name: p.name, template: p.template }));
    if (profiles.length && Number.isInteger(data.selected) && profiles[data.selected]) return { profiles, selected: data.selected, enabled: data.enabled !== false };
  } catch {}
  return { profiles: [{ name: '默认实验', template: THINKING_DEFAULT_TEMPLATE }], selected: 0, enabled: true };
}
function ThinkingExperimentPanel({ rows = [], mask = false, snapshotAvailable = false } = {}) {
  const [config, setConfig] = useState(() => {
    try { return parseThinkingExperiment(localStorage.getItem(THINKING_EXPERIMENT_KEY)); }
    catch { return parseThinkingExperiment(null); }
  });
  const [sample, setSample] = useState('先读取项目目录，再确认配置文件。');
  const [message, setMessage] = useState('');
  const [comparison, setComparison] = useState('');
  const [selectedRow, setSelectedRow] = useState('');
  const profile = config.profiles[config.selected];
  const change = patch => { setConfig(c => ({ ...c, profiles: c.profiles.map((p, i) => i === c.selected ? { ...p, ...patch } : p) })); setMessage('未保存'); };
  const add = () => { setConfig(c => ({ ...c, profiles: [...c.profiles, { name: '实验 ' + (c.profiles.length + 1), template: THINKING_DEFAULT_TEMPLATE }], selected: c.profiles.length })); setMessage('未保存'); };
  const remove = () => { setComparison(''); setConfig(c => ({ ...c, profiles: c.profiles.filter((_, i) => i !== c.selected), selected: Math.max(0, c.selected - 1) })); setMessage('未保存'); };
  const save = () => {
    if (!config.profiles.every(p => p.name.trim())) { setMessage('请填写实验名称'); return; }
    try { localStorage.setItem(THINKING_EXPERIMENT_KEY, JSON.stringify(config)); setMessage('已保存到当前客户端'); }
    catch { setMessage('保存失败：当前客户端存储不可用'); }
  };
  const candidates = rows.filter(r => r.reasoningChunks > 0);
  const rowKey = r => JSON.stringify([r.generation, r.attemptId]);
  const row = selectedRow ? candidates.find(r => rowKey(r) === selectedRow) : candidates[0];
  const timeline = thinkingTimeline(row);
  const sampleValues = { model: '示例模型', provider: 'fixture', reasoning_chunks: 2, reasoning_chars: sample.length, first_reasoning_ms: 150, last_reasoning_ms: 250, first_text_ms: 300, first_tool_ms: null, reasoning_span_ms: 100, reasoning: sample };
  const compareProfile = comparison === '' ? null : config.profiles[Number(comparison)];
  const pair = compareThinkingTemplates(config.enabled, profile.template, compareProfile?.template ?? THINKING_DEFAULT_TEMPLATE, sampleValues, sample);
  const displayMs = v => v == null ? '未观测' : v + ' ms';
  const fieldStyle = { width: '100%', boxSizing: 'border-box' };
  const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
  return h('section', { className: 'dshp-runtime-card', 'aria-label': '思维流 Hook 实验' },
    h('h3', null, '思维流 Hook 实验'),
    h('p', null, '自定义显示模板；真实流只采集事件元数据，样本文本仅在本页预览。不会修改模型请求、正文、工具调用或原始推理状态。'),
    h('div', { className: 'dshp-runtime-toolbar' },
      h('label', null, h('input', { type:'checkbox', checked:config.enabled, onChange:e=>{ const enabled=e.target.checked; setConfig(c=>({...c,enabled})); setMessage('未保存'); } }), '启用显示转换'),
      h('label', null, '实验配置 ', h('select', { value: String(config.selected), onChange: e => { const selected = Number(e.target.value); setConfig(c => ({ ...c, selected })); setMessage('未保存'); } },
        config.profiles.map((p,i) => h('option', { key:i, value:String(i) }, p.name)))),
      h('button', { type:'button', className:'dshp-runtime-action', onClick:add }, '新增配置'),
      h('button', { type:'button', className:'dshp-runtime-action', disabled:config.profiles.length < 2, onClick:remove }, '删除当前配置'),
      h('button', { type:'button', className:'dshp-runtime-action', onClick:save }, '保存配置')),
    h('p', { role:'status' }, message),
    h('label', null, '配置名称', h('input', { style:fieldStyle, value:profile.name, onChange:e=>change({name:e.target.value}) })),
    h('label', null, '自定义 Hook 内容', h('textarea', { style:fieldStyle, rows:5, value:profile.template, onChange:e=>change({template:e.target.value}) })),
    h('p', { className:'dshp-runtime-meta' }, '点击插入变量：'),
    h('div', { className:'dshp-runtime-toolbar' }, ['model','provider','reasoning_chunks','reasoning_chars','first_reasoning_ms','last_reasoning_ms','first_text_ms','first_tool_ms','reasoning_span_ms','reasoning'].map(key =>
      h('button', { key, type:'button', className:'dshp-runtime-action', onClick:()=>change({template:profile.template+'{{'+key+'}}'}) }, '{{'+key+'}}'))),
    h('h4', null, '真实 Hook 事件预览'),
    h('label', null, '选择请求 ', h('select', { value:selectedRow, onChange:e=>setSelectedRow(e.target.value) },
      h('option',{value:''},'最新含思考事件的请求'),
      selectedRow && !candidates.some(r=>rowKey(r)===selectedRow) ? h('option',{value:selectedRow},'所选请求已不在当前范围') : null,
      candidates.map((r,i)=>h('option',{key:rowKey(r),value:rowKey(r)},'请求 '+(i+1)+(mask?'':' · '+(r.model??'未知模型')))))),
    !snapshotAvailable ? h('p', null, '运行记录尚未读取。') : !row ? h('p', null, '当前筛选范围尚未观察到所选思考事件；请发起正常模型任务或选择其他请求。') :
      h('div', null,
        h('p', null, '原始元数据（所选请求）：' + row.reasoningChunks + ' 个事件 / ' + row.reasoningChars + ' 字符；首思考 ' + row.firstReasoningMs + ' ms'),
        h('p', null, '事件时间线（相对流开始）：首思考 '+displayMs(timeline.first)+' · 最后思考 '+displayMs(timeline.last)+' · 首正文 '+displayMs(timeline.text)+' · 首工具 '+displayMs(timeline.tool)+' · 流结束 '+displayMs(timeline.end)),
        h('p', null, '观测思考跨度 '+displayMs(timeline.span)+'；最后思考至首正文 '+displayMs(timeline.textGap)+(timeline.interleaved?'；思考与正文交错，间隔不适用':'')+(timeline.gap?'；流存在缺口，时间线不完整':'')+'。不是模型内部计算耗时。'),
        config.enabled ? h('pre', { style:preStyle }, renderThinkingExperiment(profile.template, thinkingEventValues(mask ? { ...row, model:null, provider:null } : row))) : h('p',null,'转换已关闭；原始事件统计仍保留。')),
    h('h4', null, '手动样本 · 原始与转换对照'),
    h('label', null, '原始样本（可粘贴已公开的思考文本）', h('textarea', { style:fieldStyle, rows:3, value:sample, onChange:e=>setSample(e.target.value) })),
    h('p', { className:'dshp-runtime-meta' }, '示例数据不是模型实测。样本不会保存；模板保存不包含样本。'),
    h('label',null,'B 组模板 ',h('select',{value:comparison,onChange:e=>setComparison(e.target.value)},
      h('option',{value:''},'默认模板'),config.profiles.map((p,i)=>h('option',{key:i,value:String(i)},p.name)))),
    h('h4',null,'A 组 · '+profile.name), h('pre',{style:preStyle},pair.a),
    h('h4',null,'B 组 · '+(compareProfile?.name??'默认模板')),h('pre',{style:preStyle},pair.b),
    h('p',{className:'dshp-runtime-meta'},'同一输入对照：'+(pair.a===pair.b?'展示结果一致':'展示结果不同')+'；仅比较显示，不代表模型输出或任务质量发生变化。'));
}

// Normal-task continuity benchmark. The checkpoint is an explicit user-visible
// summary of fixture facts, never hidden reasoning or a provider replay block.
export const THINKING_TASK_CASES = Object.freeze([
  { id:'config', title:'配置解析', task:'配置优先级为 CLI > 环境变量 > 文件。文件 port=8080, mode=dev；环境 port=9000；CLI mode=prod。输出仅 JSON，字段 port（数字）、mode（字符串）、portSource、modeSource（cli/env/file）。',
    checkpoint:'已核对：文件是默认值，环境变量覆盖 port，CLI 覆盖 mode。继续按已给优先级核对并交付。',
    expected:{port:9000,mode:'prod',portSource:'env',modeSource:'cli'} },
  { id:'dependency', title:'依赖任务排序', task:'任务 A 已完成；B 依赖 A；C 依赖 B；D 无依赖。输出仅 JSON，ready 为当前可执行任务的字母升序数组，blocked 为未满足依赖的任务字母升序数组，done 为已完成任务数组。',
    checkpoint:'已核对：A 已完成，B/C 尚未完成，D 没有依赖。继续计算当前可执行和阻塞集合。',
    expected:{ready:['B','D'],blocked:['C'],done:['A']} },
  { id:'inventory', title:'库存记录汇总', task:'记录：A 入库 8、出库 3；B 入库 6、出库 2、入库 1；C 入库 2、出库 2。输出仅 JSON，字段 A、B、C 为最终数量（数字），total 为总数量（数字）。',
    checkpoint:'已核对：记录按 A/B/C 分组，入库加、出库减；每种物品分别汇总后再计算总数。',
    expected:{A:5,B:5,C:0,total:10} }
]);
export function thinkingTaskPrompt(id, group) {
  const item = THINKING_TASK_CASES.find(c=>c.id===id);
  if (!item || !['A','B'].includes(group)) return null;
  return item.task + (group==='B' ? '\n\n任务进度备注（来自用户提供的已核对事实）：'+item.checkpoint : '');
}
export function scoreThinkingTask(id, answer) {
  const item=THINKING_TASK_CASES.find(c=>c.id===id);
  if (!item) return {status:'unknown-case',correct:false};
  if (typeof answer!=='string' || !answer.trim()) return {status:'missing',correct:false};
  let parsed;
  try { parsed=JSON.parse(answer.trim()); } catch { return {status:'invalid-json',correct:false}; }
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return {status:'wrong',correct:false};
  const keys=Object.keys(item.expected);
  const equal=(a,b)=>Array.isArray(b) ? Array.isArray(a)&&a.length===b.length&&b.every((v,i)=>a[i]===v) : a===b;
  const correct=Object.keys(parsed).length===keys.length&&keys.every(k=>Object.hasOwn(parsed,k)&&equal(parsed[k],item.expected[k]));
  return {status:correct?'correct':'wrong',correct};
}
// Bind only to explicit observed attempts; no transcript or hidden reasoning is retained.
export function thinkingEvidenceKey(row) {
  if (!row?.sessionId || !row?.attemptId || !Number.isSafeInteger(row.generation) || !Number.isFinite(row.startedAt)) return '';
  return JSON.stringify([row.sessionId,row.generation,row.attemptId,row.startedAt]);
}
export function thinkingEvidenceRow(rows,key) {
  if (!key) return null;
  const matches=rows.filter(r=>thinkingEvidenceKey(r)===key);
  return matches.length===1?matches[0]:null;
}
export function thinkingEvidencePair(a,b) {
  if (!thinkingEvidenceKey(a)||!thinkingEvidenceKey(b)) return 'missing';
  if (a.sessionId===b.sessionId) return 'same-session';
  if (!a.provider||!a.model||!b.provider||!b.model) return 'unknown-route';
  if (a.provider!==b.provider||a.model!==b.model) return 'different-route';
  if ([a,b].some(r=>r.streamGap||r.terminalConflict||r.interrupted||!r.streamEnded||!r.finishObserved||r.finish!=='stop'||r.settlement!=='committed'||r.turnOutcome!=='completed')) return 'incomplete';
  return 'comparable-attempts';
}
export function thinkingEvidenceMetrics(row) {
  const n=v=>Number.isFinite(v)&&v>=0?v:null;
  if(!row) return null;
  return { elapsedMs:n(row.elapsedMs), firstReasoningMs:n(row.firstReasoningMs), firstTextMs:n(row.firstTextMs),
    totalTokens:n(row.usage?.totalTokens), reasoningTokens:n(row.usage?.reasoningTokens), usageSource:row.usageSource??null,
    liveToolStarts:n(row.toolCalls), durableToolStarts:n(row.durableToolStarts),
    toolResults:n(row.toolEvidence?.results), toolErrors:n(row.toolEvidence?.errors),
    toolNonErrorResults:n(row.toolEvidence?.nonErrorResults), toolConflicts:n(row.toolEvidence?.conflicts),
    finish:row.finishObserved?row.finish??null:null, turnOutcome:row.turnOutcome??null };
}
// A bounded parent-turn projection. Child lifecycle is session scoped and is
// deliberately not included in parent token/time totals.
export function thinkingTurnEvidence(snapshot, anchor) {
  if (!thinkingEvidenceKey(anchor) || !Number.isSafeInteger(anchor.turn) || !snapshot || !Array.isArray(snapshot.items)) return null;
  if (!thinkingEvidenceRow(snapshot.items,thinkingEvidenceKey(anchor))) return null;
  const rows=snapshot.items.filter(r=>r.sessionId===anchor.sessionId&&r.generation===anchor.generation&&r.turn===anchor.turn);
  const keys=rows.map(thinkingEvidenceKey);
  const completeWindow=snapshot.evicted===0&&Number.isInteger(snapshot.matchedCount)&&snapshot.matchedCount===snapshot.items.length&&snapshot.returnedCount===snapshot.items.length;
  const distinct=keys.every(Boolean)&&new Set(keys).size===keys.length;
  const finite=v=>Number.isFinite(v)&&v>=0;
  const measure=fn=>{const values=rows.map(fn), known=values.filter(finite);return {sum:known.length?known.reduce((a,b)=>a+b,0):null,known:known.length,missing:values.length-known.length};};
  const starts=rows.map(r=>r.startedAt), ends=rows.map(r=>r.turnEndedAt);
  const steps=new Map();
  for(const r of rows) if(Number.isSafeInteger(r.step)) steps.set(r.step,(steps.get(r.step)||0)+1);
  const errors=rows.filter(r=>r.finish==='error'||r.errorCode||r.httpStatus>=400).length;
  const uncertain=rows.filter(r=>r.streamGap||r.terminalConflict||r.interrupted||!r.streamEnded||!r.finishObserved).length;
  const turnEnded=ends.every(finite)&&new Set(ends).size===1;
  const sub=snapshot.subagents;
  const child=sub?.scope==='direct-parent'&&sub.observed?{
    scope:'parent-session-not-turn',starts:sub.startsObserved,ends:sub.endsObserved,paired:sub.pairedRuns,
    startOnly:sub.startOnly,endOnly:sub.endOnly,outOfOrder:sub.outOfOrder,peakPairedOverlap:sub.peakPairedOverlap,evicted:sub.evicted
  }:null;
  return {scope:'observed-parent-turn',attempts:rows.length,windowComplete:completeWindow&&distinct,
    // Sum only observed values; missing counts accompany all sums.
    totalTokens:measure(r=>r.usage?.totalTokens),reasoningTokens:measure(r=>r.usage?.reasoningTokens),
    streamElapsedMs:measure(r=>r.elapsedMs),toolResults:measure(r=>r.toolEvidence?.results),
    toolErrors:measure(r=>r.toolEvidence?.errors),toolNonErrorResults:measure(r=>r.toolEvidence?.nonErrorResults),
    parentSpanMs:turnEnded&&starts.every(finite)&&ends[0]>=Math.min(...starts)?ends[0]-Math.min(...starts):null,
    completed:rows.every(r=>r.turnOutcome==='completed'),failedAttempts:errors,uncertainAttempts:uncertain,
    repeatedStepAttempts:[...steps.values()].reduce((sum,n)=>sum+Math.max(0,n-1),0),
    unknownStepAttempts:rows.filter(r=>!Number.isSafeInteger(r.step)).length,child,
    childTokenTotals:null, repeatedToolOperations:null };
}
export function thinkingComparisonReport({id,results,pairState,turnA,turnB,stale=false,confirmed=false}) {
  return {schemaVersion:1,kind:'thinking-task-continuity',caseId:id,source:'user-pasted-answer-and-observed-runtime-metadata',
    environmentConfirmed:!!confirmed,requestPairState:pairState,stale:!!stale,
    scores:results?{a:results.a.status,b:results.b.status}:null,
    parentTurns:{a:turnA??null,b:turnB??null},
    limitations:['bounded-parent-observation-not-full-task-cost','child-lifecycle-is-session-scoped','no-raw-reasoning-or-answers','repeat-step-count-not-duplicate-tool-execution']};
}
function ThinkingTaskBenchmarkPanel({rows=[],mask=false,snapshotAvailable=false,stale=false}={}) {
  const [id,setId]=useState(THINKING_TASK_CASES[0].id);
  const [answerA,setAnswerA]=useState(''), [answerB,setAnswerB]=useState('');
  const [results,setResults]=useState(null);
  const [confirmed,setConfirmed]=useState(false);
  const [keyA,setKeyA]=useState(''), [keyB,setKeyB]=useState('');
  const [capture,setCapture]=useState(null), [captureError,setCaptureError]=useState(''), [capturing,setCapturing]=useState(false);
  const [exportText,setExportText]=useState('');
  const reset=()=>{setAnswerA('');setAnswerB('');setResults(null);setConfirmed(false);setKeyA('');setKeyB('');setCapture(null);setCaptureError('');setExportText('');};
  const status=r=>({missing:'未提供',correct:'正确',wrong:'错误', 'invalid-json':'不是有效 JSON', 'unknown-case':'未知案例'}[r?.status]??'未评分');
  const style={width:'100%',boxSizing:'border-box'};
  const candidates=rows.filter(r=>thinkingEvidenceKey(r));
  const rowA=thinkingEvidenceRow(candidates,keyA),rowB=thinkingEvidenceRow(candidates,keyB);
  const pairState=thinkingEvidencePair(rowA,rowB);
  const sameCapture=capture?.keyA===keyA&&capture?.keyB===keyB;
  const turnA=sameCapture?capture.a:null,turnB=sameCapture?capture.b:null;
  async function captureTurns() {
    if(!rowA||!rowB||rowA.sessionId===rowB.sessionId)return;
    const selectedA=keyA,selectedB=keyB;
    setCapturing(true);setCaptureError('');setCapture(null);setExportText('');
    try {
      const read=async row=>{
        const response=await fetch(apiUrl('/dsh-purge/runtime-observations?limit=200&sessionId='+encodeURIComponent(row.sessionId)),{credentials:'same-origin',cache:'no-store'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const data=await response.json();
        if(data?.ok!==true)throw new Error('invalid snapshot');
        return thinkingTurnEvidence(data,row);
      };
      const [a,b]=await Promise.all([read(rowA),read(rowB)]);
      setCapture({keyA:selectedA,keyB:selectedB,a,b});
      if(!a||!b)setCaptureError('所选回合已离开观测窗口或缺少完整身份。');
    }catch{setCaptureError('回合证据读取失败，请重新采集。');}
    finally{setCapturing(false);}
  }
  const evidenceLabel={missing:'未绑定两条有效请求','same-session':'两个请求属于同一会话','unknown-route':'路由证据不完整','different-route':'实际记录的 Provider / 模型不同',incomplete:'请求未完整结束或存在证据缺口','comparable-attempts':'两条请求终态完整、路由一致、会话独立'};
  const choose=(group,key,setKey)=>h('label',null,group+' 组运行请求 ',h('select',{value:key,onChange:e=>{setKey(e.target.value);setConfirmed(false);setResults(null);setCapture(null);setCaptureError('');setExportText('');}},
    h('option',{value:''},'未绑定'),
    key&&!thinkingEvidenceRow(candidates,key)?h('option',{value:key},'所选请求已不在当前范围'):null,
    candidates.map((r,i)=>h('option',{key:thinkingEvidenceKey(r),value:thinkingEvidenceKey(r)},
      '请求 '+(i+1)+' · 回合 '+(r.turn??'—')+' / 步骤 '+(r.step??'—')+(mask?'':' · '+r.sessionId+' · '+(r.model??'未知模型'))))));
  const fmt=v=>v==null?'未观测':String(v);
  const total=m=>m?fmt(m.sum)+'（'+m.known+' 条有值 / '+m.missing+' 条缺失）':'未观测';
  const turnMetrics=(group,t)=>t?h('div',null,h('strong',null,group+' 组 · 父回合观测'),
    h('p',null,'请求 '+t.attempts+' · 失败 '+t.failedAttempts+' · 证据异常 '+t.uncertainAttempts+' · 同步骤额外请求 '+t.repeatedStepAttempts+' · 未知步骤 '+t.unknownStepAttempts),
    h('p',null,'首请求至回合结束 '+fmt(t.parentSpanMs)+' ms · 请求耗时之和 '+total(t.streamElapsedMs)+' ms'),
    h('p',null,'总 Token '+total(t.totalTokens)+' · 推理 Token '+total(t.reasoningTokens)),
    h('p',null,'工具结果 '+total(t.toolResults)+' · 非错误结果 '+total(t.toolNonErrorResults)+' · 错误 '+total(t.toolErrors)),
    h('p',null,t.windowComplete?'当前缓存未报告淘汰或截断；不证明宿主全部事件均已发出。':'缓存可能不完整，以上仅为可观测子集。'),
    h('p',null,t.child?'父会话子智能体生命周期（非本回合专属）：启动 '+t.child.starts+' · 结束 '+t.child.ends+' · 配对 '+t.child.paired+' · 峰值配对重叠 '+fmt(t.child.peakPairedOverlap):'子智能体生命周期未观测；子智能体 Token 未归集。'),
    h('p',null,'同步骤额外请求不等于重复工具操作；后者需要独立 trace。')):null;
  const metrics=(group,r)=>{const m=thinkingEvidenceMetrics(r);return m?h('div',null,h('strong',null,group+' 组 · 所选单次请求'),
    h('p',null,'总耗时 '+fmt(m.elapsedMs)+' ms · 首思考 '+fmt(m.firstReasoningMs)+' ms · 首正文 '+fmt(m.firstTextMs)+' ms'),
    h('p',null,'总 Token '+fmt(m.totalTokens)+' · 推理 Token '+fmt(m.reasoningTokens)+' · 用量来源 '+fmt(m.usageSource)),
    h('p',null,'工具开始（实时 / 持久） '+fmt(m.liveToolStarts)+' / '+fmt(m.durableToolStarts)+' · 工具结果 '+fmt(m.toolResults)+' · 非错误结果 '+fmt(m.toolNonErrorResults)+' · 错误 '+fmt(m.toolErrors)+' · 冲突 '+fmt(m.toolConflicts)),
    h('p',null,'终态 '+fmt(m.finish)+' · 回合 '+fmt(m.turnOutcome))):null;};
  return h('section',{className:'dshp-runtime-card','aria-label':'正常任务连续性对照'},
    h('h3',null,'正常任务连续性对照 · 手动真实运行'),
    h('p',null,'A/B 使用同一正常任务；B 额外带有基于题目事实的任务进度备注。请在两次独立会话使用同一 Provider、模型、推理档位和多智能体配置，复制下方任务，粘贴最终回答。不会自动发请求或修改原始思考。'),
    h('label',null,'测试案例 ',h('select',{value:id,onChange:e=>{setId(e.target.value);reset();}},
      THINKING_TASK_CASES.map(c=>h('option',{key:c.id,value:c.id},c.title)))),
    h('label',null,'A 组 · 原始任务',h('textarea',{readOnly:true,value:thinkingTaskPrompt(id,'A'),rows:4,style})),
    h('label',null,'B 组 · 显式进度备注',h('textarea',{readOnly:true,value:thinkingTaskPrompt(id,'B'),rows:6,style})),
    h('label',null,'A 组最终回答',h('textarea',{value:answerA,rows:3,style,onChange:e=>{setAnswerA(e.target.value);setResults(null);}})),
    h('label',null,'B 组最终回答',h('textarea',{value:answerB,rows:3,style,onChange:e=>{setAnswerB(e.target.value);setResults(null);}})),
    h('h4',null,'关联真实运行证据'),
    h('p',null,'从近期诊断记录选择 A/B 对应的请求；关联由测试者确认，不从回答文字猜测。清除上方会话筛选后可同时选择两个会话。'),
    !snapshotAvailable?h('p',null,'运行记录尚未读取。'):stale?h('p',{role:'alert'},'当前记录来自上次成功读取；请恢复实时观测后再比较。'):null,
    choose('A',keyA,setKeyA),choose('B',keyB,setKeyB),
    h('p',{role:'status'},evidenceLabel[pairState]+'。只代表所选请求，不代表整轮任务或多智能体累计用量。'),
    metrics('A',rowA),metrics('B',rowB),
    h('h4',null,'父回合证据聚合'),
    h('button',{type:'button',className:'dshp-runtime-action',disabled:capturing||!rowA||!rowB||rowA.sessionId===rowB.sessionId,onClick:captureTurns},capturing?'采集中…':'采集 A/B 回合证据'),
    captureError?h('p',{role:'alert'},captureError):null,
    turnMetrics('A',turnA),turnMetrics('B',turnB),
    h('p',{className:'dshp-runtime-meta'},'采集为当前缓存快照；任务结束后重新采集。仅父 Agent 同一回合；子智能体计数为父会话范围，不能相加为任务总成本。'),
    h('label',null,h('input',{type:'checkbox',checked:confirmed,onChange:e=>{setConfirmed(e.target.checked);setResults(null);}}),'我确认两组是独立会话、模型及推理配置一致，所选请求对应上述任务'),
    h('button',{type:'button',className:'dshp-runtime-action',onClick:()=>setResults({a:scoreThinkingTask(id,answerA),b:scoreThinkingTask(id,answerB),confirmed})},'评分对照'),
    results?h('div',{role:'status'},
      h('p',null,'A：'+status(results.a)+'；B：'+status(results.b)),
      h('p',null,!results.confirmed?'环境未经确认，不能归因。':results.a.status==='missing'||results.b.status==='missing'?'缺少回答，不能比较。':'仅比较当前案例的最终 JSON 正确性；环境一致性由测试者声明。一次结果不能证明总体改善。'),
      h('p',null,results.confirmed&&snapshotAvailable&&!stale&&pairState==='comparable-attempts'?'可并列查看已关联的单次请求指标；仍需多次实验验证任务整体收益。':'运行证据未满足对照条件，不作性能归因。')):null,
    h('button',{type:'button',className:'dshp-runtime-action',onClick:()=>setExportText(JSON.stringify(thinkingComparisonReport({id,results,pairState,turnA,turnB,stale,confirmed}),null,2))},'生成实验 JSON 报告'),
    exportText?h('label',null,'实验报告（可复制保存，不含原始答案或会话 ID）',h('textarea',{readOnly:true,style,rows:10,value:exportText})):null,
    h('p',{className:'dshp-runtime-meta'},'本页不保存答案，不调用模型；真实耗时、工具调用与子智能体证据请结合运行诊断。'));
}
