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
  assert.match(client, /position:fixed!important;inset:0!important;z-index:10040!important/)
  assert.match(client, /width:auto!important;height:auto!important;box-sizing:border-box!important/)
  assert.match(client, /return rd\.createPortal\(panel, document\.body\)/)
  assert.match(client, /setWorkspaceVisible\(false\)/)
  assert.match(client, /setWorkspaceVisible\(true\)/)
})

test('immersive workspace overrides the old max-size layout and stays dark', () => {
  const client = read('client.js')
  assert.match(client, /\.dshp-dock\.dshp-workspace\[data-maximized=\\"1\\"\]:fullscreen/)
  assert.match(client, /inset:0!important;width:100%!important;height:100%!important/)
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


test('Purge renders an opaque dark workspace before entering system fullscreen', () => {
  const client = read('client.js')
  const literal = client.match(/const PURGE_WORKSPACE_CSS = ("(?:[^"\\]|\\.)*");/)?.[1]
  assert.ok(literal, 'workspace CSS string must exist')
  const css = JSON.parse(literal)
  assert.match(css, /\.dshp-dock\.dshp-workspace\[data-maximized="1"\]\[data-default-full="1"\]\{[^}]*background:#0c1422!important;[^}]*backdrop-filter:none!important;[^}]*-webkit-backdrop-filter:none!important;/)
  // The old Dock makes .dshp-root transparent with !important: the native
  // clean page must override that rule or the light host leaks through.
  assert.match(css, /\.dshp-workspace\[data-workspace="clean"\] \.dshp-root\.dshp-clean-workspace\{[^}]*background:#0c1422!important;/)
  assert.match(css, /\.dshp-workspace \.dshp-workspace-nav\{flex-wrap:wrap;gap:7px;padding:9px;padding-right:max\(9px,calc\(/)
})


test('Windows native caption palette follows late mount and restores host-owned values', () => {
  const client = read('client.js')
  const workspace = client.slice(client.indexOf('function PurgeWorkspacePage() {'), client.indexOf('const toggleImmersive = () =>'))
  const helper = client.slice(client.indexOf('function installPurgeCaptionPalette('), client.indexOf('function workspacePrivacySummary('))
  assert.match(workspace, /installPurgeCaptionPalette\(document, MutationObserver\)/)
  assert.match(helper, /attributeFilter: \["data-windows-titlebar"\]/)
  assert.match(helper, /attributeFilter: \["style"\]/)
  assert.match(helper, /style\.getPropertyValue\(name\)\.trim\(\) !== saved\.color/)
  assert.match(helper, /style\.setProperty\(name, saved\.value, saved\.priority\)/)
  assert.match(helper, /observer\.disconnect\(\)/)
})


test('Windows caption keeps Purge tabs below the native 40px hit area until fullscreen', () => {
  const client = read('client.js')
  const literal = client.match(/const PURGE_WORKSPACE_CSS = ("(?:[^"\\]|\\.)*");/)?.[1]
  assert.ok(literal, 'workspace CSS must exist')
  const css = JSON.parse(literal)
  assert.match(css, /html\[data-windows-titlebar\] \.dshp-dock\.dshp-workspace\[data-default-full="1"\],[\s\S]*?\.dshp-workspace :is\(button,input,select,textarea,a,\[role="button"\]\)\{\s*-webkit-app-region:no-drag;/)
  // The native DSH Windows titlebar owns the first 40 CSS pixels for hit
  // testing. A portal with inset:0 can paint tabs there but not receive clicks.
  const normalWindow = /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.dshp-dock\.dshp-workspace\[data-maximized="1"\]\[data-default-full="1"\]:not\(:fullscreen\)\{([^}]*)\}/.exec(css)
  assert.ok(normalWindow, 'default workspace needs its own normal-window caption clearance')
  assert.match(normalWindow[1], /top:var\(--dsh-windows-titlebar-height,40px\)!important;/)
  assert.doesNotMatch(normalWindow[1], /height:calc/)
  assert.match(css, /\[data-default-full="1"\]\{[^}]*inset:0!important;[^}]*height:auto!important;/)
  // The existing true-fullscreen rule keeps the entire viewport available.
  assert.match(css, /\.dshp-dock\.dshp-workspace\[data-maximized="1"\]:fullscreen\{[^}]*inset:0!important;[^}]*height:100%!important;/)
  assert.match(client, /onClick: \(\) => open\(key\)/)
})
