import test from 'node:test'
import assert from 'node:assert/strict'
import { AntiForensicsAgent } from '../lib/redteam/anti-forensics-agent.js'
import { AntiForensicsConfig, PRIVACY_LEVELS, STRATEGY_MAPPING } from '../lib/redteam/anti-forensics-config.js'
import { AntiForensicsPosture, ARTIFACT_RISK_LEVELS } from '../lib/redteam/anti-forensics-posture.js'

test('AntiForensicsConfig: 隐私等级验证', () => {
  const config = new AntiForensicsConfig({ privacyLevel: 'comprehensive' })
  const validation = config.validate()
  assert.equal(validation.valid, true)
  assert.deepEqual(validation.errors, [])
})

test('AntiForensicsConfig: 无效隐私等级应报错', () => {
  const config = new AntiForensicsConfig({ privacyLevel: 'invalid_level' })
  const validation = config.validate()
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.length > 0)
})

test('AntiForensicsConfig: 应用清除能力获取', () => {
  const config = new AntiForensicsConfig({ privacyLevel: 'comprehensive' })
  const capabilities = config.getApplicableCapabilities()
  assert.ok(Array.isArray(capabilities))
  assert.ok(capabilities.length > 0)
  assert.ok(capabilities.includes('shellhistory-cleanup'))
  assert.ok(capabilities.includes('browser-history-nuke'))
})

test('AntiForensicsConfig: 策略映射到隐私等级', () => {
  const config = new AntiForensicsConfig({ strategy: 'balanced' })
  const capabilities = config.getApplicableCapabilities()
  assert.ok(capabilities.length > 0)
  // balanced 应该映射到 comprehensive 等级
  assert.ok(capabilities.includes('syslog-erase-linux') || capabilities.includes('eventlog-purge-windows'))
})

test('AntiForensicsConfig: 平台特定能力过滤 (Windows)', () => {
  const config = new AntiForensicsConfig({
    privacyLevel: 'extreme',
    platform: 'win32',
  })
  const capabilities = config.getApplicableCapabilities()
  // Windows 不应包含 Linux 特定能力
  assert.ok(!capabilities.includes('syslog-erase-linux'))
})

test('AntiForensicsConfig: 平台特定能力过滤 (Linux)', () => {
  const config = new AntiForensicsConfig({
    privacyLevel: 'extreme',
    platform: 'linux',
  })
  const capabilities = config.getApplicableCapabilities()
  // Linux 不应包含 Windows 特定能力
  assert.ok(!capabilities.includes('eventlog-purge-windows'))
})

test('AntiForensicsConfig: 自定义能力优先级', () => {
  const customCapabilities = ['shellhistory-cleanup', 'browser-history-nuke']
  const config = new AntiForensicsConfig({
    privacyLevel: 'extreme',
    customCapabilities,
  })
  const capabilities = config.getApplicableCapabilities()
  assert.deepEqual(capabilities, customCapabilities)
})

test('AntiForensicsConfig: 配置元数据生成', () => {
  const config = new AntiForensicsConfig({
    privacyLevel: 'comprehensive',
    strategy: 'balanced',
  })
  const metadata = config.getMetadata()
  assert.equal(metadata.privacyLevel, 'comprehensive')
  assert.ok(metadata.capabilityCount > 0)
  assert.ok(metadata.riskLevel)
  assert.ok(metadata.estimatedTime >= 0)
})

test('AntiForensicsConfig: 配置摘要生成', () => {
  const config = new AntiForensicsConfig({ privacyLevel: 'basic' })
  const summary = config.summarize()
  assert.ok(summary.privacyLevel)
  assert.ok(summary.description)
  assert.ok(summary.capabilityCount > 0)
  assert.ok(summary.mode)
})

test('AntiForensicsPosture: 隐私姿态评估（async）', async () => {
  const posture = new AntiForensicsPosture({ platform: 'linux' })
  const report = await posture.assess()
  assert.ok(report.timestamp)
  assert.equal(report.platform, 'Linux')
  assert.ok(['low', 'medium', 'high', 'critical'].includes(report.overallRisk))
  assert.ok(Array.isArray(report.artifacts))
  assert.ok(Array.isArray(report.recommendations))
})

test('AntiForensicsPosture: 风险总结', async () => {
  const posture = new AntiForensicsPosture({ platform: 'linux' })
  const report = await posture.assess()
  assert.equal(typeof report.criticalCount, 'number')
  assert.equal(typeof report.highCount, 'number')
  assert.equal(typeof report.mediumCount, 'number')
})

test('AntiForensicsPosture: 建议生成', async () => {
  const posture = new AntiForensicsPosture({ platform: 'linux' })
  const report = await posture.assess()
  if (report.recommendations.length > 0) {
    const rec = report.recommendations[0]
    assert.ok(rec.priority)
    assert.ok(rec.title)
  }
})

test('AntiForensicsAgent: 实例化', () => {
  const agent = new AntiForensicsAgent()
  assert.ok(agent instanceof AntiForensicsAgent)
  assert.ok(agent.config instanceof AntiForensicsConfig)
  assert.ok(agent.posture instanceof AntiForensicsPosture)
})

test('AntiForensicsAgent: 获取审计 ID', () => {
  const agent = new AntiForensicsAgent()
  const auditIds = agent.getAuditIds()
  assert.ok(Array.isArray(auditIds))
})

test('AntiForensicsAgent: 预览清除操作（干运行）', async () => {
  const agent = new AntiForensicsAgent()
  const preview = await agent.previewCleanup({}, 'balanced')
  assert.equal(preview.success, true)
  assert.ok(preview.auditId)
  assert.ok(preview.capabilities)
  assert.ok(Array.isArray(preview.targetArtifacts))
})

test('AntiForensicsAgent: 获取隐私状态', async () => {
  const agent = new AntiForensicsAgent()
  const posture = await agent.getPrivacyPosture()
  assert.ok(posture.timestamp)
  assert.ok(['low', 'medium', 'high', 'critical'].includes(posture.overallRisk))
})

test('AntiForensicsAgent: 执行单个清除能力（干运行）', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true
  const result = await agent.executeCapability('shellhistory-cleanup', true)
  assert.ok(result.auditId)
  assert.equal(result.capabilityId, 'shellhistory-cleanup')
})

test('AntiForensicsAgent: 未知能力应报错', async () => {
  const agent = new AntiForensicsAgent()
  const result = await agent.executeCapability('unknown-capability', true)
  assert.equal(result.success, false)
  assert.ok(result.error)
})

test('AntiForensicsAgent: 完整清除流程（干运行）', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true
  const result = await agent.executeFullCleanup({}, 'balanced', 'auto')
  assert.equal(result.success, true)
  assert.ok(result.auditId)
  assert.ok(result.report)
  assert.ok(Array.isArray(result.cleaned))
  assert.ok(Array.isArray(result.failed))
})

test('AntiForensicsAgent: 清除报告包含脱敏信息', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true
  const result = await agent.executeFullCleanup({}, 'balanced')
  if (result.report) {
    assert.ok(result.report.auditId)
    assert.ok(result.report.summary)
    assert.ok(result.report.forensicImpact)
    assert.ok(result.report.notes) // 脱敏说明
  }
})

test('AntiForensicsAgent: 审计日志记录', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true
  const result = await agent.executeFullCleanup({}, 'safe')
  if (result.success) {
    const log = agent.getAuditLog(result.auditId)
    assert.ok(Array.isArray(log))
    assert.ok(log.length > 0)
    // 应该有开始和完成记录
    assert.ok(log.some((entry) => entry.type === 'START_FULL_CLEANUP'))
    assert.ok(log.some((entry) => entry.type === 'COMPLETE' || entry.type === 'ERROR'))
  }
})

test('AntiForensicsAgent: 策略验证', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.strategy = 'invalid'
  const result = await agent.executeFullCleanup({}, 'invalid')
  assert.equal(result.success, false)
  assert.ok(result.error)
})

test('AntiForensicsAgent: 多个清除操作独立审计', async () => {
  const agent = new AntiForensicsAgent()
  agent.config.dryRun = true
  
  const result1 = await agent.executeFullCleanup({}, 'safe')
  const result2 = await agent.executeFullCleanup({}, 'balanced')
  
  assert.notEqual(result1.auditId, result2.auditId)
  assert.ok(agent.getAuditIds().includes(result1.auditId))
  assert.ok(agent.getAuditIds().includes(result2.auditId))
})

test('PRIVACY_LEVELS: 所有等级都应定义 cleanupScope', () => {
  for (const [levelId, level] of Object.entries(PRIVACY_LEVELS)) {
    assert.ok(level.cleanupScope, `Level ${levelId} missing cleanupScope`)
    assert.ok(Array.isArray(level.cleanupScope), `Level ${levelId} cleanupScope not array`)
    assert.ok(level.cleanupScope.length > 0, `Level ${levelId} cleanupScope empty`)
    assert.ok(['low', 'medium', 'high', 'critical'].includes(level.riskLevel), `Invalid riskLevel for ${levelId}`)
  }
})

test('STRATEGY_MAPPING: 所有策略都应映射到有效等级', () => {
  for (const [strategy, levelId] of Object.entries(STRATEGY_MAPPING)) {
    assert.ok(PRIVACY_LEVELS[levelId], `Strategy ${strategy} maps to invalid level ${levelId}`)
  }
})

test('ARTIFACT_RISK_LEVELS: 包含所有必需等级', () => {
  const required = ['critical', 'high', 'medium', 'low', 'info']
  for (const level of required) {
    assert.ok(ARTIFACT_RISK_LEVELS[level], `Missing risk level: ${level}`)
  }
})
