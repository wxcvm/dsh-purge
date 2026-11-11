import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('native Purge workspace can enter and leave real immersive fullscreen from a user click', () => {
  const client = read('client.js')
  assert.match(client, /const workspaceRef = useRef\(null\)/)
  assert.match(client, /document\.addEventListener\("fullscreenchange", onChange\)/)
  assert.match(client, /document\.removeEventListener\("fullscreenchange", onChange\)/)
  assert.match(client, /document\.fullscreenElement === workspaceRef\.current/)
  assert.match(client, /el\.requestFullscreen\(\)/)
  assert.match(client, /document\.exitFullscreen\(\)/)
  assert.match(client, /onClick: toggleImmersive/)
  assert.match(client, /immersive \? "退出全屏" : "沉浸全屏"/)
  assert.match(client, /ref: workspaceRef/)
  assert.match(client, /宿主不允许全屏/)
  assert.doesNotMatch(client, /useEffect\(\(\) => \{\s*el\.requestFullscreen\(\)/)
})

test('immersive workspace overrides the old max-size layout and stays dark', () => {
  const client = read('client.js')
  assert.match(client, /\.dshp-dock\.dshp-workspace\[data-maximized=\\"1\\"\]:fullscreen/)
  assert.match(client, /inset:0!important;width:100vw!important;height:100vh!important/)
  assert.match(client, /\.dshp-dock\.dshp-workspace:fullscreen::backdrop\{background:#0c1422\}/)
})

test('standalone full-window view requests the screen work area and stays in sync with source', () => {
  const src = read('lib/redteam/client.js')
  const bundled = read('client.js')
  const snippet = "const screenArea = window.screen || {}"
  for (const s of [src, bundled]) {
    assert.ok(s.includes(snippet))
    assert.match(s, /screenArea\.availWidth \|\| window\.innerWidth/)
    assert.match(s, /screenArea\.availHeight \|\| window\.innerHeight/)
    assert.match(s, /window\.open\(window\.location\.href\.split\('#'\)\[0\] \+ '#redteam-full', '_blank', features\)/)
  }
  assert.equal((src.match(/const screenArea = window\.screen \|\| \{\}/g) || []).length, 1)
})
