import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
function fragment(from, to) {
  const start = client.indexOf(from)
  const end = client.indexOf(to, start)
  assert.ok(start > 0 && end > start)
  return client.slice(start, end)
}
const response = (engagement, pendingAgentReports) => ({ ok: true, engagement, pendingAgentReports, sections: { agents: { count: 99 } } })
function mount(api) {
  const states = [], refs = []
  const timers = new Set(), listeners = new Map()
  let si, ri, deps, nextDeps, effect, dispose
  const seen = () => {}
  const document = {
    visibilityState: 'visible',
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
  }
  const context = {
    React: {
      useState(initial) {
        const i = si++
        if (!Object.hasOwn(states, i)) states[i] = initial
        return [states[i], (value) => { states[i] = value }]
      },
      useRef(initial) { return refs[ri++] ??= { current: initial } },
      useEffect(fn, values) { effect = fn; nextDeps = values },
    },
    api: (request) => api(structuredClone(request)),
    loadUnread: () => ({}), document,
    window: {
      setInterval(tick, ms) { assert.equal(ms, 25000); timers.add(tick); return tick },
      clearInterval(tick) { timers.delete(tick) },
    },
  }
  const hook = vm.runInNewContext(fragment('function usePanelDigest(', 'function Panel(') + '; usePanelDigest', context)
  return {
    render(engagement, visible = true, refresh = 0) {
      si = ri = 0
      const result = hook(engagement, refresh, visible, seen)
      if (!deps || nextDeps.some((value, i) => value !== deps[i])) {
        dispose?.()
        deps = nextDeps
        dispose = effect()
      }
      return result
    },
    visibility(state) {
      document.visibilityState = state
      return listeners.get('visibilitychange')?.()
    },
    ticks: () => Promise.all([...timers].map(tick => tick())),
    listeners, timers,
    unmount() { dispose?.() },
  }
}

test('the workspace reuses the digest cadence, never polls without a project or while hidden, and stops on unmount', async () => {
  const requests = []
  const pending = []
  const ui = mount(req => {
    requests.push(req)
    return new Promise(resolve => pending.push(resolve))
  })
  ui.render(null)
  ui.render('documents', false)
  assert.equal(requests.length, 0)
  ui.visibility('hidden')
  ui.render('documents')
  await ui.ticks()
  assert.equal(requests.length, 0)
  const visibilityTick = ui.visibility('visible')
  await ui.ticks()
  assert.deepEqual(requests, [{ op: 'consoleDigest', engagement: 'documents', includeAttention: true }])
  pending.shift()(response('documents', 2))
  await visibilityTick
  assert.equal(ui.render('documents').pendingAgentReports, 2)
  ui.unmount()
  assert.equal(ui.timers.size, 0)
  assert.equal(ui.listeners.size, 0)
})

test('switching projects drops delayed counts; errors and unsupported results are unknown, not zero', async () => {
  const pending = []
  const ui = mount(req => new Promise(resolve => pending.push([req.engagement, resolve])))
  ui.render('a')
  assert.equal(ui.render('b').pendingAgentReports, null)
  assert.deepEqual(pending.map(([id]) => id), ['a', 'b'])
  pending[1][1](response('b', 0))
  pending[0][1](response('a', 9))
  await setImmediate()
  assert.equal(ui.render('b').pendingAgentReports, 0)
  ui.render('b', true, 1)
  pending[2][1]({ ok: false })
  await setImmediate()
  assert.equal(ui.render('b', true, 1).pendingAgentReports, null)
  ui.render('b', true, 2)
  pending[3][1]({ ok: true, engagement: 'b', sections: {} })
  await setImmediate()
  assert.equal(ui.render('b', true, 2).pendingAgentReports, null)
  ui.unmount()
})

test('a manual acknowledgement updates both views and an already-started digest cannot restore its old count', async () => {
  let resolve
  const ui = mount(() => new Promise(done => { resolve = done }))
  const state = ui.render('documents')
  state.onReportReceipt({ engagement: 'unrelated', total: 10 })
  assert.equal(ui.render('documents').pendingAgentReports, null)
  state.onReportReceipt({ engagement: 'documents', total: 0 })
  resolve(response('documents', 7))
  await setImmediate()
  assert.equal(ui.render('documents').pendingAgentReports, 0)
  assert.equal(ui.render('documents').digest.agents.count, 99, 'existing activity summary is independent')
  const next = ui.ticks()
  resolve(response('documents', 3))
  await next
  assert.equal(ui.render('documents').pendingAgentReports, 3)
  ui.unmount()
})

test('overview and header show counts only, and their buttons navigate without a receipt', () => {
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const cards = vm.runInNewContext(fragment('function AgentReportSummary(', 'function OverviewTab(') +
    '; ({ AgentReportSummary, AgentReportReminder })', { h })
  let opened = 0
  const onOpen = () => { opened++ }
  assert.match(JSON.stringify(cards.AgentReportSummary({ total: null, onOpen })), /暂未取得/)
  assert.match(JSON.stringify(cards.AgentReportSummary({ total: 0, onOpen })), /没有待阅/)
  const summary = cards.AgentReportSummary({ total: 23, onOpen, blocked_reason: 'private-note' })
  assert.match(JSON.stringify(summary), /23 条回报待人工查看/)
  assert.doesNotMatch(JSON.stringify(summary), /private-note/)
  assert.equal(cards.AgentReportReminder({ total: 0, onOpen }), null)
  assert.equal(cards.AgentReportReminder({ total: null, onOpen }), null)
  const reminder = cards.AgentReportReminder({ total: 23, onOpen })
  assert.equal(reminder.props['aria-label'], '查看 23 条智能体待阅回报')
  summary.children.find(x => x.type === 'button').props.onClick()
  reminder.props.onClick()
  assert.equal(opened, 2)
  const goto = client.slice(client.indexOf('const openReportPage ='), client.indexOf('const openFull ='))
  assert.match(goto, /setUI\(\{ tab: 'agents', focus: null \}\)/)
  assert.doesNotMatch(goto, /\bapi\s*\(/)
  assert.match(client, /h\(AgentReportSummary, \{ total: props\.pendingAgentReports, onOpen: \(\) => goto\('agents'\) \}\)/)
  assert.match(client, /h\(AgentReportReminder, \{ total: pendingAgentReports, onOpen: openReportPage \}\)/)
})
