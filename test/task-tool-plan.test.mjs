import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listTaskToolProfiles, planTaskTools, verifyTaskTool, TOOL_USE_CONTRACTS, toolUseContract } from '../lib/redteam/task-tool-plan.js'
import { TOOL_CATALOG } from '../lib/redteam/platform-config.js'

const workspace = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const fileAt = (path) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'fixture'); return path }
const configFor = (root, tools) => ({ platform: 'windows', toolkitDir: join(root, 'none'),
  binDirs: [], tools })

test('profiles contain only declared tool IDs and have stable task labels', () => {
  const profiles = listTaskToolProfiles()
  assert.ok(profiles.length >= 5)
  assert.equal(new Set(profiles.map((p) => p.id)).size, profiles.length)
  assert.ok(profiles.find((p) => p.id === 'web').toolIds.includes('katana'))
})

test('task selection respects task-specific priority instead of rewarding version probes', (t) => {
  const root = workspace(t)
  const fscan = fileAt(join(root, 'fscan.exe'))
  const nmap = fileAt(join(root, 'nmap.exe'))
  const plan = planTaskTools('internal', {
    root, config: configFor(root, { fscan, nmap }), env: { PATH: '' },
  })
  assert.equal(plan.status, 'located')
  assert.equal(plan.selected.id, 'nmap', 'prefer a reviewed adapter over a higher-ranked but unmapped binary')
  assert.equal(plan.candidates.find((item) => item.id === 'fscan').executionPolicy, 'unmapped-manual-review')
  assert.equal(plan.selected.verification, 'not-run')
  assert.equal(plan.selected.canProbe, false)
  assert.ok(plan.candidates.find((c) => c.id === 'nmap').canProbe)
  assert.ok(plan.candidates.find((c) => c.id === 'nmap').detected)
  assert.ok(plan.candidates.every((c) => c.verification === 'not-run'))

  const preferred = planTaskTools('internal', {
    root,
    config: { ...configFor(root, { fscan, nmap }), planning: { preferredToolByTask: { internal: 'nmap' } } },
    env: { PATH: '' },
  })
  assert.equal(preferred.selected.id, 'nmap', 'an explicit user preference must override the profile default')
})

test('unknown tasks and missing binaries do not run anything', async (t) => {
  const root = workspace(t)
  const options = {
    root, config: configFor(root, {}), env: { PATH: '' },
    execFileFn: () => { throw new Error('must not execute') },
  }
  const unknown = await verifyTaskTool('wrong-task', options)
  assert.equal(unknown.ok, false)
  const missing = await verifyTaskTool('web', options)
  assert.equal(missing.status, 'missing')
  assert.equal(missing.verification, null)
  assert.equal(missing.selected, null)
})

test('explicit version verification proves only a local command ran', async (t) => {
  const root = workspace(t)
  const katana = fileAt(join(root, 'katana.exe'))
  let runCount = 0
  const plan = await verifyTaskTool('web', {
    root, config: configFor(root, { katana }), env: { PATH: '' },
    execFileFn: (path, args, options, done) => {
      runCount++
      assert.equal(path, katana)
      assert.deepEqual(args, ['-version'])
      assert.equal(options.shell, false)
      done(null, 'katana 2.0\n', '')
    },
  })
  assert.equal(runCount, 1)
  assert.equal(plan.status, 'version-verified')
  assert.equal(plan.selected.id, 'katana')
  assert.equal(plan.verification.version, 'katana 2.0')
  assert.match(plan.note, /未向任何目标/)
})

test('path-only tools never launch binaries even on verify request', async (t) => {
  const root = workspace(t)
  const impacket = fileAt(join(root, 'secretsdump.py'))
  const plan = await verifyTaskTool('identity', {
    root, config: configFor(root, { impacket }), env: { PATH: '' },
    execFileFn: () => { throw new Error('must not launch') },
  })
  assert.equal(plan.selected.id, 'impacket')
  assert.equal(plan.status, 'path-only')
  assert.equal(plan.verification.status, 'path-only')
})

test('environment API and embedded client expose task-tool choice without target execution', async () => {
  const { readFileSync } = await import('node:fs')
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(host, /platformTaskPlan/)
  assert.match(host, /planTaskTools/)
  for (const text of [source, bundle]) {
    assert.match(text, /按任务选择工具/)
    assert.match(text, /platformTaskPlan/)
    assert.match(text, /验证推荐工具版本/)
  }
})


test('task selection exposes dedicated execution support and keeps custom tools unclassified', (t) => {
  const root = workspace(t)
  const nmap = fileAt(join(root, 'nmap.exe'))
  const naabu = fileAt(join(root, 'naabu.exe'))
  const custom = fileAt(join(root, 'custom', 'dns-audit.exe'))
  const plan = planTaskTools('services', {
    root,
    config: { ...configFor(root, { nmap, naabu }), customTools: [{ name: 'DNS Audit', path: custom }] },
    env: { PATH: '' },
    execFileFn: () => { throw new Error('planning must not execute tools') },
  })
  assert.equal(plan.candidates.find((item) => item.id === 'nmap').executionAdapter, 'redteam_scan_run')
  assert.equal(plan.candidates.find((item) => item.id === 'nmap').executionSupported, true)
  assert.equal(plan.candidates.find((item) => item.id === 'naabu').executionSupported, false)
  assert.equal(plan.candidates.find((item) => item.id === 'naabu').executionMode, 'unmapped-manual-review')
  assert.equal(plan.configuredCustomTools.length, 1)
  assert.equal(plan.configuredCustomTools[0].id, 'custom:0')
  assert.equal(plan.configuredCustomTools[0].taskFit, 'unclassified')
  assert.equal(plan.configuredCustomTools[0].executionSupported, false)
  assert.equal(plan.configuredCustomTools[0].executionStatus, 'not-supported')
  assert.equal(plan.configuredCustomTools[0].executionPolicy, 'unmapped-manual-review')
  assert.equal(plan.configuredCustomTools[0].automaticExecutionAllowed, false)
})


test('every built-in tool has an explicit reviewed contract and existing Skill references', () => {
  const catalogIds = TOOL_CATALOG.map((tool) => tool.id).sort()
  assert.deepEqual(Object.keys(TOOL_USE_CONTRACTS).sort(), catalogIds)
  for (const id of catalogIds) {
    const contract = toolUseContract(id)
    assert.equal(contract.requiresScopeReview, true, id + ' must require scope review')
    assert.equal(contract.automaticExecutionAllowed, false, id + ' must not auto-execute from planning')
    assert.ok(['dedicated-adapter', 'skill-guided-host-tool', 'manual-review-only', 'unmapped-manual-review'].includes(contract.executionPolicy), id)
    for (const skill of contract.skillRequirements) {
      assert.match(skill.key, /^redteam:/)
      assert.equal(skill.loadTool, 'redteam_skill_read')
      assert.equal(skill.status, 'not-read')
      assert.ok(existsSync(new URL('../skills/redteam/' + skill.name + '.md', import.meta.url)), id + ' -> ' + skill.key)
    }
  }
})

test('passive recon tools use a dedicated adapter and require one-off external-query consent', (t) => {
  const root = workspace(t)
  const plan = planTaskTools('domains', {
    root, config: configFor(root, {}), env: { PATH: '' },
  })
  for (const id of ['subfinder', 'dnsx', 'amass']) {
    const candidate = plan.candidates.find(item => item.id === id)
    assert.equal(candidate.executionAdapter, 'redteam_passive_recon', id)
    assert.equal(candidate.executionPolicy, 'dedicated-adapter', id)
    assert.equal(candidate.operatorConfirmationRequired, true, id)
    assert.equal(candidate.automaticExecutionAllowed, false, id)
    assert.ok(candidate.skillRequirements.length > 0, id)
  }
  const ksubdomain = plan.candidates.find(item => item.id === 'ksubdomain')
  assert.equal(ksubdomain.executionPolicy, 'unmapped-manual-review')
  assert.equal(ksubdomain.executionMode, 'unmapped-manual-review')
  assert.equal(ksubdomain.executionAdapter, null)
})

test('selected tools expose Skill read keys and explicit execution policy without granting execution', (t) => {
  const root = workspace(t)
  const httpx = fileAt(join(root, 'pd-httpx.exe'))
  const webPlan = planTaskTools('web', {
    root, config: configFor(root, { httpx }), env: { PATH: '' },
  })
  const selected = webPlan.candidates.find((item) => item.id === 'httpx')
  assert.equal(webPlan.skillPlan.status, 'read-required')
  assert.equal(webPlan.skillPlan.readTool, 'redteam_skill_read')
  assert.deepEqual(selected.skillRequirements.map((item) => item.key), [
    'redteam:httpx-web-inventory',
  ])
  assert.equal(selected.executionPolicy, 'dedicated-adapter')
  assert.equal(selected.executionAdapter, 'redteam_scan_run')
  assert.equal(selected.requiresScopeReview, true)
  assert.equal(selected.automaticExecutionAllowed, false)

  const fscan = fileAt(join(root, 'fscan.exe'))
  const internalPlan = planTaskTools('internal', {
    root, config: configFor(root, { fscan }), env: { PATH: '' },
  })
  const internal = internalPlan.candidates.find((item) => item.id === 'fscan')
  assert.equal(internal.executionPolicy, 'unmapped-manual-review')
  assert.equal(internal.executionMode, 'unmapped-manual-review')
  assert.equal(internal.operatorConfirmationRequired, true)
  assert.equal(internal.automaticExecutionAllowed, false)
  assert.match(internal.policyNote, /旧 Skill 包含凭据尝试/)

  const unreviewed = toolUseContract('netexec')
  assert.equal(unreviewed.executionPolicy, 'unmapped-manual-review')
  assert.deepEqual(unreviewed.skillRequirements, [])
  assert.equal(unreviewed.operatorConfirmationRequired, true)
})


test('only the reviewed adapters and passive-recon flow expose executable Skill contracts', () => {
  const expected = {
    nmap: 'redteam:nmap-service-inventory',
    httpx: 'redteam:httpx-web-inventory',
    subfinder: 'redteam:passive-recon',
    dnsx: 'redteam:passive-recon',
    amass: 'redteam:passive-recon',
  }
  for (const [id, key] of Object.entries(expected)) {
    const contract = toolUseContract(id)
    assert.deepEqual(contract.skillRequirements.map(item => item.key), [key], id)
    assert.equal(contract.automaticExecutionAllowed, false, id)
  }

  const unmapped = [
    'ksubdomain', 'naabu', 'masscan', 'nuclei', 'fscan', 'gogo',
    'smbclient', 'netexec', 'impacket', 'suo5', 'frpc', 'frps',
    'chisel', 'ffuf', 'feroxbuster', 'gowitness', 'testssl', 'katana',
  ]
  for (const id of unmapped) {
    const contract = toolUseContract(id)
    assert.equal(contract.executionPolicy, 'unmapped-manual-review', id)
    assert.deepEqual(contract.skillRequirements, [], id)
    assert.equal(contract.automaticExecutionAllowed, false, id)
  }

  const passive = readFileSync(new URL('../skills/redteam/passive-recon.md', import.meta.url), 'utf8')
  const nmap = readFileSync(new URL('../skills/redteam/nmap-service-inventory.md', import.meta.url), 'utf8')
  const httpx = readFileSync(new URL('../skills/redteam/httpx-web-inventory.md', import.meta.url), 'utf8')
  const preset = readFileSync(new URL('../presets/redteam/agent.cordis.yml', import.meta.url), 'utf8')
  assert.match(passive, /confirm_external=true/)
  assert.match(nmap, /redteam_scan_run/)
  assert.match(httpx, /redteam_scan_run/)
  assert.match(preset, /exploit 与 internal 角色当前停用/)
  assert.doesNotMatch(preset, /武器库优先|立刻建 suo5|弱口令|冰蝎|哥斯拉/)
})
