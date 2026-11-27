import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('maximized host Dock selects the real embedded dark console, not only #redteam-full', () => {
  const client = read('client.js')
  assert.match(client, /"data-workspace": st\.tab === "clean" \? "clean" : "redteam"/)
  assert.match(client, /h\(__dshPurgeDrill\.Panel, \{ embedded: true \}\)/)
  assert.match(client, /\.dshp-dock\[data-workspace="redteam"\]\[data-maximized="1"\]/)
  assert.match(client, /\.rt-dock\.rt-embedded\{\s*display:grid!important/)
  assert.match(client, /grid-template-columns:224px minmax\(0,1fr\)/)
  assert.match(client, /\.rt-body\{\s*grid-column:2;grid-row:2/)
  assert.match(client, /\.rt-tabs\{\s*grid-column:1;grid-row:2/)
  assert.match(client, /--dshp-paper:#15243a/)
  assert.match(client, /\.rt-privacy-pane,\s*\.dshp-dock\[data-workspace="redteam"/)
})

test('embedded narrow Dock uses an accessible select, not an overflowing 16-tab strip', () => {
  for (const client of [read('lib/redteam/client.js'), read('client.js')]) {
    assert.match(client, /className: 'rt-compact-nav'/)
    assert.match(client, /className: 'rt-compact-nav-select'/)
    assert.match(client, /'aria-label': '选择作战台页面'/)
    assert.match(client, /tabSections\.map\(\(section\) => h\('optgroup'/)
    assert.match(client, /const tab = e\.target\.value\s*markTabSeen\(tab\)\s*setUI\(\{ tab, focus: null \}\)/)
    assert.match(client, /@container\(max-width:1100px\)/)
    assert.match(client, /\.rt-embedded>\.rt-tabs\{display:none!important\}/)
    assert.match(client, /\.rt-embedded>\.rt-compact-nav\{display:flex!important\}/)
    assert.match(client, /@container\(max-width:720px\)/)
    assert.match(client, /op: 'platformConfigSave'/)
    assert.match(client, /op: 'localAssetSearch'/)
  }
})

test('host max width falls back to compact layout without false API or theme changes', () => {
  const ui = read('client.js')
  assert.match(ui, /@media\(max-width:1120px\)/)
  assert.match(ui, /\.dshp-dock-body \.rt-dock\.rt-embedded\{\s*display:flex!important;flex-direction:column!important/)
  assert.match(ui, /\.dshp-dock-body \.rt-tabs\{\s*display:none!important/)
  assert.match(ui, /\.dshp-dock-body \.rt-compact-nav\{\s*display:flex!important/)
  assert.match(ui, /\.dshp-dock\[data-theme="white"\]/)
  assert.match(ui, /\.dshp-dock\[data-theme="dusk"\]/)
})

test('embedded client.js matches the actual React source after build', () => {
  const stdout = execFileSync(process.execPath, ['scripts/build-client.mjs', '--check'], {
    cwd: base, encoding: 'utf8',
  })
  assert.match(stdout, /embedded drill matches/)
})
