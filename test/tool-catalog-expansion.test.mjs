import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { TOOL_CATALOG, resolveTool } from '../lib/redteam/platform-config.js'
import { probeInstalledTool } from '../lib/redteam/tool-health.js'
import { planTaskTools } from '../lib/redteam/task-tool-plan.js'
import { probeDockerTool } from '../lib/redteam/adapters/docker.js'

const names = ['feroxbuster', 'testssl', 'smbclient', 'gowitness', 'netexec', 'amass']
const flags = {
  feroxbuster: '--version', testssl: '--version', smbclient: '--version',
  gowitness: 'version', netexec: '--version', amass: '-version',
}
const containerId = 'd'.repeat(64)

test('expanded catalog resolves all six tools and retains dependency notes without claiming readiness', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-expanded-catalog-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const paths = {}
  for (const id of names) {
    const def = TOOL_CATALOG.find(x => x.id === id)
    assert.ok(def, id)
    assert.equal(def.probeArgs.length, 1)
    assert.equal(def.probeArgs[0], flags[id])
    assert.ok(def.dependencyNotes, 'missing dependency note for ' + id)
    const file = join(root, 'tools', def.names[0])
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'fixture executable')
    paths[id] = file
  }
  const cfg = { platform: 'windows', toolkitDir: join(root, 'missing'), binDirs: [], tools: paths }
  for (const id of names) {
    const found = resolveTool(id, { root, config: cfg, env: { PATH: '' } })
    assert.equal(found.path, paths[id])
    assert.equal(found.source, 'config')
  }
  const profiles = Object.fromEntries(
    ['domains', 'web', 'vulns', 'internal', 'identity'].map(task =>
      [task, planTaskTools(task, { root, config: cfg, env: { PATH: '' } })])
  )
  assert.ok(profiles.domains.candidates.some(x => x.id === 'amass'))
  assert.ok(profiles.web.candidates.some(x => x.id === 'feroxbuster'))
  assert.ok(profiles.web.candidates.some(x => x.id === 'gowitness'))
  assert.ok(profiles.vulns.candidates.some(x => x.id === 'testssl'))
  assert.ok(profiles.internal.candidates.some(x => x.id === 'smbclient'))
  assert.ok(profiles.identity.candidates.some(x => x.id === 'netexec'))
  assert.ok(profiles.web.candidates.find(x => x.id === 'gowitness').dependencyNote)
  assert.equal(profiles.vulns.status, 'located')
  assert.equal(profiles.vulns.selected.verification, 'not-run')
})

test('Gowitness version is a fixed safe subcommand in local and Docker adapters', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-gowitness-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const binary = join(root, 'gowitness')
  writeFileSync(binary, 'fixture')
  let calls = 0
  const local = await probeInstalledTool('gowitness', {
    root,
    config: { platform: 'linux', toolkitDir: '', binDirs: [], tools: { gowitness: binary } },
    env: { PATH: '' },
    execFileFn: (cmd, args, opts, done) => {
      calls++
      assert.equal(cmd, binary)
      assert.deepEqual(args, ['version'])
      assert.equal(opts.shell, false)
      done(null, 'gowitness v3.0\n', '')
    },
  })
  assert.equal(calls, 1)
  assert.equal(local.status, 'runnable')

  const docker = await probeDockerTool(containerId, 'gowitness', {
    execFileFn: (cmd, args, opts, done) => {
      calls++
      assert.equal(cmd, 'docker')
      if (args[0] === 'ps') {
        done(null, JSON.stringify({ ID: containerId, State: 'running', Image: 'kali:latest', Names: 'test' }), '')
      } else {
        assert.deepEqual(args, ['exec', containerId, 'gowitness', 'version'])
        done(null, 'gowitness v3.0\n', '')
      }
    },
  })
  assert.equal(calls, 3)
  assert.equal(docker.status, 'probe_verified')
  assert.equal(docker.capabilityVerified, false)
})

test('unknown tool candidates remain only listed, never executable by catalog probing', async () => {
  const unknown = await probeInstalledTool('unlisted-custom', {
    execFileFn: () => { throw Error('must not run unknown tool') },
  })
  assert.equal(unknown.status, 'unknown')
  assert.ok(TOOL_CATALOG.every(x => !('execute' in x)))
})
