import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = client.indexOf('function SettingsRoot(')
const end = client.indexOf('const REWIND_CSS', start)
assert.ok(start >= 0 && end > start)

// Exercise the shipped navigation and layout effect without starting a host
// or mounting any of the content panes and their host requests.
function workspace() {
  let stateIndex, refIndex, tree
  let layoutDeps = [], layoutEffect, attached = []
  const state = [], refs = [], focused = []
  const scope = {
    h(tag, props, ...children) { return { tag, props: props ?? {}, children: children.flat() } },
    useState(initial) {
      const index = stateIndex++
      if (index >= state.length) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => { state[index] = next }]
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial } },
    useEffect() {},
    useLayoutEffect(effect, deps) {
      if (deps.some((dep, i) => !Object.is(dep, layoutDeps[i]))) {
        layoutEffect = effect
        layoutDeps = deps
      }
    },
    readTheme: () => 'dusk',
    PURGE_CSS: '',
    PurgifySection: Symbol('PurgifySection'),
    PromptProfilesSection: Symbol('PromptProfilesSection'),
    RulesSection: Symbol('RulesSection'),
    RuntimeObservationsSection: Symbol('RuntimeObservationsSection'),
    HttpStatusObservationPanel: Symbol('HttpStatusObservationPanel'),
  }
  const SettingsRoot = new Function(...Object.keys(scope),
    'let translate;\n' + client.slice(start, end) + '\nreturn SettingsRoot;')(...Object.values(scope))
  function nodes(node = tree) {
    return typeof node === 'object' && node
      ? [node, ...node.children.flatMap(child => nodes(child || false))] : []
  }
  function render() {
    stateIndex = refIndex = 0
    layoutEffect = null
    tree = SettingsRoot({ workspace: true })
    for (const ref of attached) ref.current = null
    attached = []
    for (const node of nodes()) {
      if (node.props.ref) {
        attached.push(node.props.ref)
        node.props.ref.current = { focus() { focused.push({ tag: node.tag, label: node.children[0] }) } }
      }
    }
    layoutEffect?.()
  }
  render()
  return {
    render, focused,
    button: label => nodes().find(node => node.tag === 'button' && node.children[0] === label),
    page: (id) => nodes().find(node => node.tag === scope[id]),
    sidebar: () => nodes().filter(node => node.props.className === 'dshp-clean-nav-item'),
  }
}

test('clean workspace keeps keyboard focus on a visible destination after a content shortcut', () => {
  const root = workspace()
  assert.deepEqual(root.focused, [], 'first render must not steal focus')
  root.page('PurgifySection').props.onNavigate('runtime')
  root.render()
  assert.deepEqual(root.focused.pop(), { tag: 'h2', label: '诊断中心' })
  root.page('RuntimeObservationsSection').props.onNavigate('diagnostics')
  root.render()
  assert.deepEqual(root.focused.pop(), { tag: 'button', label: '宿主与故障' })
  assert.equal(root.button('宿主与故障').props['aria-pressed'], true)
  assert.equal(root.page('RuntimeObservationsSection').props.active, false)

  root.button('Provider 与运行记录').props.onClick()
  root.render()
  assert.deepEqual(root.focused, [], 'a visible toggle keeps its normal button focus')
  root.button('HTTP 响应观察').props.onClick()
  root.render()
  assert.equal(root.page('HttpStatusObservationPanel').props.active, true)
  assert.equal(root.page('RuntimeObservationsSection').props.active, false)
  root.page('HttpStatusObservationPanel').props.onNavigate('runtime')
  root.render()
  assert.deepEqual(root.focused.pop(), { tag: 'button', label: 'Provider 与运行记录' })
  root.sidebar()[2].props.onClick()
  root.render()
  assert.deepEqual(root.focused.pop(), { tag: 'h2', label: '提示词管理' })
  root.page('PromptProfilesSection').props.onRedteam()
  root.render()
  assert.equal(root.button('收起红队专用提示词').props['aria-expanded'], true)
  assert.deepEqual(root.focused.pop(), { tag: 'button', label: '收起红队专用提示词' })
  root.render()
  assert.deepEqual(root.focused, [], 'ordinary re-render does not steal focus')
})

test('sidebar arrow keys and Home/End move focus without activating a page', () => {
  const root = workspace()
  const sidebar = root.sidebar()
  const moves = []
  const nodes = sidebar.map((button, i) => ({ focus: () => moves.push(i) }))
  for (const node of nodes) node.parentElement = { querySelectorAll: () => nodes }
  function key(index, key, options = {}) {
    let prevented = false
    sidebar[index].props.onKeyDown({ key, currentTarget: nodes[index], ...options,
      preventDefault: () => { prevented = true } })
    return prevented
  }
  assert.equal(key(0, 'ArrowUp'), true)
  assert.equal(key(5, 'ArrowRight'), true)
  assert.equal(key(1, 'End'), true)
  assert.equal(key(4, 'Home'), true)
  assert.equal(key(0, 'ArrowDown'), true)
  assert.equal(key(1, 'ArrowLeft'), true)
  assert.equal(key(4, 'ArrowDown', { altKey: true }), false)
  assert.equal(key(3, 'Enter'), false)
  assert.deepEqual(moves, [5, 0, 5, 0, 1, 0])
  root.render()
  assert.equal(root.sidebar()[0].props['aria-current'], 'page')
  assert.deepEqual(root.focused, [], 'page is not activated by focus movements')
  root.sidebar()[5].props.onClick()
  root.render()
  assert.deepEqual(root.focused, [{ tag: 'h2', label: '诊断中心' }])
})
