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
  assert.match(client, /immersive \? "退出系统全屏" : "系统全屏"/)
  assert.match(client, /ref: workspaceRef/)
  assert.match(client, /宿主不允许全屏/)
  assert.doesNotMatch(client, /useEffect\(\(\) => \{\s*el\.requestFullscreen\(\)/)
})

test('Purge fills the Harness viewport by default without a fullscreen click', () => {
  const client = read('client.js')
  assert.match(client, /const \[workspaceVisible, setWorkspaceVisible\] = useState\(true\)/)
  assert.match(client, /data-default-full/)
  assert.match(client, /position:fixed!important;inset:0!important;top:0!important;left:0!important/)
  assert.match(client, /width:100vw!important;height:100vh!important;height:100dvh!important/)
  assert.match(client, /return rd\.createPortal\(panel, document\.body\)/)
  assert.match(client, /setWorkspaceVisible\(false\)/)
  assert.match(client, /setWorkspaceVisible\(true\)/)
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


test('default Windows workspace keeps actions clear of native caption buttons', () => {
  const client = read('client.js')
  // Window Controls Overlay has a renderer-visible titlebar rectangle.
  // Reserve the space occupied by the OS buttons without hard-coding DPI/width.
  assert.match(client, /padding-right:max\(16px,calc\(100vw - env\(titlebar-area-x, 0px\) - env\(titlebar-area-width, 100vw\) \+ 16px\)\)/)
  // Native caption buttons disappear in system fullscreen, so restore normal spacing.
  assert.match(client, /\.dshp-workspace:fullscreen \.dshp-workspace-nav\{padding-right:16px\}/)
})
