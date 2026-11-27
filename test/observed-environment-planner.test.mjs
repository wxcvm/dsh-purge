import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rememberEnvironmentDiscovery, rememberEnvironmentProbe, planObservedEnvironmentTask, agentEnvironmentPlan,
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

test('fresh discovery invalidates previous remote probes and changed local paths invalidate local probes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-env-evidence-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const oldPath = join(root, 'old-nmap.exe')
  const newPath = join(root, 'new-nmap.exe')
  writeFileSync(oldPath, 'old')
  writeFileSync(newPath, 'new')
  const config = { platform: 'windows', tools: { nmap: oldPath }, binDirs: [], toolkitDir: join(root, 'missing') }
  const options = { root, config, env: { PATH: '' } }
  const snapshot = { environments: [
    { id: 'local', kind: 'local' }, { id: 'wsl:Kali', kind: 'wsl' },
  ] }
  rememberEnvironmentDiscovery(root, snapshot)
  rememberEnvironmentProbe(root, { toolId: 'nmap', environmentId: 'local', path: oldPath, status: 'probe_verified' })
  rememberEnvironmentProbe(root, { toolId: 'nmap', environmentId: 'wsl:Kali', status: 'probe_verified' })
  const candidate = (plan, id) => plan.candidates.find(c => c.toolId === 'nmap' && c.environmentId === id)
  assert.equal(candidate(planObservedEnvironmentTask('services', options), 'local').status, 'probe_verified')
  config.tools.nmap = newPath
  assert.equal(candidate(planObservedEnvironmentTask('services', options), 'local').status, 'located')
  rmSync(newPath)
  assert.equal(candidate(planObservedEnvironmentTask('services', options), 'local').status, 'missing')
  rememberEnvironmentDiscovery(root, snapshot)
  assert.equal(candidate(planObservedEnvironmentTask('services', options), 'wsl:Kali').status, 'unknown')
})

test('changed saved SSH endpoint cannot reuse old discovered host or probe', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-env-ssh-evidence-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const config = { platform: 'windows', tools: {}, binDirs: [], toolkitDir: root,
    kaliVm: { host: '192.0.2.1', port: 22, user: 'kali' } }
  const options = { root, config, env: { PATH: '' } }
  rememberEnvironmentDiscovery(root, { environments: [{ id: 'local', kind: 'local' },
    { id: 'ssh:kali-vm', kind: 'ssh', host: '192.0.2.1', port: 22, user: 'kali' }] })
  rememberEnvironmentProbe(root, { toolId: 'nmap', environmentId: 'ssh:kali-vm', status: 'probe_verified' })
  assert.equal(planObservedEnvironmentTask('services', options).selected.environmentId, 'ssh:kali-vm')
  config.kaliVm.host = '192.0.2.2'
  assert.equal(planObservedEnvironmentTask('services', options).selected, null)
  assert.ok(planObservedEnvironmentTask('services', options).candidates.every(c => c.environmentId === 'local'))
})

test('agent records path-only local verification as located rather than degraded', () => {
  const agent = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  assert.match(agent, /result\.verification\.status === 'path-only' \? 'located'/)
  assert.match(agent, /result\.verification\.status === 'missing' \? 'missing'/)
})

test('agent fallback is lazy, verified-only and respects explicit local-only mode', () => {
  const local = { ok: true, selected: { id: 'nmap' }, status: 'located' }
  const missing = { ok: true, selected: null, status: 'missing' }
  const failed = { ...local, status: 'verification-failed' }
  const remote = { environmentId: 'wsl:Kali', toolId: 'nmap', status: 'probe_verified' }
  const unknown = { environmentId: 'ssh:kali-vm', toolId: 'nmap', status: 'unknown' }
  const candidates = [{ environmentId: 'local', toolId: 'nmap', status: 'located' }, unknown, remote]
  let calls = 0
  const get = () => { calls++; return { ok: true, candidates, selected: candidates[0] } }
  assert.equal(agentEnvironmentPlan(local, undefined, get), null)
  assert.equal(agentEnvironmentPlan(missing, false, get), null)
  assert.equal(agentEnvironmentPlan({ ok: false }, undefined, get), null)
  assert.equal(calls, 0)
  const fallback = agentEnvironmentPlan(missing, undefined, get)
  assert.deepEqual(fallback.candidates, [remote])
  assert.equal(fallback.selected, remote)
  assert.equal(fallback.totalCandidates, 3)
  assert.equal(agentEnvironmentPlan(failed, undefined, get).selected, remote)
  assert.equal(agentEnvironmentPlan(missing, undefined, () => ({ ok: true, candidates: [unknown] })), null)
  assert.equal(agentEnvironmentPlan(missing, true, get).candidates.length, 3)
  assert.equal(agentEnvironmentPlan(local, true, () => ({ ok: true, candidates: Array(15).fill(remote) })).candidates.length, 12)
})
