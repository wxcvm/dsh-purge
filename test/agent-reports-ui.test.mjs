import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = client.indexOf('function AgentReports(')
const end = client.indexOf('function AgentsTab(', start)
assert.ok(start > 0 && end > start, 'generated client must contain the report pane')

const report = (id, fields = {}) => ({
  id, session_id: 'document-review-' + id, parent_session: 'draft-review',
  status: 'waiting', blocked_reason: '缺少附录', needs: [{ kind: 'other', detail: '请提供附录' }],
  created_at: '2026-11-20T08:00:00Z', ...fields,
})
const queue = (engagement, items, more = {}) => ({ ok: true, engagement, total: items.length, items, ...more })

function mount(engagement, api, onReceipt) {
  const states = [], refs = []
  let state = 0, ref = 0, effect, dispose, unmountedWrites = 0, unmounted = false
  const ctx = vm.createContext({
    engagement, onReceipt,
    api: request => api(structuredClone(request)),
    React: {
      useState(initial) {
        const index = state++
        if (!Object.hasOwn(states, index)) states[index] = initial
        return [states[index], value => {
          if (unmounted) unmountedWrites++
          states[index] = value
        }]
      },
      useRef(initial) { return refs[ref++] ??= { current: initial } },
      useEffect(fn) { effect = fn },
    },
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
  })
  vm.runInContext(client.slice(start, end), ctx)
  const render = () => { state = ref = 0; return vm.runInContext('AgentReports({engagement,onReceipt})', ctx) }
  render()
  dispose = effect()
  return { render, unmount() { dispose?.(); unmounted = true }, unmountedWrites: () => unmountedWrites }
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
  return node && typeof node === 'object' ? [node, ...elements(node.children)] : []
}

const button = (ui, label) => elements(ui.render())
  .find(n => n.type === 'button' && (n.props['aria-label'] === label || n.children.includes(label)))
const content = ui => JSON.stringify(ui.render())

test('report pane scopes reads to a selected project; empty is not a completion claim', async () => {
  const requests = []
  const api = async request => { requests.push(request); return queue(request.engagement, []) }
  assert.match(content(mount('', api)), /选择项目后查看/)
  assert.deepEqual(requests, [])
  const ui = mount('documents', api)
  await setImmediate()
  assert.match(content(ui), /当前没有待阅回报/)
  assert.match(content(ui), /不会完成任务或改变运行名额/)
  await button(ui, '刷新回报').props.onClick()
  assert.deepEqual(requests, [{ op: 'attention', engagement: 'documents' }, { op: 'attention', engagement: 'documents' }])
})

test('an explicit receipt sends exactly one original project and report ID and trusts the refreshed view', async () => {
  const requests = []
  const receipts = []
  let resolveAck
  const ui = mount('documents', request => {
    requests.push(request)
    if (request.op === 'attention') return Promise.resolve(queue('documents', [report(10), report(11)]))
    return new Promise(resolve => { resolveAck = resolve })
  }, response => receipts.push(response.total))
  await setImmediate()
  assert.deepEqual(receipts, [], 'visiting the pane does not confirm a report')
  assert.match(content(ui), /等待回复.*document-review-10.*请提供附录/)
  const onClick = button(ui, '将回报 #10 标为已阅').props.onClick
  const update = onClick()
  void onClick()
  assert.equal(button(ui, '将回报 #11 标为已阅').props.disabled, true)
  assert.deepEqual(requests, [{ op: 'attention', engagement: 'documents' },
    { op: 'attentionAck', engagement: 'documents', report_id: 10 }])
  resolveAck(queue('documents', [report(11)], { ack: { report_id: 10, acknowledged: true } }))
  await update
  assert.deepEqual(receipts, [1], 'the manual receipt updates the workspace count')
  assert.ok(!button(ui, '将回报 #10 标为已阅'))
  assert.ok(button(ui, '将回报 #11 标为已阅'))
  assert.match(content(ui), /已标为已阅/)
})

test('failed acknowledgement can be retried; a stale receipt does not acknowledge the replacement', async () => {
  let attempts = 0
  const ui = mount('documents', async request => {
    if (request.op === 'attention') return queue('documents', [report(21)])
    assert.equal(request.report_id, 21)
    if (++attempts === 1) throw new Error('offline')
    return queue('documents', [report(22)], { ack: { report_id: 21, acknowledged: false } })
  })
  await setImmediate()
  await button(ui, '将回报 #21 标为已阅').props.onClick()
  assert.match(content(ui), /未能确认已阅/)
  assert.equal(button(ui, '将回报 #21 标为已阅').props.disabled, false)
  await button(ui, '将回报 #21 标为已阅').props.onClick()
  assert.match(content(ui), /已变化或已阅/)
  assert.ok(button(ui, '将回报 #22 标为已阅'))
  assert.equal(attempts, 2)
})

test('project-keyed pane discards a response after leaving the original project', async () => {
  let resolveAck
  assert.match(client, /h\(AgentReports, \{ key: 'agent-reports:' \+ \(eng \|\| ''\), engagement: eng, onReceipt: props\.onReportReceipt \}\)/)
  const first = mount('first', request => request.op === 'attention'
    ? Promise.resolve(queue('first', [report(31)]))
    : new Promise(resolve => { resolveAck = resolve }))
  await setImmediate()
  const oldClick = button(first, '将回报 #31 标为已阅').props.onClick
  const pending = oldClick()
  first.unmount()
  const second = mount('second', async () => queue('second', [report(31, { session_id: 'other-project' })]))
  resolveAck(queue('first', [], { ack: { report_id: 31, acknowledged: true } }))
  await pending
  await oldClick()
  await setImmediate()
  assert.equal(first.unmountedWrites(), 0)
  assert.match(content(second), /other-project/)
  assert.ok(button(second, '将回报 #31 标为已阅'))
})
