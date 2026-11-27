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
  assert.match(client, /layout\.selectPanel\(panel\)/)
  assert.match(client, /selectPurgeHostPanel\(null\)/)
})

test('the main page reuses real clean and redteam components instead of a mockup', () => {
  assert.match(client, /page === "clean" \? h\(SettingsRoot, \{ t, workspace: true \}\)\s*: h\(__dshPurgeDrill\.Panel, \{ embedded: true, onOpenReportSession, maskReportOrigin \}\)/)
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
  assert.match(client, /hidden: section === "rules" \|\| \(section === "prompt" && !redteamExpanded\)/)
  assert.match(client, /className: "dshp-clean-pane", hidden: section !== "rules"/)
  assert.match(client, /h\(PurgifySection, null\)/)
  assert.match(client, /h\(RulesSection, null\)/)
  assert.match(client, /if \(props\.workspace !== true\)/)
  assert.match(client, /\.dshp-clean-pane\[hidden\],\.dshp-clean-subpane\[hidden\]\{display:none!important\}/)
})

test('clean pages reuse one state owner and keep hidden editors mounted', () => {
  assert.match(client, /h\(PurgifySection, \{ section, onNavigate: navigate \}\)/)
  assert.match(client, /function PurgifySection\(\{ section, onNavigate \} = \{\}\)/)
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
  assert.match(client, /cleanPane\(\["prompt"\], h\(InjectSwitchSection\)/)
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
