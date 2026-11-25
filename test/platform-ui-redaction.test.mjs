import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../lib/redteam/store-core.js'
import { loadPlatformConfig, savePlatformConfig, platformUiProjection } from '../lib/redteam/platform-config.js'

test('browser settings and save receipts never echo stored environment credentials', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-config-projection-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'fixtures')
  mkdirSync(dir)
  const seed = { FOFA_KEY: 'synthetic-old-key', DSH_PURGE_ARTEX_OVERVIEW_TOKEN: 'synthetic-overview-key',
    CUSTOM_OPTION: 'user-owned-option' }
  savePlatformConfig({ env: seed, notes: 'original setting' }, root)
  const rawConfig = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
  rawConfig.env.CENSYS_PAT = 'synthetic-censys-key'
  writeFileSync(join(root, 'config.json'), JSON.stringify(rawConfig))
  const original = loadPlatformConfig(root).env
  for (const [key, value] of Object.entries(seed)) assert.equal(original[key], value)
  const store = { root }

  const verify = (result, configured) => {
    assert.equal(result.ok, true)
    assert.deepEqual(result.config.env, {})
    assert.equal(result.config.fofaKeyConfigured, configured)
    assert.doesNotMatch(JSON.stringify(result), /synthetic-(?:old|overview|new|censys)-key|user-owned-option/)
  }

  verify(dispatch(store, { op: 'platformConfigGet' }), true)
  const unrelated = dispatch(store, { op: 'platformConfigSave', config: { notes: 'edited setting' } })
  verify(unrelated, true)
  assert.equal(unrelated.config.notes, 'edited setting')
  assert.deepEqual(loadPlatformConfig(root).env, original)

  const assigned = dispatch(store, { op: 'platformAssignToolkit', dir })
  verify(assigned, true)
  assert.equal(assigned.config.toolkitDir, dir)
  assert.deepEqual(loadPlatformConfig(root).env, original)

  assert.throws(() => dispatch(store, { op: 'platformConfigSave', config: { env: { CENSYS_PAT: 'synthetic-plain-pat' } } }), /专用加密连接设置/)
  verify(dispatch(store, { op: 'platformConfigSave', config: { env: { FOFA_KEY: 'synthetic-new-key' } } }), true)
  assert.deepEqual(loadPlatformConfig(root).env, { ...original, FOFA_KEY: 'synthetic-new-key' })
  verify(dispatch(store, { op: 'platformConfigSave', config: { env: { FOFA_KEY: '' } } }), false)
  assert.deepEqual(loadPlatformConfig(root).env, { ...original, FOFA_KEY: '' })
})

test('proxy previews keep endpoints but not credentials, query, fragment or malformed raw strings', () => {
  const internal = { ok: true, config: { env: {} }, egress: {
    https_proxy: 'https://fixture-user:fixture-password@host.invalid:1234/path?key=fixture-query#fixture-fragment',
    http_proxy: 'fixture-user:fixture-password@[2001:db8::1]:4567',
    all_proxy: 'malformed[address]with-fixture-password',
    no_proxy: 'localhost,.example.test',
  } }
  const visible = platformUiProjection(internal)
  assert.deepEqual(visible.egress, {
    http_proxy: 'http://[2001:db8::1]:4567',
    https_proxy: 'https://host.invalid:1234',
    all_proxy: '已配置（地址未显示）',
    no_proxy: 'localhost,.example.test',
  })
  assert.doesNotMatch(JSON.stringify(visible), /fixture-(?:user|password|query|fragment)/)
  assert.match(internal.egress.https_proxy, /fixture-password/)
})

test('model-visible preflight does not echo platform env, key path, or FOFA fragments', () => {
  const source = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  assert.equal(source.split('platform: platformUiProjection(plat),').length - 1, 2)
  assert.doesNotMatch(source, /platform: plat,/)
  assert.equal(source.split('vps_status: vpsState.status,').length - 1, 2)
  assert.equal(source.includes("configured(' + vpsKey"), false)
  assert.equal(source.includes('fofaShown'), false)
  const summary = platformUiProjection({
    ok: true,
    config: { env: { FOFA_KEY: 'secret-key', REDTEAM_VPS_KEY: 'private-key-path',
      DSH_PURGE_ARTEX_OVERVIEW_TOKEN: 'secret-token' }, vps: {
      user: 'root', domain: 'node.example', identityFile: '/keys/private',
    } },
  })
  assert.deepEqual(summary.config.env, {})
  assert.doesNotMatch(JSON.stringify(summary), /secret-key|secret-token|private-key-path/)
})

test('native and embedded settings preserve, replace and explicitly clear the write-only key', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /const withProfiles = \(result\) => \(\{ \.\.\.platformUiProjection\(result\)/)
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const begin = source.indexOf('    function envDraftDelta(')
    const end = source.indexOf('    function EnvTab(props)', begin)
    const diff = new Function(source.slice(begin, end) + '\nreturn envDraftDelta')()
    const blank = { env: { FOFA_KEY: null }, notes: '' }
    assert.deepEqual(diff(blank, { ...blank, notes: 'another setting' }), { notes: 'another setting' })
    assert.deepEqual(diff(blank, { ...blank, env: { FOFA_KEY: 'synthetic-replacement' } }),
      { env: { FOFA_KEY: 'synthetic-replacement' } })
    assert.deepEqual(diff(blank, { ...blank, env: { FOFA_KEY: '' } }), { env: { FOFA_KEY: '' } })
    assert.match(source, /env: \{ FOFA_KEY: null \}/)
    assert.match(source, /data\?\.config\?\.fofaKeyConfigured/)
    assert.match(source, /清除已保存密钥（保存时生效）/)
  }
})
