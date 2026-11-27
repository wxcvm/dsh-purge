/**
 * 作战智能体工具冒烟：验证 redteam_exploit_chain / redteam_internal_campaign
 * 在真实注册后能被调用，且默认干运行、范围门禁生效。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('作战智能体工具：注册、默认干运行、范围门禁', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-agents-'))
  const prevHome = process.env.DSH_HOME
  const prevKb = process.env.ARTEX_KB_DIR
  let redteam
  t.after(() => {
    redteam?.close()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    if (prevKb === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = prevKb
    rmSync(home, { recursive: true, force: true })
  })

  const moduleDir = join(home, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{}')
  writeFileSync(join(moduleDir, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(moduleDir, 'index.js'), 'exports.defineTool = spec => spec\n')
  process.env.DSH_HOME = home
  process.env.ARTEX_KB_DIR = join(home, 'artkb')
  mkdirSync(process.env.ARTEX_KB_DIR, { recursive: true })

  const { apply } = await import('../lib/redteam/tools.js')
  redteam = new RedteamStore(home)
  const registered = new Map()
  const ctx = {
    redteam,
    tools: { register(tool) { registered.set(tool.name, tool) } },
    on: () => () => {},
    effect: (attach) => { const d = attach(); t.after(() => d?.()) },
  }
  apply(ctx)

  // Sensitive legacy records are metadata-only; target-side credential/shell/tunnel paths fail closed.
  const sensitiveEngagement = redteam.openEngagement('sensitive-tool-boundary', [], { bindCurrent: false }).id
  redteam.addCredential(sensitiveEngagement, {
    host: '192.0.2.10', username: 'operator', secret_value: 'credential-secret-marker',
  })
  redteam.addWebshell(sensitiveEngagement, {
    url: 'https://private.invalid/shell', pass_key: 'webshell-secret-marker', shell_type: 'behinder',
  })
  redteam.addTunnel(sensitiveEngagement, {
    kind: 'socks5', listen: '127.0.0.1:1080', reach: '10.0.0.0/8', command: 'tunnel-command-marker',
  })

  const credentialList = JSON.parse(await registered.get('redteam_credential_list').execute({ engagement: sensitiveEngagement }, {}))
  assert.equal(credentialList.items[0].secret_present, true)
  assert.equal(Object.hasOwn(credentialList.items[0], 'secret_value'), false)
  assert.doesNotMatch(JSON.stringify(credentialList), /credential-secret-marker/)

  const credentialAttempt = JSON.parse(await registered.get('redteam_credential_add').execute({
    engagement: sensitiveEngagement, host: '192.0.2.11', secret_value: 'must-not-store',
  }, {}))
  assert.equal(credentialAttempt.ok, false)
  const credentialCheck = JSON.parse(await registered.get('redteam_credential_check').execute({ engagement: sensitiveEngagement }, {}))
  assert.equal(credentialCheck.status, 'unsupported')
  assert.equal(credentialCheck.actual_execution, false)

  const webshellList = JSON.parse(await registered.get('redteam_webshell_list').execute({ engagement: sensitiveEngagement }, {}))
  assert.equal(Object.hasOwn(webshellList.items[0], 'url'), false)
  assert.equal(Object.hasOwn(webshellList.items[0], 'pass_key'), false)
  const tunnelList = JSON.parse(await registered.get('redteam_tunnel_list').execute({ engagement: sensitiveEngagement }, {}))
  assert.equal(Object.hasOwn(tunnelList.items[0], 'command'), false)
  assert.equal(Object.hasOwn(tunnelList.items[0], 'listen'), false)
  assert.equal(Object.hasOwn(tunnelList.items[0], 'reach'), false)

  const sessions = JSON.parse(await registered.get('redteam_sessions').execute({ engagement: sensitiveEngagement }, {}))
  assert.doesNotMatch(JSON.stringify(sessions), /credential-secret-marker|webshell-secret-marker|tunnel-command-marker|private\\.invalid/)
  for (const name of ['redteam_webshell_add', 'redteam_tunnel_add', 'redteam_session_check', 'redteam_access_add']) {
    const result = JSON.parse(await registered.get(name).execute({ engagement: sensitiveEngagement }, {}))
    assert.equal(result.status, 'unsupported', name)
    assert.equal(result.actual_execution, false, name)
  }
  const webshellReactivate = JSON.parse(await registered.get('redteam_webshell_update').execute({
    engagement: sensitiveEngagement, id: 1, status: 'online',
  }, {}))
  assert.equal(webshellReactivate.ok, false)
  const tunnelReactivate = JSON.parse(await registered.get('redteam_tunnel_update').execute({
    engagement: sensitiveEngagement, id: 1, status: 'active',
  }, {}))
  assert.equal(tunnelReactivate.ok, false)
  const evidenceUpgrade = JSON.parse(await registered.get('redteam_evidence_upgrade').execute({
    engagement: sensitiveEngagement, claimed_ev_id: 'fake-evidence-id', verified_result: { verified: true },
  }, {}))
  assert.equal(evidenceUpgrade.status, 'unsupported')
  assert.equal(evidenceUpgrade.verified, false)

  for (const name of ['redteam_chain_add', 'redteam_score_hit', 'redteam_chain_plan', 'redteam_chain_advance']) {
    const result = JSON.parse(await registered.get(name).execute({ engagement: sensitiveEngagement }, {}))
    assert.equal(result.status, 'unsupported', name)
    assert.equal(result.ok, false, name)
  }

  assert.equal(Object.hasOwn(registered.get('redteam_vuln_add').parameters, 'status'), false)
  assert.equal(Object.hasOwn(registered.get('redteam_vuln_add').parameters, 'gained'), false)
  const candidate = JSON.parse(await registered.get('redteam_vuln_add').execute({
    engagement: sensitiveEngagement, title: 'Candidate-only test', severity: 'low',
  }, {}))
  assert.equal(candidate.status, 'candidate')
  assert.equal(candidate.verified, false)
  const candidateId = candidate.id || candidate.vuln_id || candidate.item?.id
  if (candidateId) {
    assert.equal(Object.hasOwn(registered.get('redteam_vuln_update').parameters, 'status'), false)
    const updatedCandidate = JSON.parse(await registered.get('redteam_vuln_update').execute({
      engagement: sensitiveEngagement, id: candidateId, severity: 'medium',
    }, {}))
    assert.equal(updatedCandidate.verified, false)
    const storedCandidate = redteam.listVulns(sensitiveEngagement, { limit: 20 }).items.find(item => item.id === candidateId)
    assert.equal(storedCandidate.status, 'candidate')
  }

  const evidenceRecord = JSON.parse(await registered.get('redteam_evidence_record').execute({
    engagement: sensitiveEngagement, operation: 'model-claim-test',
    result: { claim: 'unverified' }, confidence: 'observed', authority: 'tool-output',
  }, {}))
  assert.equal(evidenceRecord.ok, true)
  const evidenceId = evidenceRecord.ev_id || evidenceRecord.evidence?.ev_id
  if (evidenceId) {
    const evidenceRow = redteam.db(sensitiveEngagement).prepare('SELECT confidence, authority FROM evidence WHERE ev_id = ?').get(evidenceId)
    assert.equal(evidenceRow.confidence, 'claimed')
    assert.equal(evidenceRow.authority, 'tool-output')
  }

  const skillReadTool = registered.get('redteam_skill_read')
  const quarantinedSkill = JSON.parse(await skillReadTool.execute({
    key: 'redteam:credential-attack',
  }, { agent: { session: { id: 'sensitive-root', header: {} } } }))
  assert.equal(quarantinedSkill.quarantined, true)
  assert.equal(quarantinedSkill.skillReadReceipt, 'not-recorded')
  assert.doesNotMatch(quarantinedSkill.content, /hydra|password.spray|weak.password/i)
  const unapprovedSkill = JSON.parse(await skillReadTool.execute({
    key: 'redteam:business-security-controls',
  }, { agent: { session: { id: 'sensitive-root', header: {} } } }))
  assert.equal(unapprovedSkill.skillReadReceipt, 'not-recorded')
  const approvedSkill = JSON.parse(await skillReadTool.execute({
    key: 'redteam:nmap-service-inventory',
  }, { agent: { session: { id: 'sensitive-root', header: {} } } }))
  assert.equal(approvedSkill.quarantined, false)
  assert.equal(approvedSkill.skillReadReceipt, 'recorded-for-current-root-session')

  // 1. 两个工具确实注册了
  assert.ok(registered.has('redteam_exploit_chain'), 'redteam_exploit_chain must be registered')
  assert.ok(registered.has('redteam_internal_campaign'), 'redteam_internal_campaign must be registered')

  const chainTool = registered.get('redteam_exploit_chain')
  const campaignTool = registered.get('redteam_internal_campaign')
  const rolesTool = registered.get('redteam_roles')
  const rolePromptTool = registered.get('redteam_role_prompt')
  const roles = JSON.parse(await rolesTool.execute({}, {}))
  assert.equal(roles.roles.find((item) => item.role === 'exploit').enabled, false)
  assert.equal(roles.roles.find((item) => item.role === 'internal').enabled, false)
  const disabledPrompt = JSON.parse(await rolePromptTool.execute({ engagement: redteam.openEngagement('agent-smoke-role', [], { bindCurrent: false }).id, role: 'exploit' }, {}))
  assert.equal(disabledPrompt.enabled, false)
  assert.equal(disabledPrompt.executionPolicy, 'disabled-no-reviewed-adapter')
  assert.equal(disabledPrompt.prompt, null, 'disabled legacy prompt text must not be exposed to the model')
  const activePrompt = JSON.parse(await rolePromptTool.execute({ engagement: redteam.openEngagement('agent-smoke-recon', [], { bindCurrent: false }).id, role: 'recon' }, {}))
  assert.equal(activePrompt.enabled, true)
  assert.match(activePrompt.prompt, /当前工具执行契约（覆盖旧版角色提示词中的冲突指令）/)
  assert.match(activePrompt.prompt, /redteam_passive_recon/)
  assert.match(activePrompt.prompt, /不得执行，不得猜测命令/)

  // 2. 参数定义完整（dry_run 必须存在，默认语义在实现里）
  assert.ok(Object.hasOwn(chainTool.parameters, 'dry_run'))
  assert.ok(Object.hasOwn(campaignTool.parameters, 'dry_run'))
  assert.ok(Object.hasOwn(chainTool.parameters, 'target'))
  assert.ok(Object.hasOwn(campaignTool.parameters, 'starting_host'))

  // 3. 范围门禁：未登记 scope 且未 confirm 时拒绝
  const eng = redteam.openEngagement('agent-smoke', [], { bindCurrent: false }).id
  const denied = JSON.parse(await chainTool.execute({ engagement: eng, target: '192.0.2.50' }, {}))
  assert.equal(denied.ok, false)
  assert.match(String(denied.error || ''), /授权范围|confirm/)

  const campaignDenied = JSON.parse(await campaignTool.execute({
    engagement: eng, starting_host: '10.0.0.5',
  }, {}))
  assert.equal(campaignDenied.ok, false)
  assert.match(String(campaignDenied.error || ''), /授权范围|confirm/)

  const invalidCampaignTarget = JSON.parse(await campaignTool.execute({
    engagement: redteam.openEngagement('agent-smoke-invalid', ['10.0.0.0/24'], { bindCurrent: false }).id,
    starting_host: '   ', confirm: true,
  }, {}))
  assert.equal(invalidCampaignTarget.ok, false, 'invalid targets must fail the scope gate')
  assert.match(String(invalidCampaignTarget.error || ''), /目标校验失败/)

  // 4. confirm 后进入干运行，且明确 dry_run=true
  const scoped = redteam.openEngagement('agent-smoke-scoped', ['192.0.2.0/24'], { bindCurrent: false }).id
  const dry = JSON.parse(await chainTool.execute({
    engagement: scoped, target: '192.0.2.50', port: 80, service: 'http',
    strategy: 'spray-first', confirm: true,
  }, {}))
  assert.equal(dry.dry_run, true, 'chain must default to simulation-only')
  assert.equal(dry.status, 'simulated')
  assert.equal(dry.success, null)
  assert.equal(dry.actual_execution, false)
  assert.equal(dry.stages_completed, 0)
  assert.equal(dry.stages_recorded, 0)
  assert.equal(dry.audit_id, null)
  assert.ok(Array.isArray(dry.stages))
  assert.match(String(dry.hint || ''), /仅返回阶段标签/)

  const internalHome = redteam.openEngagement('agent-smoke-internal', ['10.0.0.0/24'], { bindCurrent: false }).id
  const dryInternal = JSON.parse(await campaignTool.execute({
    engagement: internalHome, starting_host: '10.0.0.5', confirm: true,
  }, {}))
  assert.equal(dryInternal.ok, true, 'the simulation request itself should complete')
  assert.equal(dryInternal.dry_run, true, 'campaign must default to dry-run')
  assert.equal(dryInternal.status, 'simulated')
  assert.equal(dryInternal.success, null, 'simulation must not claim campaign success')
  assert.equal(dryInternal.simulated, true)
  assert.equal(dryInternal.actual_execution, false)
  assert.equal(dryInternal.assets_discovered, null)
  assert.equal(dryInternal.hosts_compromised, null)
  assert.equal(dryInternal.stages_completed, 0)
  assert.equal(dryInternal.stages_recorded, 0)
  assert.ok(dryInternal.stages_planned > 0)
  assert.ok(dryInternal.audit_id)
  assert.match(String(dryInternal.hint || ''), /仅返回模拟阶段计划/)
  assert.equal(redteam.listChain(internalHome).length, 0, 'simulation must not be persisted as execution evidence')

  const unsupportedInternal = JSON.parse(await campaignTool.execute({
    engagement: internalHome, starting_host: '10.0.0.5', dry_run: false, confirm: true,
  }, {}))
  assert.equal(unsupportedInternal.ok, false)
  assert.equal(unsupportedInternal.status, 'unsupported')
  assert.equal(unsupportedInternal.success, null)
  assert.equal(unsupportedInternal.actual_execution, false)
  assert.equal(unsupportedInternal.experience_recorded, false)
  assert.match(String(unsupportedInternal.hint || ''), /拒绝启动/)

  // 5. Simulation and unsupported requests must not write execution evidence.
  const unsupportedExploit = JSON.parse(await chainTool.execute({
    engagement: scoped, target: '192.0.2.50', dry_run: false, confirm: true,
  }, {}))
  assert.equal(unsupportedExploit.status, 'unsupported')
  assert.equal(unsupportedExploit.success, null)
  assert.equal(unsupportedExploit.actual_execution, false)
  assert.equal(unsupportedExploit.experience_recorded, false)
  assert.equal(redteam.listChain(scoped).length, 0, 'simulation must not be persisted as execution evidence')

  // 6. Red-team agents must consult the task planner and use the supported scan runner.
  const preset = readFileSync(new URL('../presets/redteam/agent.cordis.yml', import.meta.url), 'utf8')
  assert.match(preset, /每个执行角色开始一个新的工具型任务前，必须调用一次 `redteam_tool_select`/)
  assert.match(preset, /Nmap \/ ProjectDiscovery httpx 单目标扫描必须走 `redteam_scan_run`/)
  assert.match(preset, /customTools/);
  assert.match(preset, /configuredCustomTools/);
  assert.match(preset, /executionAdapter/);
  assert.match(preset, /不对全部工具逐项探测/);
  assert.match(preset, /不在每个子智能体步骤重复预检/);
})
