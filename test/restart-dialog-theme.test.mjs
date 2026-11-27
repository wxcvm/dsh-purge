import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('restart confirmation carries its resolved theme through the body or owned fullscreen portal', () => {
  const renderSource = client.match(/function RestartAsk\(props\) \{[\s\S]*?(?=\n\s*const UPDATE_STAGE_LABELS)/)?.[0]
  assert.ok(renderSource)
  const body = {}
  const workspace = { matches: selector => selector === '.dshp-dock.dshp-workspace' }
  const foreign = { matches: () => false }
  const doc = new EventTarget()
  doc.body = body
  let cleanup, refreshes = 0
  const useState = () => [0, update => { refreshes = update(refreshes) }]
  const useEffect = callback => { if (!cleanup) cleanup = callback() }
  const h = (tag, props, ...children) => ({ tag, props, children })
  const require = () => ({ createPortal: (node, target) => ({ node, target }) })
  const render = new Function('h', 'Btn', 'require', 'document', 'useState', 'useEffect', renderSource + '\nreturn RestartAsk')(
    h, 'button', require, doc, useState, useEffect,
  )
  for (const [theme, expected] of [['dusk', 'dusk'], ['white', 'white'], [undefined, 'white']]) {
    const { node, target } = render({ theme, t: (key) => key })
    assert.equal(target, body)
    assert.equal(node.props.className, 'dshp-restart-mask')
    assert.equal(node.props.role, 'dialog')
    assert.equal(node.props['data-theme'], expected)
  }
  doc.fullscreenElement = workspace
  doc.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(refreshes, 1)
  assert.equal(render({ theme: 'white', t: key => key }).target, workspace)
  doc.fullscreenElement = foreign
  doc.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(render({ t: key => key }).target, body)
  doc.fullscreenElement = null
  doc.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(render({ t: key => key }).target, body)
  assert.equal(refreshes, 3)
  cleanup()
  doc.dispatchEvent(new Event('fullscreenchange'))
  assert.equal(refreshes, 3)
})

test('restart colors and color-scheme follow the portal when the host palette disagrees', () => {
  assert.match(client, /\.dshp-restart-mask\[data-theme="white"\]\{color-scheme:light\}/)
  assert.match(client, /\.dshp-restart-mask\[data-theme="dusk"\]\{color-scheme:dark\}/)
  assert.match(client, /:is\(html,body\)\[data-ds-dark-theme\] \.dshp-restart-mask\[data-theme="white"\]\{[^}]*--dsw-alias-bg-layer-1:#fffcf7;[^}]*--dsw-alias-label-primary:#16140f;/)
  assert.match(client, /html:not\(\[data-ds-dark-theme\]\) body:not\(\[data-ds-dark-theme\]\) \.dshp-restart-mask\[data-theme="dusk"\]\{[^}]*--dsw-alias-bg-layer-1:#1c1e24;/)
  assert.doesNotMatch(client, /body\[data-ds-dark-theme\] \.dshp-restart-card/)
  for (const part of ['', ' .dshp-btn', ' :is(.dshp-btn-primary,.dshp-btn-primary:hover:not(:disabled))']) {
    assert.ok(client.includes(
      ':is(body[data-ds-dark-theme] .dshp-restart-mask:not([data-theme]),.dshp-restart-mask[data-theme="dusk"]) .dshp-restart-card' + part + '{',
    ), 'host dark fallback for restart card and buttons applies only without an explicit theme')
  }
})

test('restart confirmation keeps actions accessible in short or narrow viewports', () => {
  const mask = client.match(/\.dshp-restart-mask\{([^}]+)\}/)?.[1]
  const card = client.match(/\.dshp-restart-card\{([^}]+)\}/)?.[1]
  assert.match(mask, /box-sizing:border-box/)
  assert.match(mask, /padding:clamp\(8px,4vmin,24px\)/)
  assert.match(card, /max-height:100%/)
  assert.match(card, /min-height:0/)
  assert.match(card, /overflow:auto/)
  assert.match(card, /overscroll-behavior:contain/)
  assert.match(client, /\.dshp-restart-card \.dshp-modal-ops\{flex-wrap:wrap\}/)
})
