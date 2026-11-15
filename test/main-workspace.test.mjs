import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('Purge uses the native main panel and matching global sidebar entry', () => {
  assert.match(client, /name: "main", key: PURGE_PANEL_ID/)
  assert.match(client, /name: "sidebar.panellist", id: PURGE_PANEL_ID/)
  assert.match(client, /selectPurgeHostPanel\(PURGE_PANEL_ID\)/)
  assert.match(client, /selectPurgeHostPanel\(null\)/)
  assert.match(client, /layout\.selectPanel\(panel\)/)
})

test('the main page reuses real clean and redteam components instead of a mockup', () => {
  assert.match(client, /page === "clean" \? h\(SettingsRoot, \{ t, workspace: true \}\) : h\(__dshPurgeDrill\.Panel, \{ embedded: true \}\)/)
  assert.match(client, /"data-workspace": page === "clean" \? "clean" : "redteam"/)
  assert.match(client, /uiTag\.textContent = PURGE_CSS \+ PURGE_WORKSPACE_CSS/)
  assert.match(client, /showPurgeWorkspace\("drill"\)/)
  assert.match(client, /showPurgeWorkspace\("clean"\)/)
  assert.match(client, /setDock\(\{ open: false, authOpen: false \}\)/)
})

test('regenerating the embedded redteam component does not overwrite the main workspace', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-client.mjs', '--check'], {
    cwd: root, encoding: 'utf8',
  }), /embedded drill matches/)
  assert.match(client, /const PURGE_PANEL_ID = "dsh-purge-workspace"/)
})

test('native clean workspace has separate navigation without discarding edits', () => {
  assert.match(client, /const \[section, setSection\] = useState\("overview"\)/)
  assert.match(client, /"aria-label": "清洗台功能导航"/)
  assert.match(client, /"aria-current": section === item.id \? "page" : undefined/)
  assert.match(client, /className: "dshp-clean-pane", hidden: section === "rules"/)
  assert.match(client, /className: "dshp-clean-pane", hidden: section !== "rules"/)
  assert.match(client, /h\(PurgifySection, null\)/)
  assert.match(client, /h\(RulesSection, null\)/)
  assert.match(client, /if \(props\.workspace !== true\)/)
  assert.match(client, /\.dshp-clean-pane\[hidden\],\.dshp-clean-subpane\[hidden\]\{display:none!important\}/)
})

test('clean pages reuse one state owner and keep hidden editors mounted', () => {
  assert.match(client, /h\(PurgifySection, \{ section \}\)/)
  assert.match(client, /function PurgifySection\(\{ section \} = \{\}\)/)
  for (const id of ['overview', 'patches', 'prompt', 'maintenance', 'rules']) {
    assert.ok(client.includes('{ id: "' + id + '", title:'))
  }
  const helper = client.match(/const cleanPane = ([\s\S]*?\}, \.\.\.children\));/)
  assert.ok(helper)
  const makePane = new Function('h', 'section', 'return (' + helper[1] + ')')
  const h = (type, props, ...children) => ({ type, props, children })
  const editor = { value: 'unsaved' }
  assert.equal(makePane(h, 'prompt')(['prompt'], editor).props.hidden, false)
  const hidden = makePane(h, 'patches')(['prompt'], editor)
  assert.equal(hidden.props.hidden, true)
  assert.equal(hidden.children[0], editor)
  assert.equal(makePane(h, undefined)(['prompt'], editor).props.hidden, false)
  assert.match(client, /cleanPane\(\["patches"\], h\(PatchGroups/)
  assert.match(client, /cleanPane\(\["prompt"\], h\(InjectSwitchSection, \{ active: !section \|\| section === "prompt" \}\)/)
  assert.match(client, /cleanPane\(\["maintenance"\], h\("div", \{ className: "dshp-rel"/)
  assert.match(client, /cleanPane\(\["overview", "maintenance"\], s \? h\("div", \{ className: "dshp-metrics"/)
})

test('closed legacy Dock does not mount duplicate forms or run hidden API effects', () => {
  assert.match(client, /const body = !st\.open \? null : st\.tab === "clean"/)
  assert.match(client, /\? h\(SettingsRoot, \{ t \}\)/)
})

test('native main workspace loads both styles without depending on shell overlay', () => {
  assert.match(client, /function ensurePurgeWorkspaceStyles\(\)/)
  assert.match(client, /function PurgeWorkspacePage\(\) \{\s*const t = useT\(\);\s*useLayoutEffect\(\(\) => \{ ensurePurgeWorkspaceStyles\(\); \}, \[\]\)/)
  assert.match(client, /document\.querySelector\('style\[data-dsh-purge-drill="1"\]'\)/)
  assert.match(client, /function PurgeDock\(\)/)
  assert.match(client, /uiTag\.textContent = PURGE_CSS \+ PURGE_WORKSPACE_CSS/)
})


test('native maximized redteam workspace has opaque, blur-free scrolling surfaces', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const scope = '.dshp-dock.dshp-workspace[data-workspace="redteam"][data-maximized="1"] .rt-dock.rt-embedded'
  for (const code of [source, client]) {
    const start = code.indexOf(scope + ',\n' + scope + ' *{')
    assert.ok(start >= 0, 'native workspace paint rule must be present')
    const rule = code.slice(start, code.indexOf('}', start))
    assert.ok(rule.includes('backdrop-filter:none!important'))
    assert.ok(rule.includes('-webkit-backdrop-filter:none!important'))
    for (const [selector, color] of [['.rt-tabs', '#0e1a2b'], ['.rt-pane', '#101b2b'], ['.rt-card', '#18283d']]) {
      assert.ok(code.includes(scope + ' ' + selector + '{\n  background:' + color + '!important'))
    }
  }
})

test('clean overview distinguishes loaded and disk identities, missing host and unknown counts', () => {
  const start = client.indexOf('function CleanOverviewStatus(')
  const end = client.indexOf('function PurgifySection(', start)
  const h = (type, props, ...children) => ({ type, props, children })
  const render = new Function('h', 'CLIENT_BUILD_ID', client.slice(start, end) + ';return CleanOverviewStatus')(h, 'running-build')
  const base = { localVersion: 'beta.11', hostSurface: 'desktop', located: true, tally: {pending: 2, unmatched: 1}, jobOn: false }
  const body = JSON.stringify(render({...base, state: {plugin_identity: {loaded: 'beta.10', disk: 'beta.11'}, host_identity: {package: {version: '0.2.2-rc.3'}}}}))
  assert.match(body, /需要重新加载/)
  assert.match(body, /已加载 beta.10 · 磁盘 beta.11/)
  assert.match(body, /待应用 2 · 未匹配 1/)
  assert.match(body, /0.2.2-rc.3/)
  const missing = JSON.stringify(render({...base, located: false, state: null}))
  assert.match(missing, /等待检测/)
  assert.match(missing, /尚无完整补丁状态/)
  assert.doesNotMatch(missing, /状态已读取/)
  const failed = JSON.stringify(render({...base, located: false, state: {ok:false}}))
  assert.match(failed, /读取异常/)
  assert.match(failed, /宿主目录未定位/)
})

test('grouped navigation and shortcuts switch existing panes without remounting the editor owner', () => {
  const start = client.indexOf('function SettingsRoot(')
  const end = client.indexOf('const REWIND_CSS', start)
  const h = (type, props, ...children) => ({ type, props, children })
  const render = section => {
    let calls = [], idx = 0
    const scroll = {current:{scrollTop:120}}
    const context = new Function('h','useState','useRef','useLayoutEffect','useEffect','readTheme','PURGE_CSS','PurgifySection','RulesSection','RuntimeObservationsSection','CleanNavIcon',
      'let translate;'+client.slice(start,end)+';return SettingsRoot({workspace:true})')
    const tree = context(h, init => [idx++ === 0 ? 'dusk' : section, v => calls.push(v)], () => scroll, f => f(), () => {}, () => 'dusk', '', 'PurgifySection','RulesSection','RuntimeObservationsSection','CleanNavIcon')
    const nodes=[];function visit(n){if(Array.isArray(n)){n.forEach(visit);return}if(n&&typeof n==='object'){nodes.push(n);visit(n.children)}}visit(tree)
    return {nodes,calls,scroll}
  }
  const initial = render('overview')
  assert.equal(initial.nodes.filter(n=>n.props?.className==='dshp-clean-nav-group').length,3)
  assert.equal(initial.nodes.filter(n=>n.props?.className==='dshp-clean-nav-item').length,7)
  const target = initial.nodes.find(n=>n.props?.key==='runtime' && n.type==='button')
  target.props.onClick(); assert.equal(initial.calls.at(-1),'runtime')
  assert.equal(initial.scroll.current.scrollTop,0)
  const runtime = render('runtime')
  assert.equal(runtime.nodes.find(n=>n.type==='PurgifySection').props.section,'runtime')
  assert.equal(runtime.nodes.find(n=>n.type==='RuntimeObservationsSection').props.onNavigate instanceof Function,true)
  assert.equal(runtime.nodes.find(n=>n.type==='RuntimeObservationsSection').props.active,true)
  assert.equal(initial.nodes.find(n=>n.type==='RuntimeObservationsSection').props.active,false)
  assert.equal(runtime.nodes.find(n=>n.props?.key==='runtime' && n.type==='button').props['aria-current'],'page')
})
