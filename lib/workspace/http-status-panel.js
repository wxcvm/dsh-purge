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
  const [filter, setFilter] = useState('observed');
  const [limit, setLimit] = useState(10);
  const root = useRef(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false, timer, controller, failures = 0;
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
            failures++;
            if (!stopped) setReadError('诊断接口 HTTP ' + response.status + '；这不是模型 Provider 的状态码');
          } else {
            const value = await response.json();
            if (value?.ok !== true || !Array.isArray(value.items)) throw new Error('invalid-observation-schema');
            failures = 0;
            if (!stopped) { setSnapshot(value); setReadError(''); setReceivedAt(Date.now()); }
          }
        } catch (error) {
          failures++;
          if (!stopped) setReadError(error?.name === 'AbortError'
            ? '读取超时' : '读取失败或响应格式不兼容');
        } finally { clearTimeout(timeout); }
      }
      if (!stopped) timer = setTimeout(refresh, Math.min(15000, 2000 * 2 ** failures));
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [active]);
  const rows = projectHttpStatuses(snapshot, simulate).map((row, index) => ({ ...row, index }));
  const known = rows.filter(row => row.rawStatus !== null);
  const denied = known.filter(row => row.rawStatus === 403);
  const refused = rows.filter(row => row.errorCode === 'CONTENT_REFUSED');
  const visible = filter === 'observed' ? known : rows;
  // Keep the pager mounted after its last click so keyboard focus is not lost.
  const remaining = Math.max(0, visible.length - limit);
  const count = (label, value) => h('div', null, h('dt', null, label), h('dd', null, snapshot ? value : '—'));
  const updateFilter = next => { setFilter(next); setLimit(10); };
  const statusText = value => value === null ? '未观测' : String(value);
  return h('section', { ref: root, className: 'dshp-runtime-observations dshp-http-status-observer',
      'aria-label': 'HTTP 响应观察' },
    h('div', { className: 'dshp-runtime-heading' },
      h('div', null, h('h3', null, 'HTTP 响应观察'),
        h('p', null, '这里只显示宿主已记录的终态元数据。未观测不等于成功；中转后的宿主状态可能与上游不同。')),
      h('button', { type: 'button', className: 'dshp-runtime-action',
        onClick: () => onNavigate?.('runtime') }, '返回 Provider 与运行记录')),
    h('dl', { className: 'dshp-observation-counts' },
      count('近期请求', rows.length), count('宿主记录 HTTP 403', denied.length),
      count('内容拒答码', refused.length), count('HTTP 状态未观测', rows.length - known.length)),
    readError ? h('p', { role: 'alert', className: 'dshp-runtime-warning' }, readError
      + (snapshot ? '；下方为上次成功读取的数据，页面可见时自动重试。' : '；页面可见时自动重试。')) : null,
    receivedAt ? h('p', { className: 'dshp-runtime-meta' },
      '最近成功读取：' + new Date(receivedAt).toLocaleString()) : null,
    !snapshot ? h('div', { className: 'dshp-runtime-empty', role: 'status' },
      readError ? '暂未读取到 HTTP 观测数据。' : '正在读取运行元数据…') :
      !rows.length ? h('div', { className: 'dshp-runtime-empty' },
        readError ? '上次读取没有近期运行记录。' : '近期没有运行记录。') :
        h('div', null,
          h('div', { className: 'dshp-runtime-filters', role: 'group', 'aria-label': '按 HTTP 状态证据筛选' },
            [['observed', '有 HTTP 状态'], ['all', '全部请求']].map(([id, label]) =>
              h('button', { type: 'button', key: id, 'aria-pressed': filter === id,
                onClick: () => updateFilter(id) }, label + ' ' + (id === 'observed' ? known.length : rows.length)))),
          !visible.length ? h('div', { className: 'dshp-runtime-empty' },
            h('strong', null, '没有可显示的 HTTP 状态'),
            h('p', null, '这批 ' + rows.length + ' 条请求均未记录 HTTP 状态。「全部请求」仍可查看终态和来源。')) :
            h('div', null,
              h('ul', { className: 'dshp-http-rows', 'aria-label': '请求状态' }, visible.slice(0, limit).map(row =>
                h('li', { key: row.index, className: 'dshp-http-row', 'data-status': row.rawStatus >= 400 ? 'attention' : 'ended' },
                  h('div', null,
                    h('strong', null, '请求 ' + (row.index + 1) + ' · HTTP ' + statusText(row.rawStatus)
                      + (row.simulated ? ' → 200（模拟）' : '')),
                    row.errorCode ? h('span', null, ' · ' + row.errorCode) : null),
                  h('p', { className: 'dshp-runtime-meta' },
                    '终态：' + row.finish + ' · 运行结果：' + row.turnOutcome + ' · 来源：' + row.reasonSource)))),
              h('div', { className: 'dshp-runtime-filters' },
                h('span', { className: 'dshp-runtime-meta', role: 'status' }, '显示 ' + Math.min(limit, visible.length) + ' / ' + visible.length + ' 条'),
                visible.length > 10 ? h('button', { type: 'button', 'aria-disabled': !remaining,
                  onClick: () => { if (remaining) setLimit(n => n + 10); } },
                  remaining ? '再显示 ' + Math.min(10, remaining) + ' 条' : '已显示全部') : null))),
    h('details', { className: 'dshp-diagnostic-details',
      onToggle: event => { if (!event.currentTarget.open) setSimulate(false); } },
      h('summary', null, '展示对照（离线）'),
      h('p', { className: 'dshp-runtime-meta' },
        '离线示例：原始 HTTP 403 → 当前显示 HTTP ' + (simulate ? 200 : 403)
        + '；错误码仍为 FORBIDDEN，没有模型生成结果。'),
      h('label', null, h('input', { type: 'checkbox', checked: simulate,
        'aria-label': '本地模拟将 403 显示为 200', onChange: event => setSimulate(event.target.checked) }),
        ' 本地模拟：403 → 200（仅改本页展示）')),
    h('p', { className: 'dshp-runtime-meta' },
      '只读快照，最多 50 条。页面不显示请求正文、凭据或会话标识；真实 Provider 的 403 不会被改写成网络 200。'));
}
