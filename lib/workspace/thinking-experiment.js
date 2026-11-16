// Display-only experiment. Never forwards text to a model or writes host history.
export const THINKING_EXPERIMENT_KEY = 'dshp.thinking-experiment.v1';
export const THINKING_DEFAULT_TEMPLATE = '模型：{{model}}\n思考事件：{{reasoning_chunks}}\n首思考延迟：{{first_reasoning_ms}} ms\n{{reasoning}}';
export function renderThinkingExperiment(template, values = {}) {
  return String(template ?? '').replace(/\{\{(model|provider|reasoning_chunks|reasoning_chars|first_reasoning_ms|reasoning)\}\}/g,
    (_, key) => values[key] == null ? '未观测' : String(values[key]));
}
export function thinkingEventValues(row) {
  return { model: row?.model ?? null, provider: row?.provider ?? null,
    reasoning_chunks: row?.reasoningChunks ?? null, reasoning_chars: row?.reasoningChars ?? null,
    first_reasoning_ms: row?.firstReasoningMs ?? null, reasoning: null };
}
export function parseThinkingExperiment(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.profiles)) throw new Error('profiles');
    const profiles = data.profiles.filter(p => typeof p?.name === 'string' && p.name.trim() && typeof p.template === 'string')
      .map(p => ({ name: p.name, template: p.template }));
    if (profiles.length && Number.isInteger(data.selected) && profiles[data.selected]) return { profiles, selected: data.selected };
  } catch {}
  return { profiles: [{ name: '默认实验', template: THINKING_DEFAULT_TEMPLATE }], selected: 0 };
}
function ThinkingExperimentPanel({ rows = [], mask = false, snapshotAvailable = false } = {}) {
  const [config, setConfig] = useState(() => {
    try { return parseThinkingExperiment(localStorage.getItem(THINKING_EXPERIMENT_KEY)); }
    catch { return parseThinkingExperiment(null); }
  });
  const [sample, setSample] = useState('先读取项目目录，再确认配置文件。');
  const [message, setMessage] = useState('');
  const profile = config.profiles[config.selected];
  const change = patch => { setConfig(c => ({ ...c, profiles: c.profiles.map((p, i) => i === c.selected ? { ...p, ...patch } : p) })); setMessage('未保存'); };
  const add = () => { setConfig(c => ({ profiles: [...c.profiles, { name: '实验 ' + (c.profiles.length + 1), template: THINKING_DEFAULT_TEMPLATE }], selected: c.profiles.length })); setMessage('未保存'); };
  const remove = () => { setConfig(c => ({ profiles: c.profiles.filter((_, i) => i !== c.selected), selected: Math.max(0, c.selected - 1) })); setMessage('未保存'); };
  const save = () => {
    if (!config.profiles.every(p => p.name.trim())) { setMessage('请填写实验名称'); return; }
    try { localStorage.setItem(THINKING_EXPERIMENT_KEY, JSON.stringify(config)); setMessage('已保存到当前客户端'); }
    catch { setMessage('保存失败：当前客户端存储不可用'); }
  };
  const row = rows.find(r => r.reasoningChunks > 0);
  const sampleValues = { model: '示例模型', provider: 'fixture', reasoning_chunks: 2, reasoning_chars: sample.length, first_reasoning_ms: 150, reasoning: sample };
  const fieldStyle = { width: '100%', boxSizing: 'border-box' };
  const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
  return h('section', { className: 'dshp-runtime-card', 'aria-label': '思维流 Hook 实验' },
    h('h3', null, '思维流 Hook 实验'),
    h('p', null, '自定义显示模板；真实流只采集事件元数据，样本文本仅在本页预览。不会修改模型请求、正文、工具调用或原始推理状态。'),
    h('div', { className: 'dshp-runtime-toolbar' },
      h('label', null, '实验配置 ', h('select', { value: String(config.selected), onChange: e => { const selected = Number(e.target.value); setConfig(c => ({ ...c, selected })); setMessage('未保存'); } },
        config.profiles.map((p,i) => h('option', { key:i, value:String(i) }, p.name)))),
      h('button', { type:'button', className:'dshp-runtime-action', onClick:add }, '新增配置'),
      h('button', { type:'button', className:'dshp-runtime-action', disabled:config.profiles.length < 2, onClick:remove }, '删除当前配置'),
      h('button', { type:'button', className:'dshp-runtime-action', onClick:save }, '保存配置')),
    h('p', { role:'status' }, message),
    h('label', null, '配置名称', h('input', { style:fieldStyle, value:profile.name, onChange:e=>change({name:e.target.value}) })),
    h('label', null, '自定义 Hook 内容', h('textarea', { style:fieldStyle, rows:5, value:profile.template, onChange:e=>change({template:e.target.value}) })),
    h('p', { className:'dshp-runtime-meta' }, '点击插入变量：'),
    h('div', { className:'dshp-runtime-toolbar' }, ['model','provider','reasoning_chunks','reasoning_chars','first_reasoning_ms','reasoning'].map(key =>
      h('button', { key, type:'button', className:'dshp-runtime-action', onClick:()=>change({template:profile.template+'{{'+key+'}}'}) }, '{{'+key+'}}'))),
    h('h4', null, '真实 Hook 事件预览'),
    !snapshotAvailable ? h('p', null, '运行记录尚未读取。') : !row ? h('p', null, '当前筛选范围尚未观察到非空 reasoning-delta；请发起正常模型任务。') :
      h('div', null,
        h('p', null, '原始元数据（最近一条含思考事件的请求）：' + row.reasoningChunks + ' 个事件 / ' + row.reasoningChars + ' 字符；首思考 ' + row.firstReasoningMs + ' ms'),
        h('pre', { style:preStyle }, renderThinkingExperiment(profile.template, thinkingEventValues(mask ? { ...row, model:null, provider:null } : row)))),
    h('h4', null, '手动样本 · 原始与转换对照'),
    h('label', null, '原始样本（可粘贴已公开的思考文本）', h('textarea', { style:fieldStyle, rows:3, value:sample, onChange:e=>setSample(e.target.value) })),
    h('p', { className:'dshp-runtime-meta' }, '示例数据不是模型实测。样本不会保存；模板保存不包含样本。'),
    h('pre', { style:preStyle }, renderThinkingExperiment(profile.template, sampleValues)));
}
