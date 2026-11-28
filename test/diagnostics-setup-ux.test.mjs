import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate as nextTurn } from 'node:timers/promises'
import test from 'node:test'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const text = node => node && typeof node === 'object'
  ? node.children.map(text).join('') : node == null || typeof node === 'boolean' ? '' : String(node)
const nodes = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []

// Exercise the shipped components with isolated fixtures, without booting the
// host or giving their effects access to transport beyond the supplied stubs.
function mount(start, end, name, scope = {}, props = {}) {
  let cursor, tree, queued, attached = []
  const slots = [], focused = []
  const hooks = {
    useState(initial) {
      const i = cursor++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }]
    },
    useRef(initial) {
      const i = cursor++
      return slots[i] ??= { current: initial }
    },
    useEffect(run, deps) {
      const i = cursor++
      const previous = slots[i]
      if (!previous || deps.some((dep, j) => !Object.is(previous.deps[j], dep))) {
        queued.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: run() } })
      }
    },
  }
  hooks.useLayoutEffect = hooks.useEffect
  const from = client.indexOf(start)
  const to = client.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from)
  const context = {
    h: (tag, attributes, ...children) => ({ tag, props: attributes || {}, children: children.flat(Infinity) }),
    React: { ...hooks, Fragment: Symbol('Fragment') }, ...hooks, ...scope,
  }
  const component = new Function(...Object.keys(context),
    client.slice(from, to) + '\nreturn ' + name)(...Object.values(context))
  function render(next = props) {
    props = next
    cursor = 0
    queued = []
    tree = component(props)
    for (const ref of attached) ref.current = null
    attached = []
    for (const n of nodes(tree)) {
      const ref = n.props.ref
      if (!ref) continue
      attached.push(ref)
      ref.current = { focus() { focused.push(n) }, getClientRects: () => [{}], open: false }
    }
    queued.forEach(run => run())
  }
  render()
  return {
    render, focused, text: () => text(tree),
    find: predicate => nodes(tree).find(predicate),
    count: predicate => nodes(tree).filter(predicate).length,
    button: label => nodes(tree).find(n => n.tag === 'button' && text(n) === label),
  }
}

function receipt(revision, { toolkit = '/saved/kit', binDirs = [], missingBinDirs = [] } = {}) {
  return {
    ok: true, configRevision: revision, config: { exists: true, toolkitDir: toolkit, binDirs, envAdaptConfigured: true },
    runtime: { effective: 'windows' }, tools: { items: [] },
    configCheck: { ok: true, environmentId: 'local', configRevision: revision, configExists: true,
      toolkitDirectoryOk: true, toolkitDirectoryConfigured: true, missingBinDirs },
  }
}

test('environment reads one local receipt, focuses the problem field, and preserves edits through save and queued refresh', async () => {
  const requests = []
  const pending = Promise.withResolvers()
  const initial = receipt('first', { binDirs: ['/saved/unavailable'], missingBinDirs: ['/saved/unavailable'] })
  const freshest = receipt('third', { binDirs: ['/saved/newer'] })
  const env = mount('    function envDraftDelta(', '    function GuideTab(props)', 'EnvTab', {
    api: async request => {
      requests.push(request)
      if (request.op === 'platformConfigSave') return pending.promise
      assert.equal(request.op, 'platformConfigGet', 'no automatic version, connection, or inventory requests')
      return requests.length === 1 ? initial : freshest
    },
  })
  await nextTurn()
  env.render()
  assert.deepEqual(requests.map(r => r.op), ['platformConfigGet'])
  assert.match(env.text(), /有 1 项已配置路径待处理/)

  env.button('编辑搜索目录').props.onClick()
  env.render()
  const paths = () => env.find(n => n.tag === 'textarea' && n.props.ref)
  const toolkit = () => env.find(n => n.tag === 'input' && n.props.ref)
  assert.equal(env.focused.at(-1), paths())
  paths().props.onChange({ target: { value: '/edited/bin' } })
  env.render()
  const saving = env.button('保存环境配置').props.onClick()
  env.render({ refreshKey: 1 })
  toolkit().props.onChange({ target: { value: '/still-editing/kit' } })
  env.render({ refreshKey: 2 })
  assert.deepEqual(requests.map(r => r.op), ['platformConfigGet', 'platformConfigSave'])
  assert.equal(requests[1].expectedRevision, 'first')
  assert.deepEqual(requests[1].config.binDirs, ['/edited/bin'])

  pending.resolve(receipt('second', { binDirs: ['/edited/bin'] }))
  await saving
  env.render()
  assert.deepEqual(requests.map(r => r.op), ['platformConfigGet', 'platformConfigSave', 'platformConfigGet'])
  assert.equal(paths().props.value, '/saved/newer')
  assert.equal(toolkit().props.value, '/still-editing/kit')
  assert.ok(env.button('保存环境配置'))
  env.button('环境总览').props.onClick()
  env.render()
  assert.match(env.text(), /已保存的配置未发现目录问题/)
  assert.match(env.text(), /当前检查结果仍基于已保存配置/)
})

test('unmatched receipt evidence is not claimed as checked; the old local check remains available', async () => {
  const initial = receipt('first')
  initial.configCheck.configRevision = 'old'
  const calls = []
  const env = mount('    function envDraftDelta(', '    function GuideTab(props)', 'EnvTab', {
    api: async request => {
      calls.push(request)
      return request.op === 'platformConfigGet' ? initial : receipt('first').configCheck
    },
  })
  await nextTurn()
  env.render()
  assert.match(env.text(), /目录检查尚未确认/)
  await env.button('检查本机目录').props.onClick()
  env.render()
  assert.deepEqual(calls, [{ op: 'platformConfigGet' }, { op: 'platformConfigCheck', expectedRevision: 'first' }])
  assert.match(env.text(), /已保存的配置未发现目录问题/)
})

test('HTTP panel summarizes unobserved statuses, bounds the list, and retries without replacing last good data', async () => {
  const timers = new Map()
  let id = 0, reads = 0, signal
  const snapshot = { ok: true, items: Array.from({ length: 50 }, () => ({ finish: 'stop', turnOutcome: 'completed' })) }
  const panel = mount('function projectHttpStatuses(', '/* __DSH_PURGE_RUNTIME_END__ */', 'HttpStatusObservationPanel', {
    document: { visibilityState: 'visible' },
    apiUrl: path => path,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id },
    clearTimeout: id => timers.delete(id),
    fetch: async (_url, options) => {
      signal = options.signal
      return ++reads === 2 ? { ok: false, status: 503 } : { ok: true, json: async () => snapshot }
    },
  })
  const rows = () => panel.count(n => n.props.className === 'dshp-http-row')
  await nextTurn()
  panel.render()
  assert.match(panel.text(), /这批 50 条请求均未记录 HTTP 状态/)
  assert.equal(rows(), 0)
  panel.button('全部请求 50').props.onClick()
  panel.render()
  assert.equal(rows(), 10)
  panel.button('再显示 10 条').props.onClick()
  panel.render()
  assert.equal(rows(), 20)
  panel.button('有 HTTP 状态 0').props.onClick()
  panel.render()
  assert.equal(rows(), 0)

  async function fire(ms) {
    const entry = [...timers].find(([, timer]) => timer.ms === ms)
    assert.ok(entry, 'expected scheduled refresh after ' + ms)
    timers.delete(entry[0])
    await entry[1].fn()
    panel.render()
  }
  await fire(2000)
  assert.match(panel.text(), /诊断接口 HTTP 503；这不是模型 Provider 的状态码/)
  assert.match(panel.text(), /上次成功读取的数据/)
  snapshot.items[5] = { httpStatus: 502, finish: 'error', turnOutcome: 'error' }
  await fire(4000)
  assert.equal(rows(), 1)
  assert.match(panel.text(), /请求 6 · HTTP 502/)
  assert.doesNotMatch(panel.text(), /诊断接口 HTTP 503/)
  panel.render({ active: false })
  assert.equal(timers.size, 0)
  assert.equal(signal.aborted, true)
})

test('host diagnostics starts with a next action, discloses raw text on demand, and marks a failed reading as stale', async () => {
  const state = { ok: true, ready: true, ai_base: '/fixture', plugin_identity: { loaded: '1.0', disk: '2.0' } }
  const dashboard = mount('function CleanDiagnostics(', 'function PatchGroups(', 'CleanDiagnostics', {
    useT: () => key => key, Btn: 'button',
    formatPatchDiagnostics: () => 'fixture diagnostic details', patchRowsOf: () => [],
  }, { state, onRefresh: async () => { throw new Error('fixture offline') } })
  assert.match(dashboard.text(), /已加载后端与磁盘版本不一致/)
  assert.doesNotMatch(dashboard.text(), /fixture diagnostic details/)
  await dashboard.button('重新检测宿主').props.onClick()
  dashboard.render()
  assert.match(dashboard.text(), /显示上次成功读取的状态/)
  assert.equal(dashboard.find(n => n.props.role === 'alert').children[0], '读取失败：fixture offline')
  dashboard.find(n => n.tag === 'details').props.onToggle({ currentTarget: { open: true } })
  dashboard.render()
  assert.match(dashboard.text(), /fixture diagnostic details/)
})
