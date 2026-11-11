import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverArtexLocalProvider } from '../lib/redteam/adapters/artex-local.js'
import { discoverEnvironments } from '../lib/redteam/environment-registry.js'
import { inventoryLocalCapabilities } from '../lib/redteam/capability-service.js'

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-artex-provider-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('ARTEX local binary provider discovers files but never claims remote execution', (t) => {
  const root = workspace(t)
  const toolDir = join(root, 'tools')
  mkdirSync(join(toolDir, 'nuclei', 'current'), { recursive: true })
  const binary = join(toolDir, 'nuclei', 'current', 'nuclei.exe')
  writeFileSync(binary, 'fixture program')
  const env = { ARTEX_TOOL_DIRS: toolDir, PATH: '' }
  const provider = discoverArtexLocalProvider({ env, platform: 'win32', checkedAt: '2026-11-11T01:00:00Z' })
  assert.equal(provider.id, 'artex:local')
  assert.equal(provider.kind, 'binary-source')
  assert.equal(provider.executionEnvironmentId, 'local')
  assert.equal(provider.state, 'located')
  assert.equal(provider.online, null, 'binary discovery does not prove ARTEX service is running')
  assert.equal(provider.checkedAt, '2026-11-11T01:00:00Z')
  assert.equal(provider.toolCount, 1)
  assert.equal(provider.tools[0].path, binary)
  assert.equal(provider.tools[0].source, 'artex')
  assert.equal(provider.tools[0].capabilityVerified, false)
  assert.equal(provider.tools[0].executionStatus, 'not-run')
  const capabilities = inventoryLocalCapabilities({
    root, env,
    config: { platform: 'windows', tools: {}, binDirs: [], toolkitDir: join(root, 'absent') },
  })
  const nuclei = capabilities.find((item) => item.toolId === 'nuclei')
  assert.equal(nuclei.source, 'artex')
  assert.equal(nuclei.sourceProviderId, 'artex:local')
  assert.equal(nuclei.status, 'located')
  assert.equal(nuclei.executionStatus, 'not-run')
})

test('ARTEX absent provider is distinct from missing Docker/WSL and does not execute a CLI', async () => {
  const env = { ARTEX_TOOL_DIRS: join(tmpdir(), 'nonexistent-artex-provider') }
  const provider = discoverArtexLocalProvider({ env, platform: 'win32' })
  assert.equal(provider.state, 'absent')
  assert.equal(provider.toolCount, 0)
  const inventory = await discoverEnvironments({
    env, platform: 'linux',
    dockerExecFileFn: (_cmd, _args, _opts, done) => done(null, '', ''),
    execFileFn: () => { throw Error('WSL should not run on Linux') },
  })
  assert.equal(inventory.providers.artex.id, 'artex:local')
  assert.equal(inventory.providers.artex.state, 'absent')
  assert.equal(inventory.environments.length, 1)
  assert.equal(inventory.providers.docker.state, 'empty')
})

test('actual ARTEX provider UI stays in source and runtime bundle', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /ARTEX · 本机工具来源/)
    assert.match(source, /environmentSnapshot\.providers\.artex\.state/)
  }
})
