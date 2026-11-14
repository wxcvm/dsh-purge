function RuntimeObservationsSection() {
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState('');
  const [report, setReport] = useState(null), [reportError, setReportError] = useState('');
  const [session, setSession] = useState('');
  const root = useRef(null);
  useEffect(() => {
    let stopped = false, timer, controller;
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
  return h('section', { ref: root, className: 'dshp-runtime-observations' },
    h('h3', null, '运行诊断 · 只读'),
    h('p', null, '仅保留近期运行元数据，不保存提示、输出正文或工具参数。流结束不代表任务正确完成。'),
    h('label', null, '按会话筛选 ', h('input', { value: session, maxLength: 160, onChange: e => setSession(e.target.value), placeholder: '留空显示近期会话' })),
    error ? h('p', { role: 'alert' }, error) : null,
    h('p', null, '流式接口：' + (snapshot?.streamSupport === 'observed' ? '已观测' : '未观测（可能尚未运行或宿主不支持）') + '；已淘汰记录：' + (snapshot?.evicted || 0)),
    h('div', { style: { overflowX: 'auto' } }, h('table', null,
      h('thead', null, h('tr', null, ['会话 / attempt', '模型路由', '阶段 / 结算', '首文本 / 总耗时 ms', '终态 / 回合', 'Token / 错误'].map(s => h('th', { key: s }, s)))),
      h('tbody', null, (snapshot?.items || []).map(r => h('tr', { key: r.generation + ':' + r.attemptId },
        h('td', null, value(r.sessionId), h('br'), value(r.attemptId)),
        h('td', null, value(r.provider) + ' / ' + value(r.model)),
        h('td', null, (r.streamEnded ? '流已结束' : '流未结束') + ' / ' + r.settlement + (r.streamGap ? ' · 分片缺口' : '')),
        h('td', null, value(r.firstTextMs) + ' / ' + value(r.elapsedMs)),
        h('td', null, (r.finishObserved ? value(r.hostReason) : '终态未观测') + ' / ' + value(r.turnOutcome) + (r.interrupted ? ' · 中断前缀' : '')),
        h('td', null, value(r.usage?.totalTokens) + ' / ' + value(r.errorCode))))))),
    h('h3', null, '任务质量报告'),
    h('p', null, '导入 evaluate-task-quality 的输出 JSON；仅在本页面读取，不上传。采集来源由报告作者声明。'),
    h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '导入任务质量报告', onChange: importReport }),
    reportError ? h('p', { role: 'alert' }, reportError) : null,
    report ? h('pre', { style: { whiteSpace: 'pre-wrap' } }, JSON.stringify(report, null, 2)) : null);
}
