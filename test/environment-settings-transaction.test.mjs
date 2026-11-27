import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPlatformConfig, savePlatformConfig } from '../lib/redteam/platform-config.js'
import { handlePlatformSettingsOp } from '../lib/redteam/platform-settings.js'
import { diagnoseEnvironmentTopology, observeEnvironmentConfig } from '../lib/redteam/environment-diagnostics.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-settings-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const get = root => handlePlatformSettingsOp(root, { op: 'platformConfigGet' })
const save = (root, config, expectedRevision) =>
  handlePlatformSettingsOp(root, { op: 'platformConfigSave', config, expectedRevision })
const check = (root, expectedRevision) => handlePlatformSettingsOp(root, { op: 'platformConfigCheck', expectedRevision })

test('saved receipt, path check and a fresh process read one credential-free revision', t => {
  const root = fixture(t)
  const toolkit = join(root, 'toolkit')
  mkdirSync(toolkit)
  const missing = get(root)
  assert.equal(missing.ok, true)
  assert.equal(missing.config.exists, false)
  assert.equal(missing.configRevision, 'missing')
  assert.equal(check(root, 'missing').configExists, false)

  const nonexistent = join(root, 'unavailable')
  const secret = 'FIXTURE_SECRET_DO_NOT_RETURN'
  const saved = save(root, {
    toolkitDir: ' ' + toolkit + ' ', notes: 'fixture note',
    binDirs: [toolkit, ' ', nonexistent], env: { FOFA_KEY: secret },
  }, missing.configRevision)
  assert.equal(saved.ok, true)
  assert.notEqual(saved.configRevision, missing.configRevision)
  assert.equal(saved.config.toolkitDir, toolkit)
  assert.equal(saved.config.fofaKeyConfigured, true)
  assert.equal(JSON.stringify(saved).includes(secret), false)
  assert.deepEqual(get(root).config, saved.config)
  const observed = check(root, saved.configRevision)
  assert.equal(observed.ok, true)
  assert.equal(observed.configExists, true)
  assert.equal(observed.environmentId, 'local')
  assert.equal(observed.configRevision, saved.configRevision)
  assert.equal(observed.toolkitDirectoryOk, true)
  assert.deepEqual(observed.missingBinDirs, [nonexistent])
  assert.ok(Number.isFinite(Date.parse(observed.checkedAt)))
  assert.equal(JSON.stringify(observed).includes(secret), false)

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { handlePlatformSettingsOp } from ${JSON.stringify(new URL('../lib/redteam/platform-settings.js', import.meta.url).href)};
    console.log(JSON.stringify(handlePlatformSettingsOp(process.argv[1], {op:'platformConfigGet'})))
  `, root], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout).config, saved.config)
})

test('stale windows and directory assignment cannot overwrite a newer patch', t => {
  const root = fixture(t)
  const other = fixture(t)
  const initial = save(root, {
    notes: 'original', env: { FOFA_KEY: 'fixture', ARTEX_HOME: 'unchanged' },
    intelSurveyPreferences: { pageSize: 20 }, scanPreferences: { maskHistory: true },
  })
  const secondView = get(root)
  const next = save(root, { notes: 'window A' }, initial.configRevision)
  const stale = save(root, { notes: 'stale', env: { FOFA_KEY: '' } }, secondView.configRevision)
  assert.deepEqual([stale.ok, stale.code, stale.configRevision], [false, 'config_conflict', next.configRevision])
  const dir = join(root, 'inventory')
  mkdirSync(dir)
  const assign = expectedRevision => handlePlatformSettingsOp(root, { op: 'platformAssignToolkit', dir, expectedRevision })
  assert.equal(assign(initial.configRevision).code, 'config_conflict')
  const accepted = assign(next.configRevision)
  assert.equal(accepted.ok, true)
  assert.equal(accepted.runtime.nodePlatform, process.platform)
  assert.equal(get(root).config.configRevision, accepted.configRevision)
  const clear = save(root, { env: { FOFA_KEY: '' } }, accepted.configRevision)
  assert.equal(clear.ok, true)
  const out = loadPlatformConfig(root)
  assert.equal(out.notes, 'window A')
  assert.equal(out.env.ARTEX_HOME, 'unchanged')
  assert.equal(out.env.FOFA_KEY, '')
  assert.equal(out.scanPreferences.maskHistory, initial.config.scanPreferences.maskHistory)
  assert.deepEqual(out.intelSurveyPreferences, initial.config.intelSurveyPreferences)
  assert.equal(get(other).configRevision, 'missing')
})

test('legacy config is not migrated on read, and malformed bytes are not replaced', t => {
  const root = fixture(t)
  const file = join(root, 'config.json')
  const legacy = '{ "version": 1, "notes": "legacy", "env": {"FOFA_KEY":"fake-legacy"} }'
  writeFileSync(file, legacy)
  const readback = get(root)
  assert.match(readback.configRevision, /^legacy:/)
  assert.equal(readFileSync(file, 'utf8'), legacy)
  assert.equal(check(root, readback.configRevision).ok, true)
  const migratedOnWrite = save(root, { notes: 'changed' }, readback.configRevision)
  assert.equal(migratedOnWrite.ok, true)
  assert.equal(loadPlatformConfig(root).env.FOFA_KEY, 'fake-legacy')

  const broken = '{error fake-do-not-return'
  writeFileSync(file, broken)
  for (const result of [get(root), check(root), save(root, { notes: 'not written' })]) {
    assert.equal(result.ok, false)
    assert.equal(result.code, 'config_unavailable')
    assert.equal(JSON.stringify(result).includes('fake-do-not-return'), false)
  }
  assert.equal(readFileSync(file, 'utf8'), broken)
})

test('delayed discovery stays on the captured configuration and cannot publish after a save', async t => {
  const root = fixture(t)
  const original = savePlatformConfig({ notes: 'original' }, root)
  let release, enter
  const deferred = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { enter = resolve })
  let publishCount = 0
  const pending = observeEnvironmentConfig(root, original.configRevision, async scope => {
    enter(scope.config.notes)
    await deferred
    assert.equal(scope.config.notes, 'original')
    return { ok: true, evidence: 'old' }
  }, () => { publishCount++ })
  assert.equal(await started, 'original')
  const updated = savePlatformConfig({ notes: 'after save' }, root)
  release()
  const stale = await pending
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'config_conflict')
  assert.equal(stale.configRevision, updated.configRevision)
  assert.equal(stale.evidence, undefined)
  assert.equal(publishCount, 0)
  const next = await observeEnvironmentConfig(root, updated.configRevision, async scope => ({
    ok: true, notes: scope.config.notes,
  }), () => { publishCount++ })
  assert.equal(next.notes, 'after save')
  assert.equal(next.configRevision, updated.configRevision)
  assert.equal(publishCount, 1)
})

test('topology path inventory and provider registration use the supplied snapshot', async t => {
  const root = fixture(t)
  const customPath = join(root, 'fixture-path.bin')
  writeFileSync(customPath, 'not an executable; never invoked')
  const original = savePlatformConfig({
    tools: { nmap: customPath }, kaliVm: { host: 'fixture.invalid', user: 'kali', port: 22 },
  }, root)
  savePlatformConfig({ tools: { nmap: '' }, kaliVm: { host: '' } }, root)
  const result = await diagnoseEnvironmentTopology({
    root, config: original, platform: 'linux', env: { PATH: '' },
    dockerExecFileFn: (_command, _args, _options, done) => done(null, '', ''),
  })
  assert.equal(result.ok, true)
  assert.equal(result.providers.ssh.state, 'configured')
  assert.equal(result.localDiagnostics.capabilities.find(item => item.toolId === 'nmap').path, customPath)
  assert.equal(result.topology.taskExecutionState, 'not-checked')
})
