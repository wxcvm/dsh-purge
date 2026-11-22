import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = client.indexOf('function WorkItemsPanel(')
const end = client.indexOf('function AgentsTab(', start)
assert.ok(start > 0 && end > start, 'the generated client must contain the durable work board')
assert.match(client, /h\(WorkItemsPanel, \{ key: 'agent-work:' \+ \(eng \|\| ''\), engagement: eng, refreshKey,/)

const item = (overrides = {}) => ({
  id: 1, task_key: 'doc-review', role: 'review', objective: 'Review sample', status: 'running',
  attempt: 1, revision: 3, last_outcome: null,
  assignment: { id: 1, attempt: 1, session_id: 'child-1', run_id: 'run-1', status: 'running', host_end_at: null },
  registry_activity: { state: 'not-in-active-snapshot', exact_run_verified: false },
  ...overrides,
})
const list = (engagement, items) => ({ ok: true, engagement, total: items.length, items, hasMore: false })
const full = (overrides = {}) => {
  const record = item(overrides)
  return { ...record, history: record.assignment ? [record.assignment] : [] }
}

function mount(engagement, api, opts = {}) {
  const states = [], refs = []
  let state = 0, ref = 0, effect, dispose, unmounted = false, unmountedWrites = 0
  const ctx = vm.createContext({ engagement, opts, api: request => api(structuredClone(request)),
    React: {
      useState(initial) {
        const index = state++
        if (!Object.hasOwn(states, index)) states[index] = initial
        return [states[index], value => { if (unmounted) unmountedWrites++; states[index] = value }]
      },
      useRef(initial) { return refs[ref++] ??= { current: initial } },
      useEffect(fn) { effect = fn },
    },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
  })
  vm.runInContext(client.slice(start, end), ctx)
  const render = () => { state = ref = 0; return vm.runInContext('WorkItemsPanel({engagement,...opts})', ctx) }
  render()
  dispose = effect?.()
  return { render, reloadScope() { dispose?.(); render(); dispose = effect?.() },
    unmount() { dispose?.(); unmounted = true }, writes: () => unmountedWrites }
}
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
  return node && typeof node === 'object' ? [node, ...elements(node.children)] : []
}
const control = (ui, type, label) => elements(ui.render()).find(node => node.type === type
  && (node.props['aria-label'] === label || node.children.includes(label)))
const content = ui => JSON.stringify(ui.render())
const deferred = () => {
  let resolve, reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

test('durable board reads the selected engagement and retains unverified registry semantics', async () => {
  const requests = []
  const ui = mount('one', async req => {
    requests.push(req)
    return list('one', [item()])
  })
  await setImmediate()
  assert.match(content(ui), /当前完整快照未列出该会话；不能据此认定结束/)
  assert.match(content(ui), /不会自动启动子智能体或重试/)
  assert.deepEqual(requests, [{ op: 'workItemReview', engagement: 'one', limit: 30, offset: 0 }])
  await control(ui, 'button', '刷新持久任务').props.onClick()
  await setImmediate()
  assert.equal(requests.length, 2)
  ui.unmount()
})

test('manual settlement requires affirmative external host check and exact session/run', async () => {
  const requests = []
  const ui = mount('one', async req => {
    requests.push(req)
    if (req.op === 'workItemReview') return list('one', [item()])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: full() }
    return { ok: true, engagement: 'one', recorded: true, item: item() }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  assert.match(content(ui), /尚无精确运行结束事件/)
  control(ui, 'textarea', '结算依据').props.onChange({ target: { value: 'Checked host: the original run stopped' } })
  assert.equal(control(ui, 'button', '记录结算').props.disabled, true)
  const checkbox = elements(ui.render()).find(node => node.type === 'input' && node.props.type === 'checkbox')
  assert.ok(checkbox)
  checkbox.props.onChange({ target: { checked: true } })
  assert.equal(control(ui, 'button', '记录结算').props.disabled, false)
  await control(ui, 'button', '记录结算').props.onClick()
  const report = requests.find(req => req.op === 'workItemReport')
  assert.deepEqual(report, {
    op: 'workItemReport', engagement: 'one', task_id: 1, session_id: 'child-1', run_id: 'run-1',
    status: 'ready', summary: 'Checked host: the original run stopped', host_checked: true,
  })
  assert.match(content(ui), /结算已记录/)
  ui.unmount()
})

test('observed exact-run host end allows settlement without external checkbox', async () => {
  const calls = []
  const ended = item({ assignment: { ...item().assignment, host_end_at: '2026-11-21T01:00:00Z', host_stop_reason: 'completed' } })
  const ui = mount('one', async req => {
    calls.push(req)
    return req.op === 'workItemReview'
      ? list('one', [ended]) : { ok: true, engagement: 'one', item: { ...ended, history: [ended.assignment] } }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  assert.match(content(ui), /宿主结束事件：completed/)
  assert.equal(elements(ui.render()).some(node => node.type === 'input' && node.props.type === 'checkbox'), false)
  control(ui, 'textarea', '结算依据').props.onChange({ target: { value: 'Confirmed review summary' } })
  assert.equal(control(ui, 'button', '记录结算').props.disabled, false)
  await control(ui, 'button', '记录结算').props.onClick()
  assert.equal(calls.find(req => req.op === 'workItemReport').host_checked, false)
  ui.unmount()
})

test('retry controls bind only an existing host session; approving ready requires a reason', async () => {
  const requests = []
  const waiting = item({ status: 'waiting', last_outcome: 'Need additional documentation' })
  const ui = mount('one', async req => {
    requests.push(req)
    if (req.op === 'workItemReview') return list('one', [waiting])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: { ...waiting, history: [waiting.assignment] } }
    return { ok: true, engagement: 'one', assigned: true, item: waiting }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  assert.equal(control(ui, 'button', '记录已有执行').props.disabled, true)
  assert.equal(control(ui, 'button', '确认完成'), undefined)
  control(ui, 'input', '宿主会话 ID').props.onChange({ target: { value: 'actual-child-2' } })
  control(ui, 'input', '宿主运行 ID').props.onChange({ target: { value: 'actual-run-2' } })
  await control(ui, 'button', '记录已有执行').props.onClick()
  assert.deepEqual(requests.find(req => req.op === 'workItemAssign'), {
    op: 'workItemAssign', task_id: 1, session_id: 'actual-child-2', run_id: 'actual-run-2', engagement: 'one',
  })
  ui.unmount()

  const ready = item({ status: 'ready', last_outcome: 'Reviewed' })
  const receipts = []
  const accepted = mount('one', async req => {
    receipts.push(req)
    if (req.op === 'workItemReview') return list('one', [ready])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: { ...ready, history: [ready.assignment] } }
    return { ok: true, engagement: 'one', closed: true, item: ready }
  })
  await setImmediate()
  control(accepted, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  assert.equal(control(accepted, 'button', '确认完成').props.disabled, true)
  control(accepted, 'input', '收尾依据').props.onChange({ target: { value: 'Evidence reviewed manually' } })
  await control(accepted, 'button', '确认完成').props.onClick()
  assert.deepEqual(receipts.find(req => req.op === 'workItemClose'), {
    op: 'workItemClose', task_id: 1, expected_revision: 3, outcome: 'done', reason: 'Evidence reviewed manually', engagement: 'one',
  })
  accepted.unmount()
})

test('privacy masking and missing engagement prevent source exposure and writes', async () => {
  const requests = []
  const secret = item({ objective: 'private objective', task_key: 'private-key', assignment: {
    ...item().assignment, session_id: 'secret-source-id', run_id: 'secret-run-id',
  } })
  const ui = mount('one', async req => { requests.push(req); return list('one', [secret]) },
    { maskReportOrigin: true })
  await setImmediate()
  assert.doesNotMatch(content(ui), /private objective|private-key|secret-source-id|secret-run-id/)
  assert.equal(control(ui, 'button', '查看持久任务 #1'), undefined)
  assert.equal(control(ui, 'button', '记录结算'), undefined)
  assert.equal(requests.length, 1)
  ui.unmount()
  const none = mount('', async () => { assert.fail('should not read without a project') })
  assert.match(content(none), /选择靶标后查看/)
  none.unmount()
})

test('unmounted project discards stale review results', async () => {
  let resolve
  const ui = mount('first', () => new Promise(done => { resolve = done }))
  ui.unmount()
  resolve(list('first', [item({ task_key: 'must-stay-hidden' })]))
  await setImmediate()
  assert.equal(ui.writes(), 0)
  assert.doesNotMatch(content(ui), /must-stay-hidden/)
})

test('search narrows only the loaded page and ignores hidden fields in privacy mode', async () => {
  const requests = [], opts = {}
  const ui = mount('one', async req => {
    requests.push(req)
    return { ...list('one', [item(), item({ id: 12, task_key: 'copy-edit', role: 'editor' })]), hasMore: true, total: 32 }
  }, opts)
  await setImmediate()
  const search = value => control(ui, 'input', '搜索本页任务').props.onChange({ target: { value } })
  search('  EDITOR ')
  assert.equal(control(ui, 'button', '查看持久任务 #1'), undefined)
  assert.ok(control(ui, 'button', '查看持久任务 #12'))
  assert.match(content(ui), /第 1–2 条 \/ 共 32 条 · 本页匹配 1 条/)
  search('#1')
  assert.ok(control(ui, 'button', '查看持久任务 #1'))
  assert.equal(control(ui, 'button', '查看持久任务 #12'), undefined)
  search('not-on-this-page')
  assert.match(content(ui), /其他页没有加入搜索/)
  assert.ok(control(ui, 'button', '下一页'))
  control(ui, 'button', '清除搜索').props.onClick()
  assert.ok(control(ui, 'button', '查看持久任务 #12'))
  search('not-on-this-page')
  opts.maskReportOrigin = true
  assert.equal(control(ui, 'input', '搜索本页任务'), undefined)
  assert.equal(elements(ui.render()).filter(node => node.type === 'article').length, 2)
  assert.doesNotMatch(content(ui), /本页匹配|没有匹配项|not-on-this-page|copy-edit/)
  assert.equal(requests.length, 1)
  ui.unmount()
})

test('list labels distinguish loading and failed refresh from an empty result', async () => {
  const first = deferred(), second = deferred()
  let calls = 0
  const panel = mount('one', async () => {
    switch (++calls) {
      case 1: return first.promise
      case 2: return second.promise
      default: throw Error('private connection message')
    }
  })
  assert.match(content(panel), /正在读取任务台账/)
  const refresh = control(panel, 'button', '刷新持久任务').props.onClick()
  second.resolve(list('one', [item({ task_key: 'latest-result' })]))
  await refresh
  first.resolve(list('one', []))
  await setImmediate()
  assert.match(content(panel), /latest-result/)
  assert.doesNotMatch(content(panel), /还没有登记持久任务/)
  await control(panel, 'button', '刷新持久任务').props.onClick()
  assert.match(content(panel), /任务台账读取失败；下方为上次成功读取的结果/)
  assert.match(content(panel), /latest-result/)
  assert.doesNotMatch(content(panel), /private connection message/)
  panel.unmount()
})

test('a late detail response cannot replace a different selection or reopen a cancelled view', async () => {
  const old = deferred(), cancelled = deferred()
  let detailReads = 0
  const one = item({ id: 1, task_key: 'first-task' }), two = item({ id: 2, task_key: 'second-task' })
  const ui = mount('one', async req => {
    if (req.op === 'workItemReview') return list('one', [one, two])
    if (++detailReads === 1) return old.promise
    if (detailReads === 3) return cancelled.promise
    return { ok: true, engagement: 'one', item: { ...two, history: [] } }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  assert.match(content(ui), /正在读取任务 #1 的详情/)
  control(ui, 'button', '查看持久任务 #2').props.onClick()
  await setImmediate()
  old.resolve({ ok: true, engagement: 'one', item: { ...one, history: [] } })
  await setImmediate()
  assert.match(content(ui), /任务 #2 · 已登记执行/)
  assert.doesNotMatch(content(ui), /任务 #1 · 已登记执行/)
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  control(ui, 'button', '取消查看').props.onClick()
  cancelled.resolve({ ok: true, engagement: 'one', item: { ...one, history: [] } })
  await setImmediate()
  assert.equal(control(ui, 'button', '关闭详情'), undefined)
  assert.doesNotMatch(content(ui), /正在读取任务 #1 的详情/)
  ui.unmount()
})

test('manual action finishing after switching the list filter does not leave controls busy', async () => {
  const pending = deferred()
  const ready = full({ status: 'ready' })
  const ui = mount('one', async req => {
    if (req.op === 'workItemReview') return list('one', [ready])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: ready }
    return pending.promise
  })
  await setImmediate()
  const open = async () => {
    control(ui, 'button', '查看持久任务 #1').props.onClick()
    await setImmediate()
    control(ui, 'input', '收尾依据').props.onChange({ target: { value: 'Reviewed the draft' } })
  }
  await open()
  const saving = control(ui, 'button', '确认完成').props.onClick()
  assert.equal(control(ui, 'button', '确认完成').props.disabled, true)
  control(ui, 'select', '筛选任务状态').props.onChange({ target: { value: 'ready' } })
  ui.reloadScope()
  pending.resolve({ ok: true, closed: true })
  await saving
  await open()
  assert.equal(control(ui, 'button', '确认完成').props.disabled, false)
  ui.unmount()
})

test('returning reviewed work shows durable feedback and does not issue a launch or acknowledgement', async () => {
  let state = full({ status: 'ready', revision: 3 })
  const requests = []
  const ui = mount('docs', async req => {
    requests.push(req)
    if (req.op === 'workItemReview') return list('docs', [state])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'docs', item: state }
    assert.deepEqual(req, { op: 'workItemRequestChanges', engagement: 'docs', task_id: 1,
      expected_revision: 3, reason: 'Please add the appendix' })
    const assignment = { ...state.assignment, status: 'ready', review_feedback: req.reason,
      review_returned_at: '2026-11-22T08:00:00Z' }
    state = { ...state, assignment, history: [assignment], status: 'waiting', revision: 4 }
    return { ok: true, engagement: 'docs', returned: true, item: state }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  assert.equal(control(ui, 'button', '要求补充').props.disabled, true)
  control(ui, 'input', '收尾依据').props.onChange({ target: { value: 'Please add the appendix' } })
  await control(ui, 'button', '要求补充').props.onClick()
  assert.match(content(ui), /待补充/)
  assert.match(content(ui), /人工要求补充：Please add the appendix/)
  assert.equal(control(ui, 'button', '确认完成'), undefined)
  assert.ok(control(ui, 'button', '记录已有执行'))
  assert.deepEqual(requests.map(req => req.op), [
    'workItemReview', 'workItemGet', 'workItemRequestChanges', 'workItemReview', 'workItemGet',
  ])
})

test('task detail only uses its own run evidence and can reload without inheriting stale list data', async () => {
  const older = full({ registry_activity: { state: 'unknown' } })
  const newer = full({ revision: 4, assignment: { ...older.assignment, id: 2, run_id: 'run-2' },
    registry_activity: { state: 'session-active-observed', parent_session: 'parent-for-latest',
      checked_at: '2026-11-22T08:00:00.000Z' } })
  const calls = []
  let refreshed = false
  const ui = mount('one', async req => {
    calls.push(req)
    if (req.op === 'workItemReview') return list('one', [newer])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: refreshed ? newer : older }
    assert.fail('opening and reloading a task is read-only')
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  assert.match(content(ui), /run-1/)
  assert.match(content(ui), /此处仍是原详情/)
  assert.doesNotMatch(content(ui), /parent-for-latest/)
  assert.equal(control(ui, 'button', '记录结算'), undefined)
  assert.equal(calls.at(-1).include_registry, true)

  refreshed = true
  await control(ui, 'button', '重新读取详情').props.onClick()
  assert.doesNotMatch(content(ui), /此处仍是原详情|run-1/)
  assert.match(content(ui), /run-2/)
  assert.match(content(ui), /归属会话：parent-for-latest/)
  assert.match(content(ui), /状态核对时间/)
  assert.match(content(ui), /先打开来源会话核对这次运行/)
  assert.equal(control(ui, 'button', '记录结算').props.disabled, true, 'session activity is not settlement')
})

test('refresh preserves the settlement draft for the same run but never carries it to a new run', async () => {
  const older = full()
  let detail = older
  const ui = mount('one', async req => req.op === 'workItemReview'
    ? list('one', [older]) : { ok: true, engagement: 'one', item: detail })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  const field = () => control(ui, 'textarea', '结算依据')
  field().props.onChange({ target: { value: 'Checked the original worksheet' } })
  await control(ui, 'button', '重新读取详情').props.onClick()
  assert.equal(field().props.value, 'Checked the original worksheet')
  detail = full({ revision: 4, assignment: { ...older.assignment, id: 2, run_id: 'run-2' } })
  await control(ui, 'button', '重新读取详情').props.onClick()
  assert.equal(field().props.value, '')
})


test('a failed detail refresh retains the exact-run draft through retry without recording anything', async () => {
  const existing = full()
  let loads = 0
  const ui = mount('one', async req => {
    if (req.op === 'workItemReview') return list('one', [existing])
    assert.equal(req.op, 'workItemGet')
    if (++loads === 2) throw new Error('temporarily offline')
    return { ok: true, engagement: 'one', item: existing }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  control(ui, 'select', '结算结果').props.onChange({ target: { value: 'waiting' } })
  control(ui, 'textarea', '结算依据').props.onChange({ target: { value: 'Need the missing appendix' } })
  elements(ui.render()).find(node => node.type === 'input' && node.props.type === 'checkbox')
    .props.onChange({ target: { checked: true } })
  await control(ui, 'button', '重新读取详情').props.onClick()
  assert.match(content(ui), /草稿暂留/)
  assert.equal(control(ui, 'button', '记录结算'), undefined)
  await control(ui, 'button', '重试读取详情').props.onClick()
  assert.equal(control(ui, 'textarea', '结算依据').props.value, 'Need the missing appendix')
  assert.equal(control(ui, 'select', '结算结果').props.value, 'waiting')
  assert.equal(control(ui, 'button', '记录结算').props.disabled, false)
  ui.unmount()
})

test('switching tasks does not carry binding IDs or the settlement outcome', async () => {
  const tasks = [
    full({ id: 1, status: 'queued', assignment: null }),
    full({ id: 2, status: 'queued', assignment: null }),
    full({ id: 3 }),
    full({ id: 4 }),
  ]
  const ui = mount('one', async req => {
    if (req.op === 'workItemReview') return list('one', tasks)
    assert.equal(req.op, 'workItemGet')
    return { ok: true, engagement: 'one', item: tasks[req.task_id - 1] }
  })
  await setImmediate()
  const open = async id => {
    control(ui, 'button', '查看持久任务 #' + id).props.onClick()
    await setImmediate()
  }
  await open(1)
  control(ui, 'input', '宿主会话 ID').props.onChange({ target: { value: 'draft-session' } })
  control(ui, 'input', '宿主运行 ID').props.onChange({ target: { value: 'draft-run' } })
  await open(2)
  assert.equal(control(ui, 'input', '宿主会话 ID').props.value, '')
  assert.equal(control(ui, 'input', '宿主运行 ID').props.value, '')
  assert.equal(control(ui, 'button', '记录已有执行').props.disabled, true)
  await open(3)
  control(ui, 'select', '结算结果').props.onChange({ target: { value: 'failed' } })
  await open(4)
  assert.equal(control(ui, 'select', '结算结果').props.value, 'ready')
  ui.unmount()
})

test('a no-op review retains the draft only while the confirmed version is unchanged', async () => {
  let current = full({ status: 'ready' })
  let writes = 0
  const ui = mount('one', async req => {
    if (req.op === 'workItemReview') return list('one', [current])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: current }
    assert.equal(req.op, 'workItemRequestChanges')
    assert.equal(req.expected_revision, 3)
    if (++writes === 2) current = { ...current, revision: 4 }
    return { ok: true, returned: false, reason: 'test-conflict' }
  })
  await setImmediate()
  control(ui, 'button', '查看持久任务 #1').props.onClick()
  await setImmediate()
  control(ui, 'input', '收尾依据').props.onChange({ target: { value: 'Please add section A' } })
  await control(ui, 'button', '要求补充').props.onClick()
  assert.match(content(ui), /操作未更新/)
  assert.equal(control(ui, 'input', '收尾依据').props.value, 'Please add section A')
  await control(ui, 'button', '要求补充').props.onClick()
  assert.equal(control(ui, 'input', '收尾依据').props.value, '')
  assert.equal(control(ui, 'button', '要求补充').props.disabled, true)
  ui.unmount()
})

test('registering an existing task key never claims a new item', async () => {
  const existing = full({ status: 'queued', assignment: null })
  const ui = mount('one', async req => {
    if (req.op === 'workItemReview') return list('one', [existing])
    if (req.op === 'workItemGet') return { ok: true, engagement: 'one', item: existing }
    assert.equal(req.op, 'workItemCreate')
    return { ok: true, created: false, item: existing }
  })
  await setImmediate()
  control(ui, 'input', '新任务键').props.onChange({ target: { value: 'doc-review' } })
  control(ui, 'textarea', '新任务目标').props.onChange({ target: { value: 'Read the draft' } })
  await control(ui, 'button', '登记任务').props.onClick()
  assert.match(content(ui), /此任务键已有记录，未新增或覆盖/)
  assert.doesNotMatch(content(ui), /登记已记录/)
  ui.unmount()
})
