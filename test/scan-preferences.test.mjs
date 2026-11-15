import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPlatformConfig, savePlatformConfig, normalizeScanPreferences } from '../lib/redteam/platform-config.js'

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
