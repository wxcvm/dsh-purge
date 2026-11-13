import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { listEnvironments, getEnvironment } from '../lib/redteam/environment-registry.js'
import { inventoryLocalCapabilities, probeLocalCapability, diagnoseLocalEnvironment } from '../lib/redteam/capability-service.js'
import { envAdaptStatus, savePlatformConfig } from '../lib/redteam/platform-config.js'
import { probeInstalledTool } from '../lib/redteam/tool-health.js'
import { dispatch } from '../lib/redteam/store-core.js'

const workspace = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-env-capability-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const fixture = (file) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'fake binary')
  return file
}
const config = (root, tools = {}) => ({
  platform: 'windows', toolkitDir: join(root, 'absent'), binDirs: [], tools,
})

test('P0 registry discovers only the local host; no remote environment is implied', () => {
  const result = listEnvironments({ platform: 'win32', arch: 'x64', checkedAt: '2026-11-11T00:00:00Z' })
  assert.equal(result.ok, true)
  assert.equal(result.environments.length, 1)
  assert.equal(result.environments[0].kind, 'local')
  assert.equal(result.environments[0].os, 'windows')
  assert.equal(result.environments[0].discovery.state, 'discovered')
  assert.equal(getEnvironment('wsl:Kali'), null)
  assert.match(result.note, /environmentDiscover/)
})

test('path inventory is not a version probe, capability check, or task execution', (t) => {
  const root = workspace(t)
  const katana = fixture(join(root, 'tools', 'katana.exe'))
  const items = inventoryLocalCapabilities({
    root, config: config(root, { katana }), env: { PATH: '' },
  })
  assert.equal(items.length, 23)
  assert.equal(items.filter((x) => x.status === 'located').length, 1)
  const found = items.find((x) => x.toolId === 'katana')
  assert.equal(found.path, katana)
  assert.equal(found.status, 'located')
  assert.equal(found.probe, null)
  assert.equal(found.capabilityVerified, false)
  assert.equal(found.executionStatus, 'not-run')
  assert.equal(found.dependencyStatus, 'not-checked')
})

test('explicit version probe never becomes target execution or a dependency guarantee', async (t) => {
  const root = workspace(t)
  const katana = fixture(join(root, 'katana.exe'))
  let calls = 0
  const result = await probeLocalCapability('katana', {
    root, config: config(root, { katana }), env: { PATH: '' },
    execFileFn: (file, args, options, done) => {
      calls++
      assert.equal(file, katana)
      assert.deepEqual(args, ['-version'])
      assert.equal(options.shell, false)
      done(null, 'katana 2.0\n', '')
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'probe_verified')
  assert.equal(result.version, 'katana 2.0')
  assert.equal(result.capabilityVerified, false)
  assert.equal(result.executionStatus, 'not-run')
  assert.equal(result.lastExecution, null)
  const unknown = await probeLocalCapability('../escape', {
    execFileFn: () => { throw new Error('unknown IDs must not run') },
  })
  assert.equal(unknown.status, 'unknown')
  assert.equal(calls, 1)
})

test('diagnosis remains read-only and is available through store dispatch', (t) => {
  const root = workspace(t)
  const summary = diagnoseLocalEnvironment({ root, config: config(root), env: { PATH: '' } })
  assert.equal(summary.summary.total, 23)
  assert.equal(summary.summary.probeVerified, 0)
  assert.equal(summary.summary.capabilityVerified, 0)
  assert.equal(summary.summary.executed, 0)
  const result = dispatch({ root }, { op: 'environmentDiagnose' })
  assert.equal(result.ok, true)
  assert.equal(result.environments[0].id, 'local')
  assert.equal(dispatch({ root }, { op: 'environmentList' }).environments.length, 1)
})

test('legacy chat setup gate stays compatible and is separate from tool capability', (t) => {
  const root = workspace(t)
  savePlatformConfig({ envAdaptSkip: true }, root)
  const legacy = envAdaptStatus(root)
  assert.equal(legacy.ready, true)
  assert.equal(legacy.reason, 'skipped')
  const diagnostic = diagnoseLocalEnvironment({
    root, config: config(root), env: { PATH: '' },
  })
  assert.equal(diagnostic.summary.capabilityVerified, 0)
  assert.equal(diagnostic.summary.executed, 0)
})

test('Nmap version success keeps a separate driver warning without claiming scan capability', async t => {
  const root = workspace(t), executable = fixture(join(root,'nmap.exe'))
  const result = await probeInstalledTool('nmap', {
    root, config:config(root,{nmap:executable}), env:{PATH:''},
    execFileFn:(_file,_args,opts,done)=>{
      assert.equal(opts.shell,false)
      done(null,'Nmap version fixture\n','WARNING: Could not import all necessary Npcap functions')
    },
  })
  assert.equal(result.status,'runnable')
  assert.equal(result.warnings[0].code,'npcap-warning')
  assert.ok(!JSON.stringify(result.warnings).includes('Could not import'))
})


test('Windows wrapper path reports a specific diagnostic without invoking a shell', async t => {
  const root = workspace(t), executable = fixture(join(root,'nmap-rt.ps1'))
  let invoked = false
  const result = await probeInstalledTool('nmap', {
    root, platform:'win32', config:config(root,{nmap:executable}), env:{PATH:''},
    execFileFn:()=>{invoked=true;throw Error('unexpected script invocation')},
  })
  assert.equal(invoked,false)
  assert.equal(result.status,'failed')
  assert.equal(result.diagnostic,'windows-wrapper')
  assert.match(result.error,/包装脚本/)
})
