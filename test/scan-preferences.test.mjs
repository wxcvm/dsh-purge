import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configPathOf, loadPlatformConfig, savePlatformConfig, normalizeScanPreferences, privacyDisplayStatus } from '../lib/redteam/platform-config.js'

test('scan preferences persist independently without replacing existing tool paths', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-scan-options-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(normalizeScanPreferences(), {
    mode: 'standard', timeoutSeconds: 180, captureDiagnostics: true, maskHistory: false,
    noReverseDns: false, maskAssetResults: false,
  })
  savePlatformConfig({ tools: { nmap: '/mock/nmap' }, env: { FOFA_KEY: 'fixture' } }, dir)
  const saved = savePlatformConfig({ scanPreferences: {
    mode: 'low-impact', timeoutSeconds: 60, captureDiagnostics: false, maskHistory: true,
    noReverseDns: true, maskAssetResults: true,
  } }, dir)
  assert.deepEqual(saved.scanPreferences, {
    mode: 'low-impact', timeoutSeconds: 60, captureDiagnostics: false, maskHistory: true,
    noReverseDns: true, maskAssetResults: true,
  })
  assert.equal(loadPlatformConfig(dir).tools.nmap, '/mock/nmap')
  assert.equal(loadPlatformConfig(dir).env.FOFA_KEY, 'fixture')
  const reset = savePlatformConfig({ scanPreferences: { timeoutSeconds: -42, mode: 'unlisted' } }, dir)
  assert.equal(reset.scanPreferences.timeoutSeconds, 180)
  assert.equal(reset.scanPreferences.mode, 'standard')
  assert.equal(reset.scanPreferences.maskHistory, true)
  assert.equal(reset.scanPreferences.noReverseDns, true)
  assert.equal(reset.scanPreferences.maskAssetResults, true)
})


test('persistent automatic privacy management respects manual locks and old clients', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-privacy-policy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(loadPlatformConfig(dir).privacyManagement, { mode: 'manual', locked: [] })
  savePlatformConfig({ tools: { nmap: '/mock/nmap' }, scanPreferences: { timeoutSeconds: 300 } }, dir)
  let saved = savePlatformConfig({ privacyManagement: { mode: 'automatic', locked: [] } }, dir)
  assert.equal(saved.scanPreferences.maskHistory, true)
  assert.equal(saved.scanPreferences.maskAssetResults, true)
  assert.equal(saved.scanPreferences.timeoutSeconds, 300)
  saved = savePlatformConfig({ scanPreferences: { maskHistory: false } }, dir)
  assert.deepEqual(saved.privacyManagement.locked, ['maskHistory'])
  assert.equal(saved.scanPreferences.maskHistory, false)
  assert.equal(saved.scanPreferences.maskAssetResults, true)
  saved = savePlatformConfig({ privacyManagement: { mode: 'automatic', locked: [] } }, dir)
  assert.equal(saved.scanPreferences.maskHistory, true)
  saved = savePlatformConfig({ privacyManagement: { mode: 'manual', locked: [] }, scanPreferences: { maskAssetResults: false } }, dir)
  assert.equal(saved.scanPreferences.maskAssetResults, false)
  assert.equal(saved.tools.nmap, '/mock/nmap')
  assert.deepEqual(loadPlatformConfig(dir).privacyManagement, { mode: 'manual', locked: [] })
  assert.equal(loadPlatformConfig(dir).scanPreferences.timeoutSeconds, 300)
})


test('privacy change history is bounded, records actual changes and excludes unrelated config', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-privacy-changes-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(loadPlatformConfig(dir).privacyChanges, [])
  let saved = savePlatformConfig({ env: { FOFA_KEY: 'fixture-secret' } }, dir)
  assert.deepEqual(saved.privacyChanges, [])
  saved = savePlatformConfig({ privacyManagement: { mode: 'automatic', locked: [] } }, dir)
  assert.deepEqual(saved.privacyChanges[0].keys, ['mode', 'scan.maskHistory', 'scan.maskAssetResults'])
  const before = saved.privacyChanges
  saved = savePlatformConfig({ privacyManagement: { mode: 'automatic', locked: [] } }, dir)
  assert.deepEqual(saved.privacyChanges, before)
  for (let i = 0; i < 7; i++) saved = savePlatformConfig({ scanPreferences: { timeoutSeconds: i % 2 ? 60 : 120 } }, dir)
  assert.equal(saved.privacyChanges.length, 5)
  assert.ok(saved.privacyChanges.every(item => item.keys.length === 1 && item.keys[0] === 'scan.timeoutSeconds'))
  assert.deepEqual(loadPlatformConfig(dir).privacyChanges, saved.privacyChanges)
  assert.equal(JSON.stringify(saved.privacyChanges).includes('fixture-secret'), false)
})


test('shared display status exposes effective flags only', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-shared-privacy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(privacyDisplayStatus(dir), { ok: true, mode: 'manual', maskHistory: false, maskAssetResults: false })
  savePlatformConfig({ env: { FOFA_KEY: 'fixture-secret' }, privacyManagement: { mode: 'automatic', locked: ['maskHistory'] } }, dir)
  assert.deepEqual(privacyDisplayStatus(dir), { ok: true, mode: 'automatic', maskHistory: false, maskAssetResults: true })
})

test('invalid existing platform config stays intact and its diagnostics do not expose input', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-invalid-platform-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = configPathOf(dir)
  const marker = 'fixture-secret-not-for-diagnostics'
  for (const raw of [marker, '[]', 'null', '42', '"' + marker + '"']) {
    const original = Buffer.from(raw)
    writeFileSync(file, original)
    const loaded = loadPlatformConfig(dir)
    assert.equal(loaded.exists, true)
    assert.ok(loaded.error)
    assert.equal(loaded.error.includes(marker), false)
    assert.deepEqual(privacyDisplayStatus(dir), { ok: false, error: 'privacy_config_unavailable' })
    assert.throws(() => savePlatformConfig({ notes: 'fixture edit' }, dir), value => /未写入/.test(value.message) && !value.message.includes(marker))
    assert.deepEqual(readFileSync(file), original)
    assert.equal(readdirSync(dir).length, 1)
  }
})
