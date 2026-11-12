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
  const css = JSON.parse(client.match(/const PURGE_WORKSPACE_CSS = ("(?:[^"\\]|\\.)*");/)[1])
  const rule = css.match(/\.dshp-dock\.dshp-workspace\[data-maximized="1"\]\[data-default-full="1"\]\{([^}]*)\}/)
  assert.ok(rule)
  assert.match(rule[1], /position:fixed!important;inset:0!important/)
  assert.match(rule[1], /width:auto!important;height:auto!important/)
  assert.doesNotMatch(rule[1], /100(?:d?vh|vw)/)
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


test('Windows native caption palette follows late mount and restores the latest host theme', () => {
  const client = read('client.js')
  const helper = client.match(/function installPurgeCaptionPalette\(doc, Observer\) \{[\s\S]*?\n\t\t\}/)
  assert.ok(helper, 'caption lifecycle helper must exist')
  const install = new Function('return (' + helper[0] + ')')()
  const fill = '--dsw-specific-sidebar-fill'
  const ink = '--dsw-alias-label-primary'
  const values = new Map([[fill, { value: '#ffffff', priority: '' }], [ink, { value: '#202020', priority: '' }]])
  let writes = 0
  const style = {
    getPropertyValue: name => values.get(name)?.value || '',
    getPropertyPriority: name => values.get(name)?.priority || '',
    setProperty(name, value, priority = '') { writes++; values.set(name, { value, priority }) },
    removeProperty(name) { writes++; values.delete(name) },
  }
  let mounted = false
  let callback
  let disconnected = false
  const targets = []
  class Observer {
    constructor(fn) { callback = fn }
    observe(target, options) { targets.push({ target, options }) }
    disconnect() { disconnected = true }
  }
  const body = { style }
  const root = { hasAttribute: name => name === 'data-windows-titlebar' && mounted }
  const dispose = install({ body, documentElement: root }, Observer)
  assert.equal(writes, 0, 'Web or a not-yet-mounted caption is untouched')
  assert.equal(targets.length, 2)
  mounted = true
  callback()
  assert.equal(style.getPropertyValue(fill), '#101c2d')
  assert.equal(style.getPropertyValue(ink), '#e5eefb')
  const before = writes
  callback()
  assert.equal(writes, before, 'Unrelated mutations must not cause a write loop')
  style.setProperty(fill, '#cccccc', 'important')
  callback()
  assert.equal(style.getPropertyValue(fill), '#101c2d')
  mounted = false
  callback()
  assert.equal(style.getPropertyValue(fill), '#cccccc')
  assert.equal(style.getPropertyPriority(fill), 'important')
  assert.equal(style.getPropertyValue(ink), '#202020')
  mounted = true
  callback()
  assert.equal(style.getPropertyValue(fill), '#101c2d')
  style.setProperty(ink, '#abcdef', 'important')
  dispose()
  assert.equal(disconnected, true)
  assert.equal(style.getPropertyValue(fill), '#cccccc')
  assert.equal(style.getPropertyValue(ink), '#abcdef', 'A pending host change must not be overwritten')
  assert.match(client, /return installPurgeCaptionPalette\(document, MutationObserver\)/)
})


test('Windows caption keeps Purge tabs below the native 40px hit area until fullscreen', () => {
  const client = read('client.js')
  const literal = client.match(/const PURGE_WORKSPACE_CSS = ("(?:[^"\\]|\\.)*");/)?.[1]
  assert.ok(literal, 'workspace CSS must exist')
  const css = JSON.parse(literal)
  assert.match(css, /html\[data-windows-titlebar\] \.dshp-dock\.dshp-workspace\[data-default-full="1"\],/)
  assert.match(css, /\.dshp-workspace :is\(button,input,select,textarea,a,\[role="button"\]\)\s*\{\s*-webkit-app-region:no-drag;/)
  // The native DSH Windows titlebar owns the first 40 CSS pixels for hit
  // testing. A portal with inset:0 can paint tabs there but not receive clicks.
  const normalWindow = /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.dshp-dock\.dshp-workspace\[data-maximized="1"\]\[data-default-full="1"\]:not\(:fullscreen\)\{([^}]*)\}/.exec(css)
  assert.ok(normalWindow, 'default workspace needs its own normal-window caption clearance')
  assert.match(normalWindow[1], /top:var\(--dsh-windows-titlebar-height,40px\)!important;/)
  assert.doesNotMatch(normalWindow[1], /height:calc/)
  // The existing true-fullscreen rule keeps the entire viewport available.
  assert.match(css, /\.dshp-dock\.dshp-workspace\[data-maximized="1"\]:fullscreen\{[^}]*inset:0!important;[^}]*height:100%!important;/)
  assert.match(client, /onClick: \(\) => open\(key\)/)
})
