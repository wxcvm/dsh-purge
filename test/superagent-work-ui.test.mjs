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
