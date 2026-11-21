import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('restart confirmation carries its resolved theme through the body portal', () => {
  const renderSource = client.match(/function RestartAsk\(props\) \{[\s\S]*?(?=\n\s*const UPDATE_STAGE_LABELS)/)?.[0]
  assert.ok(renderSource)
  const body = {}
  const h = (tag, props, ...children) => ({ tag, props, children })
  const require = () => ({ createPortal: (node, target) => ({ node, target }) })
  const render = new Function('h', 'Btn', 'require', 'document', renderSource + '\nreturn RestartAsk')(
    h, 'button', require, { body },
  )
  for (const [theme, expected] of [['dusk', 'dusk'], ['white', 'white'], [undefined, 'white']]) {
    const { node, target } = render({ theme, t: (key) => key })
    assert.equal(target, body)
    assert.equal(node.props.className, 'dshp-restart-mask')
    assert.equal(node.props.role, 'dialog')
    assert.equal(node.props['data-theme'], expected)
  }
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
