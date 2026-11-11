import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function extractStyle(source) {
  const begin = source.indexOf('/* Full-screen paint stability + comfortable reading density.')
  assert.notEqual(begin, -1, 'full-view paint stability CSS must exist')
  const end = source.indexOf('`    /* ---------------------------------------------------------- 桥接与状态 */', begin)
  assert.ok(end > begin, 'CSS must stay inside the existing CSS template')
  return source.slice(begin, end)
}

test('full view avoids expensive backdrop layers on scrolling cards and inputs', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    const css = extractStyle(src)
    assert.match(css, /\.rt-full \.rt-card,.rt-full \.rt-ops-section/)
    assert.match(css, /\.rt-full \.rt-body,.rt-full \.rt-main,.rt-full \.rt-pane/)
    assert.match(css, /backdrop-filter:none!important;-webkit-backdrop-filter:none!important/)
    assert.match(css, /background:#101b2b!important/)
    assert.match(css, /line-height:1\.6;overscroll-behavior:contain/)
    assert.match(css, /\.rt-full \.rt-btn:hover:not\(:disabled\)\{transform:none\}/)
    assert.equal((src.match(/Full-screen paint stability \+ comfortable reading density\./g) || []).length, 1)
  }
})

test('source and embedded client use exactly the same full view CSS', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundled = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(extractStyle(source), extractStyle(bundled))
  assert.match(source, /function EnvTab\(props\)/)
  assert.match(bundled, /function EnvTab\(props\)/)
})


test('embedded environment keeps one scrolling pane and disables all nested blur layers', () => {
  const sources = ['../lib/redteam/client.js', '../client.js'].map(file =>
    readFileSync(new URL(file, import.meta.url), 'utf8'))
  const envStyles = sources.map(src => {
    assert.match(src, /return h\('div', \{ className: 'rt-main rt-env-main' \},/)
    const begin = src.indexOf('/* Embedded environment paint stability:')
    const end = src.indexOf('/* Full-screen paint stability + comfortable reading density.', begin)
    assert.ok(begin > 0 && end > begin)
    return src.slice(begin, end)
  })
  assert.equal(envStyles[0], envStyles[1], 'embedded CSS must match source')
  const css = envStyles[0]
  assert.match(css, /\.rt-dock\.rt-embedded \.rt-env-main\{[\s\S]*?background:#101b2b!important;/)
  assert.match(css, /\.rt-dock\.rt-embedded \.rt-env-main,\s*\.rt-dock\.rt-embedded \.rt-env-main \*\{[\s\S]*?backdrop-filter:none!important;-webkit-backdrop-filter:none!important;/)
  assert.match(css, /\.rt-dock\.rt-embedded \.rt-env-main>\.rt-pane\{[\s\S]*?overflow-y:auto!important;/)
  assert.match(css, /\.rt-dock\.rt-embedded \.rt-env-main \.rt-card\{[\s\S]*?background:#18283d!important;/)
  assert.match(css, /\.rt-dock\.rt-embedded \.rt-env-main \.rt-input,[\s\S]*?background:#122238!important;/)
})
