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
  attempt: 1, last_outcome: null,
  assignment: { id: 1, attempt: 1, session_id: 'child-1', run_id: 'run-1', status: 'running', host_end_at: null },
  registry_activity: { state: 'not-in-active-snapshot', exact_run_verified: false },
  ...overrides,
})
const list = (engagement, items) => ({ ok: true, engagement, total: items.length, items, hasMore: false })
const full = (overrides = {}) => ({ ...item(overrides), history: [item(overrides).assignment] })

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
  return { render, unmount() { dispose?.(); unmounted = true }, writes: () => unmountedWrites }
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
    op: 'workItemClose', task_id: 1, outcome: 'done', reason: 'Evidence reviewed manually', engagement: 'one',
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
