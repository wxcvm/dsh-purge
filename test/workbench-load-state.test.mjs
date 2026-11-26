import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = client.indexOf('function Panel(props)')
const end = client.indexOf('function SidebarButton(', start)
assert.ok(start >= 0 && end > start, 'expected the bundled workbench panel')

function mount(handler) {
  const values = []
  const refs = []
  const effects = []
  const requests = []
  const ui = { open: true, tab: 'overview' }
  let stateIndex, refIndex, mounted = false
  const context = vm.createContext({
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    api(req) { const copy = structuredClone(req); requests.push(copy); return Promise.resolve().then(() => handler(copy)) },
    React: {
      Fragment: 'Fragment',
      useState(initial) {
        const i = stateIndex++
        if (!Object.hasOwn(values, i)) values[i] = typeof initial === 'function' ? initial() : initial
        return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next }]
      },
      useRef(initial) { return refs[refIndex++] ??= { current: initial } },
      useEffect(fn) { if (!mounted) effects.push(fn) },
      useCallback(fn) { return fn },
    },
    useUI: () => ui,
    setUI: (value) => Object.assign(ui, value),
    isFullWindow: () => false,
    setTemporaryPrivacy() {},
    loadRtGeom: () => ({}),
    usePanelDigest: () => ({}),
    activeWorkbenchTab: tab => tab === 'superagent' || tab === 'prompts' ? 'agents' : tab,
    AgentReportReminder: 'AgentReportReminder', RtNavIcon: 'RtNavIcon', RtBoundary: 'RtBoundary',
    OverviewTab: 'OverviewTab', AgentsTab: 'AgentsTab',
  })
  vm.runInContext(client.slice(start, end), context)
  const render = () => { stateIndex = refIndex = 0; return vm.runInContext('Panel({ embedded: true })', context) }
  render()
  mounted = true
  const cleanups = effects.map(fn => fn())
  return { render, requests, ui, unmount() { for (const dispose of cleanups) dispose?.() } }
}

const nodeList = (node) => Array.isArray(node) ? node.flatMap(nodeList)
  : node && typeof node === 'object' ? [node, ...nodeList(node.children)] : []
const button = (view, label) => nodeList(view.render()).find(n => n.type === 'button' && n.children.includes(label))
const selector = (view) => nodeList(view.render()).find(n => n.type === 'select' && n.props['aria-label'] === '选择靶标')
const content = (view) => JSON.stringify(view.render())
const deferred = () => { let resolve; const promise = new Promise(fn => { resolve = fn }); return { promise, resolve } }
const roster = (ids, current = null) => ({ ok: true, engagements: ids.map(id => ({ id, name: id })), current })
const snapshot = (id, assets = 0) => ({ ok: true, engagement: { id, name: id }, stats: { assets } })

test('first 403 is not an empty roster; retry restores the current project and real counts', async () => {
  const initial = deferred()
  let reads = 0
  const view = mount(req => {
    if (req.op === 'bootstrap') return ++reads === 1 ? initial.promise : roster(['a', 'b'], 'b')
    if (req.op === 'snapshot') return snapshot(req.engagement, 4)
    assert.fail(req.op)
  })
  assert.match(content(view), /正在加载项目列表/)
  assert.doesNotMatch(content(view), /暂无靶标|资产 0/)
  initial.resolve({ ok: false, error: 'cross-origin request rejected' })
  await setImmediate()
  assert.match(content(view), /项目列表加载失败：宿主拒绝了请求/)
  assert.equal(selector(view).props.disabled, true)
  assert.doesNotMatch(content(view), /暂无靶标|资产 0/)
  await button(view, '重试加载').props.onClick()
  await setImmediate()
  assert.deepEqual(view.requests, [{ op: 'bootstrap' }, { op: 'bootstrap' }, { op: 'snapshot', engagement: 'b' }])
  assert.equal(selector(view).props.value, 'b')
  const overview = nodeList(view.render()).find(n => n.type === 'OverviewTab')
  assert.equal(overview.props.engagement, 'b')
  assert.match(content(view), /资产 4/)
  assert.doesNotMatch(content(view), /项目列表加载失败/)
  overview.props.onOpenReportPage()
  assert.equal(view.ui.tab, 'agents')
  view.unmount()
})

test('empty roster is only shown after a successful response; later failure is unknown again', async () => {
  let reads = 0
  const view = mount(req => {
    assert.equal(req.op, 'bootstrap')
    if (++reads === 1) return { ok: true }
    if (reads === 2) return roster([])
    throw Error('connection lost')
  })
  await setImmediate()
  assert.match(content(view), /未取得项目列表/)
  assert.doesNotMatch(content(view), /暂无靶标/)
  await button(view, '刷新').props.onClick()
  assert.match(content(view), /暂无靶标/)
  assert.doesNotMatch(content(view), /资产 0/)
  await button(view, '刷新').props.onClick()
  assert.doesNotMatch(content(view), /暂无靶标|资产 0/)
  assert.match(content(view), /connection lost/)
  view.unmount()
})

test('older roster and snapshot responses cannot overwrite a newer selection', async () => {
  const oldRoster = deferred()
  const oldSnapshot = deferred()
  let reads = 0
  const view = mount(req => {
    if (req.op === 'bootstrap') return ++reads === 1 ? oldRoster.promise : roster(['a', 'b'], 'a')
    if (req.op === 'snapshot') return req.engagement === 'a' ? oldSnapshot.promise : snapshot('b', 7)
    assert.deepEqual(req, { op: 'activateEngagement', engagement: 'b' })
    return { ok: true }
  })
  await button(view, '刷新').props.onClick()
  selector(view).props.onChange({ target: { value: 'b' } })
  await setImmediate()
  oldRoster.resolve({ ok: false, error: 'late failure' })
  oldSnapshot.resolve(snapshot('a', 99))
  await setImmediate()
  assert.equal(selector(view).props.value, 'b')
  assert.match(content(view), /资产 7/)
  assert.doesNotMatch(content(view), /资产 99|late failure/)
  await button(view, '刷新').props.onClick()
  await setImmediate()
  assert.equal(selector(view).props.value, 'b', 'refresh preserves a valid operator selection')
  view.unmount()
})

test('overview snapshot failure and recovery do not replace the agent page', async () => {
  let snapshots = 0
  const view = mount(req => req.op === 'bootstrap' ? roster(['a'], 'a')
    : ++snapshots === 1 ? snapshot('different-project', 99) : snapshot('a'))
  await setImmediate()
  assert.match(content(view), /统计加载失败/)
  assert.doesNotMatch(content(view), /资产 99|资产 0/)
  view.ui.tab = 'superagent'
  assert.match(content(view), /AgentsTab/)
  assert.match(content(view), /统计未加载/)
  view.ui.tab = 'overview'
  await button(view, '重试加载').props.onClick()
  await setImmediate()
  assert.match(content(view), /资产 0/, 'genuine zero is shown after the matching snapshot succeeds')
  assert.doesNotMatch(content(view), /统计加载失败/)
  view.unmount()
})
