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

  // 1. 两个工具确实注册了
  assert.ok(registered.has('redteam_exploit_chain'), 'redteam_exploit_chain must be registered')
  assert.ok(registered.has('redteam_internal_campaign'), 'redteam_internal_campaign must be registered')

  const chainTool = registered.get('redteam_exploit_chain')
  const campaignTool = registered.get('redteam_internal_campaign')

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

  // 4. confirm 后进入干运行，且明确 dry_run=true
  const scoped = redteam.openEngagement('agent-smoke-scoped', ['192.0.2.0/24'], { bindCurrent: false }).id
  const dry = JSON.parse(await chainTool.execute({
    engagement: scoped, target: '192.0.2.50', port: 80, service: 'http',
    strategy: 'spray-first', confirm: true,
  }, {}))
  assert.equal(dry.dry_run, true, 'chain must default to dry-run')
  assert.ok(Array.isArray(dry.stages))
  assert.ok(dry.audit_id)
  assert.match(String(dry.hint || ''), /干运行/)

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

  // 5. 阶段已落链（审计可复核）
  const chain = redteam.listChain(scoped)
  assert.ok(chain.length > 0, 'chain stages must be recorded for review')

  // 6. Red-team agents must consult the task planner and use the supported scan runner.
  const preset = readFileSync(new URL('../presets/redteam/agent.cordis.yml', import.meta.url), 'utf8')
  assert.match(preset, /每个执行角色开始一个新的工具型任务前，必须调用一次 `redteam_tool_select`/)
  assert.match(preset, /Nmap \/ ProjectDiscovery httpx 单目标扫描必须走 `redteam_scan_run`/)
  assert.match(preset, /customTools/);
  assert.match(preset, /不对全部工具逐项探测/);
  assert.match(preset, /不在每个子智能体步骤重复预检/);
})
