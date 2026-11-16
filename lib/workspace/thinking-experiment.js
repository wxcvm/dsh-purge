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
function ThinkingTaskBenchmarkPanel() {
  const [id,setId]=useState(THINKING_TASK_CASES[0].id);
  const [answerA,setAnswerA]=useState(''), [answerB,setAnswerB]=useState('');
  const [results,setResults]=useState(null);
  const [confirmed,setConfirmed]=useState(false);
  const reset=()=>{setAnswerA('');setAnswerB('');setResults(null);setConfirmed(false);};
  const status=r=>({missing:'未提供',correct:'正确',wrong:'错误', 'invalid-json':'不是有效 JSON', 'unknown-case':'未知案例'}[r?.status]??'未评分');
  const style={width:'100%',boxSizing:'border-box'};
  return h('section',{className:'dshp-runtime-card','aria-label':'正常任务连续性对照'},
    h('h3',null,'正常任务连续性对照 · 手动真实运行'),
    h('p',null,'A/B 使用同一正常任务；B 额外带有基于题目事实的任务进度备注。请在两次独立会话使用同一 Provider、模型、推理档位和多智能体配置，复制下方任务，粘贴最终回答。不会自动发请求或修改原始思考。'),
    h('label',null,'测试案例 ',h('select',{value:id,onChange:e=>{setId(e.target.value);reset();}},
      THINKING_TASK_CASES.map(c=>h('option',{key:c.id,value:c.id},c.title)))),
    h('label',null,'A 组 · 原始任务',h('textarea',{readOnly:true,value:thinkingTaskPrompt(id,'A'),rows:4,style})),
    h('label',null,'B 组 · 显式进度备注',h('textarea',{readOnly:true,value:thinkingTaskPrompt(id,'B'),rows:6,style})),
    h('label',null,'A 组最终回答',h('textarea',{value:answerA,rows:3,style,onChange:e=>{setAnswerA(e.target.value);setResults(null);}})),
    h('label',null,'B 组最终回答',h('textarea',{value:answerB,rows:3,style,onChange:e=>{setAnswerB(e.target.value);setResults(null);}})),
    h('label',null,h('input',{type:'checkbox',checked:confirmed,onChange:e=>{setConfirmed(e.target.checked);setResults(null);}}),'我确认两组是独立会话，且模型及推理配置一致'),
    h('button',{type:'button',className:'dshp-runtime-action',onClick:()=>setResults({a:scoreThinkingTask(id,answerA),b:scoreThinkingTask(id,answerB),confirmed})},'评分对照'),
    results?h('div',{role:'status'},
      h('p',null,'A：'+status(results.a)+'；B：'+status(results.b)),
      h('p',null,!results.confirmed?'环境未经确认，不能归因。':results.a.status==='missing'||results.b.status==='missing'?'缺少回答，不能比较。':'仅比较当前案例的最终 JSON 正确性；环境一致性由测试者声明。一次结果不能证明总体改善。')):null,
    h('p',{className:'dshp-runtime-meta'},'本页不保存答案，不调用模型；真实耗时、工具调用与子智能体证据请结合运行诊断。'));
}
