import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../lib/redteam/store-core.js'

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8')

test('workbench has a real low-impact tab in both source and embedded UI', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = read(path)
    assert.match(src, /function LowImpactTab\(props\)/, path)
    assert.match(src, /\['low-impact', '智能隐私中心'\]/, path)
    assert.match(src, /st\.tab === 'low-impact'/, path)
    assert.match(src, /op: 'platformConfigSave', config: \{ scanPreferences: expected, privacyManagement: policy \}/, path)
    assert.match(src, /maskHistory \? '目标已隐藏'/, path)
    assert.match(src, /item\.output_file && !maskHistory/, path)
  }
})

test('workbench API saves only scan preferences and preserves existing configuration', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-impact-ui-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = { root: dir }
  let result = dispatch(store, { op: 'platformConfigSave',
    config: { tools: { nmap: '/mock/nmap' } } })
  assert.equal(result.ok, true)
  result = dispatch(store, { op: 'platformConfigSave', config: { scanPreferences: {
    mode: 'low-impact', timeoutSeconds: 60, captureDiagnostics: false, maskHistory: true,
    noReverseDns: true, maskAssetResults: true,
  } } })
  assert.equal(result.ok, true)
  assert.equal(result.config.tools.nmap, '/mock/nmap')
  assert.deepEqual(result.config.scanPreferences, {
    mode: 'low-impact', timeoutSeconds: 60, captureDiagnostics: false, maskHistory: true,
    noReverseDns: true, maskAssetResults: true,
  })
  const loaded = dispatch(store, { op: 'platformConfigGet' })
  assert.deepEqual(loaded.config.scanPreferences, result.config.scanPreferences)
})


test('privacy center applies only local display defaults and preserves saved scan preferences', (t) => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = read(path)
    assert.match(src, /savePreferences\(saved, true, \{ \.\.\.savedManagement, mode: 'automatic' \}\)/, path)
    assert.match(src, /Object\.keys\(defaults\)\.every\(\(key\) => current\[key\] === expected\[key\]\)/, path)
    assert.match(src, /自动设置并保存/, path)
  }
  const dir = mkdtempSync(join(tmpdir(), 'redteam-privacy-ui-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = { root: dir }
  const initial = dispatch(store, { op: 'platformConfigSave', config: {
    tools: { nmap: '/mock/nmap' },
    scanPreferences: { mode: 'standard', timeoutSeconds: 300, captureDiagnostics: true, noReverseDns: false }
  } })
  assert.equal(initial.ok, true)
  const saved = initial.config.scanPreferences
  const result = dispatch(store, { op: 'platformConfigSave', config: {
    scanPreferences: { ...saved, maskHistory: true, maskAssetResults: true }
  } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.config.scanPreferences, { ...saved, maskHistory: true, maskAssetResults: true })
  assert.equal(result.config.tools.nmap, '/mock/nmap')
  assert.deepEqual(dispatch(store, { op: 'platformConfigGet' }).config.scanPreferences, result.config.scanPreferences)
})


test('privacy center automatically reads the local network snapshot and distinguishes unknown posture', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = read(path)
    const start = src.indexOf('function NetworkPrivacyCard()')
    const end = src.indexOf('const openGuide = async', start)
    const card = src.slice(start, end)
    assert.match(card, /React\.useEffect\(\(\) => \{/)
    assert.match(card, /api\(\{ op: 'networkPrivacySnapshot' \}\)/)
    assert.match(card, /\}, \[refreshVersion\]\)/)
    assert.match(card, /return \(\) => \{ live = false \}/)
    assert.match(src, /保护状态读取失败；未检查的项目不代表安全/)
    assert.match(src, /智能诊断 · 本机状态/)
  }
})
