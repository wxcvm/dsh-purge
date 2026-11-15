// These are display categories, not proof of task completion or Provider compatibility.
function runtimeRowStatus(row) {
  const abnormal = row.terminalConflict || row.streamGap || row.finish === 'error' || row.finish === 'content_filter'
    || row.turnOutcome === 'error' || row.errorCode || (row.httpStatus >= 400);
  if (abnormal) return { key: 'attention', label: '需要关注' };
  if (row.turnOutcome === 'aborted' || row.finish === 'aborted') return { key: 'ended', label: '已取消' };
  if (row.interrupted) return { key: 'attention', label: '输出中断' };
  if (row.settlement === 'unobserved-end' || (row.streamEnded && !row.finishObserved)) return { key: 'attention', label: '结束未观测' };
  if (row.finishObserved) return { key: 'ended', label: '已观测终态' };
  if (row.turnOutcome) return { key: 'attention', label: '回合已结束 · 流终态未知' };
  return { key: 'running', label: row.settlement === 'committed' ? '已提交 · 等待终态' : '等待后续事件' };
}

function runtimeRouteKey(row) {
  return JSON.stringify([row.provider ?? null, row.model ?? null]);
}

function RuntimeObservationsSection({ onNavigate } = {}) {
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState('');
  const [report, setReport] = useState(null), [reportError, setReportError] = useState('');
  const [session, setSession] = useState('');
  const [filter, setFilter] = useState('all');
  const [route, setRoute] = useState('');
  const root = useRef(null);
  useEffect(() => {
    let stopped = false, timer, controller;
    setSnapshot(null); setError('');
    async function refresh() {
      if (stopped) return;
      if (document.visibilityState !== 'hidden' && root.current?.getClientRects().length) {
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(apiUrl('/dsh-purge/runtime-observations?limit=50&sessionId=' + encodeURIComponent(session)), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('运行观测不可用（HTTP ' + response.status + '）');
          const value = await response.json();
          if (!stopped) { setSnapshot(value); setError(''); }
        } catch (e) { if (!stopped) setError(e.name === 'AbortError' ? '运行观测请求超时' : String(e.message)); }
        finally { clearTimeout(timeout); }
      }
      if (!stopped) timer = setTimeout(refresh, 1000);
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [session]);
  async function importReport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('报告须小于 2 MiB');
      const summary = qualityReportSummary(JSON.parse(await file.text()));
      setReport(summary); setReportError('');
    } catch (e) { setReport(null); setReportError(String(e.message)); }
    event.target.value = '';
  }
  const value = v => v === null || v === undefined ? '未观测' : String(v);
  const refusalLabel = a => ({ 'not-refusal': '未检出明确拒答', refusal: a?.scope === 'partial' ? '部分拒答（不触发动作）' : '明确拒答', uncertain: '不确定（不触发动作）' }[a?.decision] || '未判定');
  const deliveryLabel = a => ({ verified: '已验证', partial: '部分完成', 'pending-input': '等待输入', blocked: '客观阻塞', 'explicit-not-delivered': '有证据未交付' }[a?.delivery] || '尚未验证');
  const items = snapshot?.items || [];
  const routes = new Map();
  for (const row of items) {
    const key = runtimeRouteKey(row);
    if (!routes.has(key)) routes.set(key, value(row.provider) + ' / ' + value(row.model));
  }
  const routeItems = route ? items.filter(row => runtimeRouteKey(row) === route) : items;
  const counts = { all: routeItems.length, running: 0, attention: 0, ended: 0 };
  for (const row of routeItems) counts[runtimeRowStatus(row).key]++;
  const shown = routeItems.filter(row => filter === 'all' || runtimeRowStatus(row).key === filter);
  const evidence = { text: 0, tools: 0, terminal: 0, cancelled: 0 };
  for (const row of routeItems) {
    if (row.firstTextMs != null) evidence.text++;
    if (row.toolCalls > 0) evidence.tools++;
    if (row.finishObserved) evidence.terminal++;
    if (row.turnOutcome === 'aborted' || row.finish === 'aborted') evidence.cancelled++;
  }
  const metric = (title, count) => h('div', { className: 'dshp-runtime-metric' },
    h('small', null, title), h('strong', null, snapshot ? count : '—'));
  const detail = (title, content) => h('div', null, h('dt', null, title), h('dd', null, content));
  const source = r => ({ 'host-stream': '实时流', 'durable-stream': '持久事件', 'not-observed': '未观测' }[r.reasonSource] || '未观测');
  return h('section', { ref: root, className: 'dshp-runtime-observations' },
    h('div', { className: 'dshp-runtime-heading' },
      h('div', null, h('h3', null, '运行诊断 · 只读'), h('p', null, '观察近期请求、终态和异常，不保存提示、正文或工具参数。流结束不等于任务完成。')),
      onNavigate ? h('button', { type: 'button', className: 'dshp-runtime-action', onClick: () => onNavigate('diagnostics') }, '打开故障诊断') : null),
    h('div', { className: 'dshp-runtime-metrics' },
      metric('近期记录', counts.all), metric('等待后续事件', counts.running), metric('需要关注', counts.attention), metric('已结束 / 取消', counts.ended)),
    h('div', { className: 'dshp-runtime-toolbar' },
      h('label', null, '按会话筛选 ', h('input', { value: session, maxLength: 160, onChange: e => { setSnapshot(null); setError(''); if (route) setRoute(''); setSession(e.target.value); }, placeholder: '留空显示近期会话' })),
      h('label', null, '按 Provider / 模型筛选 ', h('select', { value: route, onChange: e => setRoute(e.target.value), 'aria-label': 'Provider / 模型筛选' },
        h('option', { value: '' }, '全部路由'),
        route && !routes.has(route) ? h('option', { value: route }, '所选路由（当前无记录）') : null,
        Array.from(routes, ([key, label]) => h('option', { key, value: key }, label)))),
      h('div', { className: 'dshp-runtime-filters', 'aria-label': '请求状态筛选' },
        [['all', '全部'], ['running', '等待中'], ['attention', '异常'], ['ended', '已结束']].map(([key, name]) =>
          h('button', { key, type: 'button', 'aria-pressed': filter === key, onClick: () => setFilter(key) }, name + ' ' + (snapshot ? counts[key] : '—'))))),
    error ? h('p', { role: 'alert' }, error + (snapshot ? '；下方为上次成功读取的记录。' : '')) : null,
    h('p', { className: 'dshp-runtime-meta' }, '流式接口：' + (snapshot?.streamSupport === 'observed' ? '已观测' : '未观测（可能尚未运行或宿主不支持）') + '；已淘汰记录：' + value(snapshot?.evicted) + '。计数仅代表当前最多 50 条记录。'),
    h('p', { className: 'dshp-runtime-meta' }, '近期路由：' + (snapshot ? routes.size : '—') + '；仅为实际观测记录，不代表全部 Provider 或协议已兼容。'),
    snapshot ? h('p', { className: 'dshp-runtime-meta' }, '当前路由证据（请求数）：首文本 ' + evidence.text + ' · 工具调用 ' + evidence.tools + ' · 已观测终态 ' + evidence.terminal + ' · 取消 ' + evidence.cancelled + '。零表示当前记录无该类证据，不代表协议不支持。') : null,
    !snapshot ? h('div', { role: 'status', className: 'dshp-runtime-empty', 'aria-busy': !error },
      h('strong', null, error ? '暂时无法读取运行记录' : '正在读取运行状态…'),
      h('p', null, error ? '页面可见时会自动刷新，无需重复发起模型请求。' : '正在获取近期请求，请稍候。')) :
      !shown.length ? h('div', { className: 'dshp-runtime-empty' },
        h('strong', null, items.length || session ? '当前筛选没有匹配记录' : '暂无运行记录'),
        h('p', null, items.length || session ? '清除会话、路由或状态筛选以查看其他近期记录。' : '正常发起模型请求后可在此查看。'),
        items.length || session ? h('button', { type: 'button', className: 'dshp-runtime-action', onClick: () => { setFilter('all'); if (route) setRoute(''); if (session) { setSnapshot(null); setError(''); setSession(''); } } }, '清除筛选') : null) : null,
    h('div', { className: 'dshp-runtime-grid' }, shown.map(r => {
      const status = runtimeRowStatus(r);
      return h('article', { key: r.generation + ':' + r.attemptId, className: 'dshp-runtime-card', 'data-status': status.key },
        h('header', null, h('strong', null, value(r.provider) + ' / ' + value(r.model)), h('span', { className: 'dshp-runtime-status' }, status.label)),
        h('p', { className: 'dshp-runtime-meta' }, value(r.sessionId) + ' / ' + value(r.attemptId)),
        h('dl', null,
          detail('流 / 结算', (r.streamEnded ? '流已结束' : '流结束未观测') + ' / ' + value(r.settlement)),
          detail('首文本 / 总耗时', value(r.firstTextMs) + ' / ' + value(r.elapsedMs) + ' ms'),
          detail('终态 / 回合', (r.finishObserved ? value(r.hostReason) : '终态未观测') + ' / ' + value(r.turnOutcome)),
          detail('Token / HTTP', value(r.usage?.totalTokens) + ' / ' + value(r.httpStatus)),
          detail('错误代码', value(r.errorCode)),
          detail('终态来源', source(r))),
        r.streamGap || r.terminalConflict || r.interrupted ? h('p', { className: 'dshp-runtime-warning' }, [r.streamGap && '分片缺口', r.terminalConflict && '终态证据冲突', r.interrupted && '中断前缀'].filter(Boolean).join(' · ')) : null,
        h('details', null, h('summary', null, '任务质量与原始状态'),
          h('p', null, refusalLabel(r.assessment) + ' / ' + deliveryLabel(r.assessment)),
          h('p', null, (r.assessment?.reasonCodes || []).join(', ')),
          h('p', null, '回合 ' + value(r.turn) + ' · 步骤 ' + value(r.step) + ' · 分片 ' + value(r.chunks) + ' · 工具调用 ' + value(r.toolCalls))));
    })),
    h('h3', null, '任务质量报告'),
    h('p', null, '导入 evaluate-task-quality 的输出 JSON；仅在本页面读取，不上传。采集来源由报告作者声明。'),
    h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '导入任务质量报告', onChange: importReport }),
    reportError ? h('p', { role: 'alert', className: 'dshp-runtime-warning' }, '导入失败：' + reportError) : null,
    report ? h('div', null, h('button', { type: 'button', className: 'dshp-runtime-action', onClick: () => { setReport(null); setReportError(''); } }, '清除报告'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, JSON.stringify(report, null, 2))) : null);
}
