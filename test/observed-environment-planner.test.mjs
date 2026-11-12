import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rememberEnvironmentDiscovery, rememberEnvironmentProbe, planObservedEnvironmentTask,
} from '../lib/redteam/environment-planner.js'

test('cross-environment ranking requires real probe observations and never labels target execution', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-observed-planner-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const binary = join(root, 'nmap.exe')
  writeFileSync(binary, 'test binary')
  const config = {
    platform: 'windows', tools: { nmap: binary }, binDirs: [],
    toolkitDir: join(root, 'missing'),
    planning: { preferredToolByTask: { services: 'nmap' } },
  }
  const options = { root, config, env: { PATH: '' }, preferredEnvironmentId: 'wsl:Kali' }
  rememberEnvironmentDiscovery(root, {
    checkedAt: '2026-11-11T01:00:00Z',
    environments: [
      { id: 'local', kind: 'local', label: 'Windows 本机' },
      { id: 'wsl:Kali', kind: 'wsl', label: 'WSL · Kali' },
    ],
  })
  const before = planObservedEnvironmentTask('services', options)
  assert.equal(before.ok, true)
  assert.equal(before.environmentDiscoveryAt, '2026-11-11T01:00:00Z')
  assert.equal(before.selected.environmentId, 'local')
  assert.equal(before.selected.status, 'located')
  assert.equal(before.candidates.find(x => x.environmentId === 'wsl:Kali' && x.toolId === 'nmap').status, 'unknown')
  assert.equal(before.selected.capabilityVerified, false)
  assert.equal(before.selected.executionStatus, 'not-run')

  rememberEnvironmentProbe(root, {
    toolId: 'nmap', environmentId: 'wsl:Kali',
    status: 'probe_verified', version: 'Nmap 7.99',
    probe: { checkedAt: '2026-11-11T01:01:00Z' },
  })
  const after = planObservedEnvironmentTask('services', options)
  assert.equal(after.selected.environmentId, 'wsl:Kali')
  assert.equal(after.selected.version, 'Nmap 7.99')
  assert.ok(after.selected.reasons.includes('用户显式版本探针已成功'))
  assert.ok(after.selected.reasons.includes('用户选择的环境'))
  assert.equal(after.selected.capabilityVerified, false)
  assert.equal(after.selected.executionStatus, 'not-run')
  assert.equal(after.selected.dependencyStatus, 'not-checked')

  rememberEnvironmentProbe(root, {
    toolId: 'nmap', environmentId: 'wsl:Kali', status: 'degraded',
    probe: { checkedAt: '2026-11-11T01:02:00Z', error: 'probe failed' },
  })
  const failure = planObservedEnvironmentTask('services', options)
  assert.equal(failure.selected.environmentId, 'local')
  assert.equal(failure.candidates.find(x => x.environmentId === 'wsl:Kali' && x.toolId === 'nmap').status, 'degraded')
})

test('unlisted environments cannot forge a verified candidate and missing discovery uses local only', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-not-discovered-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  rememberEnvironmentProbe(root, {
    toolId: 'nmap', environmentId: 'docker:' + 'a'.repeat(64),
    status: 'probe_verified', version: 'fake',
  })
  const plan = planObservedEnvironmentTask('services', {
    root, env: { PATH: '' }, config: { platform: 'windows', tools: {}, binDirs: [], toolkitDir: root },
    preferredEnvironmentId: 'docker:' + 'a'.repeat(64),
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.environmentDiscoveryAt, null)
  assert.equal(plan.preferredEnvironmentId, null)
  assert.equal(plan.selected, null)
  assert.ok(plan.candidates.every(c => c.environmentId === 'local'))
  assert.ok(plan.candidates.every(c => c.capabilityVerified === false && c.executionStatus === 'not-run'))
  assert.equal(planObservedEnvironmentTask('not-a-task', { root }).ok, false)
})

test('registered agent and management bridge expose observed planner as an opt-in operation', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /op === 'environmentTaskPlan'/)
  assert.match(host, /rememberEnvironmentProbe/)
  const agent = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  assert.match(agent, /include_environments/)
  assert.match(agent, /planObservedEnvironmentTask/)
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const frontend = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(frontend, /跨环境候选 · 仅使用已观测结果/)
    assert.match(frontend, /op: 'environmentTaskPlan'/)
  }
})
