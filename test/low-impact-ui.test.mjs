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
    assert.match(card, /\}, \[refreshVersion, watch\]\)/)
    assert.match(card, /document\.removeEventListener\('visibilitychange', onVisibility\)/)
    assert.match(card, /if \(!live \|\| inFlight \|\| document\.hidden\) return/)
    assert.match(card, /setTimeout\(\(\) => \{ timer = null; read\(\) \}, 30000\)/)
    assert.match(card, /if \(timer !== null\) clearTimeout\(timer\)/)
    assert.match(card, /!document\.hidden && \(watch \|\| !lastSnapshot\.current\)/)
    assert.match(src, /props\.visible !== false \? h\(NetworkPrivacyCard\) : null/)
    assert.match(src, /visible: full \|\| embedded \|\| st\.open/)
    assert.match(src, /保护状态读取失败；未检查的项目不代表安全/)
    assert.match(src, /智能诊断 · 本机状态/)
  }
})


test('privacy center previews presets, discards draft and displays stored changes', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = read(path)
    assert.match(src, /previewPrivacyPreset\('recommended'\)/)
    assert.match(src, /previewPrivacyPreset\('sharing'\)/)
    assert.match(src, /previewPrivacyPreset\('default'\)/)
    assert.match(src, /onClick: discardPrivacyDraft/)
    assert.match(src, /最近五次配置变更/)
  }
})


test('ARTEX privacy presentation masks report and paths, with explicit temporary reveal', () => {
  const source = read('lib/redteam/client.js')
  const start = source.indexOf('    function summarizeArtexReviewProgress(')
  const end = source.indexOf('    /* ---------------------------------------------------------- 常驻面板主体', start)
  assert.ok(start >= 0 && end > start)
  const render = (mask, reveal = false) => {
    let i = 0
    const React = { useState: value => {
      const at = i++
      return [at === 0 ? { maskAssetResults: mask } : at === 1 ? reveal : at === 3 ? {
        state: 'detected', online: true, tools: [{ id: 'nmap', path: 'private-tool-path', reused: true }],
        toolRoots: ['private-root'], skillDir: 'private-skill'
      } : value, () => {}]
    }, useEffect() {} }
    const h = (type, props, ...children) => ({ type, props, children })
    const report = { unique_findings: 1, duplicates_skipped: 0, items: [{ finding_id: 1,
      asset_ids: [], summary: 'private-report', severity: 'info' }], review_queue: [] }
    const node = new Function('React', 'h', 'props', source.slice(start, end) + '\nreturn ArtexTab(props)')(React, h, { report })
    const values = []
    const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') walk(x.children); else if (typeof x === 'string') values.push(x) }
    walk(node)
    return values.join('\n')
  }
  const masked = render(true)
  assert.match(masked, /路径已隐藏/)
  assert.match(masked, /报告已读取/)
  for (const secret of ['private-tool-path', 'private-root', 'private-skill', 'private-report']) {
    assert.equal(masked.includes(secret), false)
    assert.equal(render(false).includes(secret), true)
    assert.equal(render(true, true).includes(secret), true)
  }
})


test('five privacy preset previews preserve locks and unrelated preferences', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = read(path)
    const start = src.indexOf('    function privacyPresetPreview(')
    const end = src.indexOf('    function LowImpactTab(', start)
    assert.ok(start >= 0 && end > start, path)
    const preview = new Function(src.slice(start, end) + '\nreturn privacyPresetPreview')()
    const preferences = { mode: 'standard', timeoutSeconds: 300, captureDiagnostics: true, noReverseDns: false, maskHistory: false, maskAssetResults: true }
    const management = { mode: 'manual', locked: ['maskHistory'] }
    for (const preset of ['recommended', 'sharing', 'default', 'low-impact', 'custom']) {
      const result = preview(preferences, management, preset)
      assert.deepEqual(result.policy.locked, ['maskHistory'], preset)
      assert.equal(result.preferences.maskHistory, false, preset)
      assert.equal(result.preferences.timeoutSeconds, 300, preset)
      assert.equal(result.preferences.captureDiagnostics, true, preset)
      assert.equal(result.preferences.noReverseDns, false, preset)
      assert.equal(result.preferences.mode, preset === 'low-impact' ? 'low-impact' : 'standard', preset)
      assert.equal(result.preferences.maskAssetResults, preset !== 'default', preset)
      assert.equal(result.policy.mode, preset === 'recommended' ? 'automatic' : 'manual', preset)
    }
    assert.deepEqual(preferences, { mode: 'standard', timeoutSeconds: 300, captureDiagnostics: true, noReverseDns: false, maskHistory: false, maskAssetResults: true })
    assert.deepEqual(management, { mode: 'manual', locked: ['maskHistory'] })
  }
})


test('task recommendations distinguish observed posture and preserve locks without mutating preferences', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const src = read(path)
    const start = src.indexOf('    function privacyTaskRecommendation(')
    const end = src.indexOf('    function LowImpactTab(', start)
    assert.ok(start >= 0 && end > start, path)
    const recommend = new Function(src.slice(start, end) + '\nreturn privacyTaskRecommendation')()
    const prefs = { mode: 'standard', timeoutSeconds: 300, captureDiagnostics: true, noReverseDns: false, maskHistory: false, maskAssetResults: false }
    const policy = { mode: 'manual', locked: ['maskHistory'] }
    const local = recommend(prefs, policy, 'local', null, 'unavailable')
    assert.equal(local.preset, 'recommended')
    assert.deepEqual(local.changes, ['maskAssetResults'])
    assert.equal(local.preview.policy.mode, 'automatic')
    assert.equal(local.preview.preferences.maskHistory, false)
    assert.match(local.reasons.join(' '), /尚未确认/)
    const sharing = recommend(prefs, policy, 'sharing', { bridge: { listenerScope: 'all_interfaces' }, vault: { enabled: false }, storageAudit: { available: true } }, 'observed')
    assert.equal(sharing.preset, 'sharing')
    assert.equal(sharing.preview.policy.mode, 'manual')
    assert.match(sharing.reasons.join(' '), /非回环绑定/)
    assert.match(sharing.reasons.join(' '), /未配置凭据加密密钥/)
    assert.match(sharing.reasons.join(' '), /未由推荐功能自动检查/)
    const remote = recommend(prefs, policy, 'remote-model', { bridge: { listenerScope: 'loopback_bound' } }, 'observed')
    assert.match(remote.reasons.join(' '), /请求内容不受展示遮蔽影响/)
    assert.match(remote.reasons.join(' '), /不能据此判断/)
    for (const item of [local, sharing, remote]) {
      assert.deepEqual(item.preview.policy.locked, ['maskHistory'])
      assert.equal(item.preview.preferences.mode, 'standard')
      assert.equal(item.preview.preferences.timeoutSeconds, 300)
      assert.equal(item.preview.preferences.captureDiagnostics, true)
      assert.equal(item.preview.preferences.noReverseDns, false)
    }
    assert.equal(prefs.maskAssetResults, false)
    assert.deepEqual(policy, { mode: 'manual', locked: ['maskHistory'] })
    assert.match(src, /预览推荐设置/)
  }
})


test('workspace privacy summary reports saved display flags without implying network protection', () => {
  for (const path of ['lib/workspace/client-shell.js', 'client.js']) {
    const src = read(path)
    const start = src.indexOf('function workspacePrivacySummary(')
    const end = src.indexOf('function PurgeWorkspacePage(', start)
    assert.ok(start >= 0 && end > start, path)
    const summarize = new Function(src.slice(start, end) + '\nreturn workspacePrivacySummary')()
    assert.equal(summarize(null).label, '隐私 · 未知')
    assert.equal(summarize({ ok: false }).label, '隐私 · 未知')
    assert.equal(summarize({ ok: true, maskHistory: true }).label, '隐私 · 未知')
    assert.equal(summarize({ ok: true, maskHistory: false, maskAssetResults: false }).label, '隐私 · 0/2')
    assert.equal(summarize({ ok: true, maskHistory: false, maskAssetResults: true }).label, '隐私 · 1/2')
    const all = summarize({ ok: true, maskHistory: true, maskAssetResults: true })
    assert.equal(all.label, '隐私 · 2/2')
    assert.match(all.detail, /仅本地展示/)
    assert.match(all.detail, /不代表网络/)
    assert.match(src, /addEventListener\("dsh-purge-privacy-saved", refresh\)/)
    assert.match(src, /removeEventListener\("dsh-purge-privacy-saved", refresh\)/)
    assert.match(src, /current === revision/)
    assert.match(src, /op: "privacyDisplayStatus"/)
    assert.match(src, /tab: "low-impact", focus: null/)
  }
  assert.match(read('lib/redteam/client.js'), /document\.dispatchEvent\(new Event\('dsh-purge-privacy-saved'\)\)/)
})
