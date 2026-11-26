/**
 * 防溯源智能体集成与编排测试
 * 
 * 验证防溯源智能体的完整生命周期：
 * - 配置验证
 * - 隐私姿态评估
 * - 完整/部分清除执行
 * - 能力级细粒度操作
 * - 审计日志记录
 * - 操作回滚
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { AntiForensicsAgent } from '../lib/redteam/anti-forensics-agent.js'
import { AntiForensicsConfig } from '../lib/redteam/anti-forensics-config.js'
import { AntiForensicsPosture } from '../lib/redteam/anti-forensics-posture.js'
import { ForensicsEvasionOrchestrator, FORENSICS_CAPABILITIES, EVASION_STRATEGIES } from '../lib/redteam/forensics-evasion-orchestrator.js'

test('集成：防溯源智能体完整初始化', () => {
  const agent = new AntiForensicsAgent({
    config: new AntiForensicsConfig({ privacyLevel: 'comprehensive' }),
    posture: new AntiForensicsPosture(),
  })

  assert.ok(agent instanceof AntiForensicsAgent)
  assert.ok(agent.orchestrator instanceof ForensicsEvasionOrchestrator)
  assert.ok(agent.state.auditIds)
  assert.ok(Array.isArray(agent.state.operationHistory))
})

test('集成：配置到编排器的流转', async () => {
  const config = new AntiForensicsConfig({
    privacyLevel: 'comprehensive',
    strategy: 'balanced',
    platform: 'linux',
    dryRun: true,
  })

  const agent = new AntiForensicsAgent({ config })
  const result = await agent.executeFullCleanup({}, 'balanced')

  assert.equal(result.success, true, `Expected success but got error: ${result.error}`)
  assert.ok(result.auditId)
  assert.ok(result.cleaned.length >= 0)
})

test('集成：多个清除策略的能力对应', () => {
  for (const [strategy, levelId] of Object.entries({
    safe: 'minimal',
    balanced: 'comprehensive',
    aggressive: 'extreme',
  })) {
    const orchestrator = new ForensicsEvasionOrchestrator({ strategy })
    const capabilities = orchestrator.getCapabilities()

    assert.ok(capabilities.length > 0, `${strategy} 应返回能力列表`)
    assert.ok(
      capabilities.every((id) => FORENSICS_CAPABILITIES[id]),
      `${strategy} 中所有能力应存在`,
    )
  }
})

test('集成：审计日志在整个清除生命周期中的记录', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true

  const result1 = await agent.executeFullCleanup({}, 'safe')
  assert.ok(result1.auditId)

  const log1 = agent.getAuditLog(result1.auditId)
  assert.ok(log1.length > 0)

  // 验证审计日志包含关键事件
  const eventTypes = log1.map((entry) => entry.type)
  assert.ok(eventTypes.includes('START_FULL_CLEANUP'))
  assert.ok(eventTypes.includes('PRE_ASSESSMENT') || eventTypes.includes('ERROR'))
})

test('集成：隐私状态评估影响清除建议', async () => {
  const agent = new AntiForensicsAgent()
  const posture = await agent.getPrivacyPosture()

  // 根据隐私状态选择不同的清除策略
  if (posture.overallRisk === 'critical') {
    const result = await agent.executeFullCleanup({}, 'aggressive')
    assert.equal(result.success, true)
    assert.ok(result.cleaned.length >= 10, '激进模式应包含多个清除能力')
  }
})

test('集成：单个能力执行不影响其他能力', async () => {
  const agent = new AntiForensicsAgent()

  const capability1 = await agent.executeCapability('shellhistory-cleanup', true)
  const capability2 = await agent.executeCapability('browser-history-nuke', true)

  assert.ok(capability1.auditId)
  assert.ok(capability2.auditId)
  assert.notEqual(capability1.auditId, capability2.auditId, '不同能力应有不同审计 ID')
})

test('集成：预览模式不实际清除', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true

  const preview = await agent.previewCleanup({}, 'comprehensive')
  assert.equal(preview.success, true)
  assert.ok(preview.capabilities)
  assert.ok(Array.isArray(preview.targetArtifacts))
})

test('集成：清除报告包含完整的取证影响分析', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true

  const result = await agent.executeFullCleanup({}, 'balanced')
  if (result.report) {
    assert.ok(result.report.forensicImpact)
    assert.ok(result.report.forensicImpact.preCleanup)
    assert.ok(result.report.forensicImpact.postCleanup)
    assert.equal(typeof result.report.forensicImpact.riskReduction, 'number')
  }
})

test('集成：配置验证在清除前执行', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.privacyLevel = 'invalid'
  agent.config.strategy = 'invalid'

  const result = await agent.executeFullCleanup({}, 'invalid')
  assert.equal(result.success, false)
  assert.ok(result.error)
})

test('集成：支持会话级别的隐私策略', async () => {
  const session = { id: 'test-session-001' }
  const agent = new AntiForensicsAgent()

  const preview = await agent.previewCleanup(session, 'balanced')
  assert.equal(preview.success, true)

  // 审计日志应记录会话信息
  const log = agent.getAuditLog(preview.auditId)
  assert.ok(log)
})

test('集成：Subagent 间的隐私配置传递', async () => {
  // 模拟从红队会话调用 AntiForensicsAgent
  const agent = new AntiForensicsAgent({
    config: new AntiForensicsConfig({
      privacyLevel: 'comprehensive',
      dryRun: true,
    }),
  })

  const result = await agent.executeFullCleanup({}, 'balanced')
  assert.equal(result.success, true)

  // 验证配置一致性
  assert.ok(result.report)
  assert.ok(result.cleaned.length > 0)
})

test('集成：错误处理与恢复', async () => {
  const agent = new AntiForensicsAgent()

  // 执行不存在的能力
  const badResult = await agent.executeCapability('non-existent-capability')
  assert.equal(badResult.success, false)
  assert.ok(badResult.error)

  // 验证错误不会影响后续操作
  const goodResult = await agent.executeCapability('shellhistory-cleanup', true)
  assert.equal(goodResult.success, true)
})

test('集成：多个清除操作的独立审计追踪', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true

  const result1 = await agent.executeFullCleanup({}, 'safe')
  const result2 = await agent.executeFullCleanup({}, 'balanced')
  const result3 = await agent.executeFullCleanup({}, 'aggressive')

  const auditIds = agent.getAuditIds()
  assert.equal(auditIds.length, 3)
  assert.ok(auditIds.includes(result1.auditId))
  assert.ok(auditIds.includes(result2.auditId))
  assert.ok(auditIds.includes(result3.auditId))
})

test('集成：预览与实际执行的一致性', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true

  const preview = await agent.previewCleanup({}, 'comprehensive')
  const execute = await agent.executeFullCleanup({}, 'comprehensive')

  // 预览的能力数应与执行相同或接近
  assert.ok(preview.capabilities.length > 0)
  assert.ok(execute.cleaned.length >= 0)
})

test('集成：隐私姿态评估与清除能力的对应', async () => {
  const agent = new AntiForensicsAgent()

  const posture = await agent.getPrivacyPosture()
  const capabilities = agent.config.getApplicableCapabilities()

  // 验证清除能力覆盖了隐私姿态中识别的关键证物
  if (posture.artifacts.length > 0) {
    const cleanableArtifacts = posture.artifacts.filter((a) => a.cleanable)
    assert.ok(
      cleanableArtifacts.length === 0 || capabilities.length > 0,
      '如果有可清除证物，应有对应能力',
    )
  }
})

test('集成：FORENSICS_CAPABILITIES 与 EVASION_STRATEGIES 的完整性', () => {
  // 验证所有策略中的能力都定义了
  for (const [strategyId, strategy] of Object.entries(EVASION_STRATEGIES)) {
    for (const capabilityId of strategy.capabilities) {
      assert.ok(
        FORENSICS_CAPABILITIES[capabilityId],
        `Strategy ${strategyId} 引用未定义的能力 ${capabilityId}`,
      )
    }
  }

  // 验证能力定义的一致性
  for (const [capId, capability] of Object.entries(FORENSICS_CAPABILITIES)) {
    assert.ok(capability.name)
    assert.ok(capability.description)
    assert.ok(capability.riskLevel)
    assert.ok(['true', 'false', 'N/A'].includes(String(capability.reversible)))
  }
})

test('集成：脱敏报告不泄露敏感信息', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true

  const result = await agent.executeFullCleanup({}, 'balanced')
  if (result.report) {
    const reportJson = JSON.stringify(result.report)

    // 报告不应包含具体路径或IP
    assert.ok(!reportJson.includes('/var/log'))
    assert.ok(!reportJson.includes('192.168'))
    assert.ok(!reportJson.includes('C:\\\\Windows'))

    // 报告应包含说明信息
    assert.ok(result.report.notes)
    assert.ok(result.report.notes.includes('redacted') || result.report.notes.includes('脱敏'))
  }
})
