/** Read-only Host status metadata + an offline display-only 403→200 comparison. */
export function projectHttpStatuses(snapshot, simulated = false) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items.slice(0, 50) : [];
  return items.map(item => {
    const raw = Number.isInteger(item?.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599
      ? item.httpStatus : null;
    const errorCode = typeof item?.errorCode === 'string' && /^[A-Za-z0-9_./-]{1,64}$/.test(item.errorCode)
      ? item.errorCode : null;
    const displayed = simulated && raw === 403 ? 200 : raw;
    const source = ['host-stream', 'durable-stream'].includes(item?.reasonSource)
      ? item.reasonSource : 'not-observed';
    return {
      rawStatus: raw, displayedStatus: displayed, errorCode,
      reasonSource: source,
      finish: ['error', 'stop', 'content_filter', 'aborted', 'tool-calls', 'max-tokens'].includes(item?.finish)
        ? item.finish : 'unknown',
      turnOutcome: ['error', 'completed', 'aborted'].includes(item?.turnOutcome) ? item.turnOutcome : 'unknown',
      simulated: simulated && raw === 403,
    };
  });
}

export function HttpStatusObservationPanel({ active = true, onNavigate } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [readError, setReadError] = useState('');
  const [receivedAt, setReceivedAt] = useState(null);
  const [simulate, setSimulate] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false, timer, controller;
    async function refresh() {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden'
          && root.current?.getClientRects().length) {
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(apiUrl('/dsh-purge/runtime-observations?limit=50'),
            { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
          if (!response.ok) {
            if (!stopped) setReadError('诊断接口 HTTP ' + response.status + '；这不是模型 Provider 的状态码');
          } else {
            const value = await response.json();
            if (value?.ok !== true || !Array.isArray(value.items)) throw new Error('invalid-observation-schema');
            if (!stopped) { setSnapshot(value); setReadError(''); setReceivedAt(Date.now()); }
          }
        } catch (error) {
          if (!stopped) setReadError(error?.name === 'AbortError'
            ? '读取超时' : '读取失败或响应格式不兼容');
        } finally { clearTimeout(timeout); }
      }
      if (!stopped) timer = setTimeout(refresh, 1500);
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [active]);
  const rows = projectHttpStatuses(snapshot, simulate);
  const known = rows.filter(row => row.rawStatus !== null);
  const denied = known.filter(row => row.rawStatus === 403);
  const refused = rows.filter(row => row.errorCode === 'CONTENT_REFUSED');
  const sample = { rawStatus: 403, displayedStatus: simulate ? 200 : 403,
    errorCode: 'FORBIDDEN', simulated: simulate };
  const statusText = value => value === null ? '未观测' : String(value);
  return h('section', { ref: root, className: 'dshp-runtime-observations dshp-http-status-observer',
      'aria-label': 'HTTP 响应观察' },
    h('div', { className: 'dshp-runtime-heading' },
      h('div', null, h('h3', null, 'HTTP 响应观察 · 只读实验'),
        h('p', null, '区分 Host 记录的 HTTP 状态、模型内容拒答与清洗台接口错误；不抓取正文、凭据或提示词。')),
      h('button', { type: 'button', className: 'dshp-runtime-action',
        onClick: () => onNavigate?.('runtime') }, '返回 Provider 与运行记录')),
    h('p', { className: 'dshp-runtime-meta' },
      '仅显示宿主提供的终态元数据，未观测不等于 200。请求经过中转或 Provider 适配器时，Host 状态不一定是原始上游 HTTP 状态。'),
    h('div', { className: 'dshp-runtime-metrics' },
      h('div', { className: 'dshp-runtime-metric' }, h('small', null, '近期请求'), h('strong', null, snapshot ? rows.length : '—')),
      h('div', { className: 'dshp-runtime-metric' }, h('small', null, 'Host 报告 HTTP 403'), h('strong', null, snapshot ? denied.length : '—')),
      h('div', { className: 'dshp-runtime-metric' }, h('small', null, '内容拒答码 CONTENT_REFUSED'), h('strong', null, snapshot ? refused.length : '—')),
      h('div', { className: 'dshp-runtime-metric' }, h('small', null, '无 HTTP 状态证据'), h('strong', null, snapshot ? rows.length - known.length : '—'))),
    h('div', { className: 'dshp-runtime-toolbar' },
      h('label', null, h('input', { type: 'checkbox', checked: simulate,
        'aria-label': '本地模拟将 403 显示为 200', onChange: event => setSimulate(event.target.checked) }),
        ' 本地模拟：403 → 200（仅改本页展示）')),
    h('p', { role: 'status', className: 'dshp-runtime-meta' },
      '离线示例：原始 HTTP ' + sample.rawStatus + ' → 当前显示 HTTP ' + sample.displayedStatus
      + '；响应仍包含 error.code=' + sample.errorCode + '，没有模型生成结果。'
      + (simulate ? ' 本模拟不会修改任何网络请求或上游拒绝。' : ' 勾选后仅比较展示层效果。')),
    readError ? h('p', { role: 'alert' }, readError
      + (snapshot ? '；下方数据来自上次成功读取，已停止更新。' : '')) : null,
    receivedAt ? h('p', { className: 'dshp-runtime-meta' },
      '最近成功读取：' + new Date(receivedAt).toLocaleString()) : null,
    !snapshot ? h('p', null, readError ? '暂无可用观测数据。' : '正在读取只读运行元数据…') :
      !rows.length ? h('p', null, '近期没有模型运行记录；先运行一次普通无害任务。') :
      h('div', { className: 'dshp-runtime-cards' }, rows.map((row, i) =>
        h('article', { key: String(i), className: 'dshp-runtime-card', 'data-status': row.rawStatus === 403 ? 'attention' : 'ended' },
          h('div', { className: 'dshp-runtime-summary' },
            h('strong', null, '请求 ' + (i + 1) + ' · HTTP ' + statusText(row.rawStatus)
              + (row.simulated ? ' → 200（模拟）' : '')),
            h('span', null, ' · 错误码 ' + (row.errorCode || '未观测'))),
          h('p', { className: 'dshp-runtime-meta' },
            '终态：' + row.finish + ' · 运行结果：' + row.turnOutcome
            + ' · 来源：' + row.reasonSource
            + (row.simulated ? ' · 原始 403 保留，未改变错误分类' : ''))))),
    h('p', { className: 'dshp-runtime-meta' },
      '页面只读、内存快照、最多 50 条；不保留完整 URL、请求头、Cookie、Token、正文或会话 ID。真实 Provider 的 403 不会被改写成网络 200。'));
}
