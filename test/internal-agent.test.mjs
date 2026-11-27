/**
 * 内网渗透作战智能体测试（node:test）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { InternalAgent } from '../lib/redteam/agents/internal-agent.js'

test('internal-agent: initializes all sub-engines', () => {
  const agent = new InternalAgent({ dryRun: true })
  assert.ok(agent.recon)
  assert.ok(agent.lateral)
  assert.ok(agent.privesc)
  assert.ok(agent.exfiltration)
  assert.ok(agent.forensics)
  assert.equal(agent.config.mode, 'recon-first')
})

test('internal-agent: supports three operation modes', () => {
  assert.equal(new InternalAgent({ mode: 'recon-first' }).config.mode, 'recon-first')
  assert.equal(new InternalAgent({ mode: 'speed-run' }).config.mode, 'speed-run')
  assert.equal(new InternalAgent({ mode: 'stealth' }).config.mode, 'stealth')
})

test('internal-agent: infers /24 network range from host IP', () => {
  const agent = new InternalAgent()
  assert.equal(agent._inferNetworkRange('192.168.1.100'), '192.168.1.0/24')
})

test('internal-agent: classifies assets by port-count risk', () => {
  const agent = new InternalAgent()
  const analysis = agent._analyzeAssets([
    { ip: '192.168.1.10', ports: [22, 80, 443, 3306, 5432] },
    { ip: '192.168.1.20', ports: [22, 80] },
    { ip: '192.168.1.30', ports: [3389] },
  ])
  assert.equal(analysis.highRisk.length, 1)
  assert.equal(analysis.mediumRisk.length, 1)
  assert.equal(analysis.lowRisk.length, 1)
})

test('internal-agent: maps ports to attack methods', () => {
  const agent = new InternalAgent()
  const methods = agent._getAttackMethodsForAsset({
    ip: '192.168.1.100', ports: [22, 139, 445, 1433, 5985],
  })
  assert.deepEqual(methods, ['ssh', 'smb', 'smb', 'db', 'winrm'])
})

test('internal-agent: tracks discovered assets', () => {
  const agent = new InternalAgent()
  agent.discoveredAssets.set('192.168.1.10', { ip: '192.168.1.10', services: ['ssh'] })
  agent.discoveredAssets.set('192.168.1.20', { ip: '192.168.1.20', services: ['smb'] })
  assert.equal(agent.getDiscoveredAssets().length, 2)
})

test('internal-agent: tracks compromised hosts', () => {
  const agent = new InternalAgent()
  agent.compromisedHosts.push({
    ip: '192.168.1.10', access_level: 'admin',
    credentials: { username: 'admin', password: 'pass' },
  })
  const hosts = agent.getCompromisedHosts()
  assert.equal(hosts.length, 1)
  assert.equal(hosts[0].access_level, 'admin')
})

test('internal-agent: tracks operation history', () => {
  const agent = new InternalAgent()
  agent.operationHistory.push({
    auditId: 'test-123', startingHost: '192.168.1.100', mode: 'recon-first', success: true,
  })
  const history = agent.getOperationHistory()
  assert.equal(history.length, 1)
  assert.equal(history[0].mode, 'recon-first')
})

test('internal-agent: report is sanitized (no raw hosts)', () => {
  const agent = new InternalAgent()
  agent.discoveredAssets.set('192.168.1.10', { ip: '192.168.1.10' })
  agent.discoveredAssets.set('192.168.1.20', { ip: '192.168.1.20' })
  agent.compromisedHosts.push({ ip: '192.168.1.10', access_level: 'admin' })
  agent.operationHistory.push({ auditId: 'test-123' })

  const report = agent.generateReport()
  assert.equal(report.total_assets_discovered, 2)
  assert.equal(report.total_hosts_compromised, 1)
  assert.equal(report.operations_count, 1)
  assert.equal(report._sanitized, true)
  // 脱敏：报告不得回显原始 IP
  assert.equal(JSON.stringify(report).includes('192.168.1.10'), false)
})

test('internal-agent: audit ids are unique and prefixed', () => {
  const agent = new InternalAgent()
  const id1 = agent._generateAuditId()
  const id2 = agent._generateAuditId()
  assert.ok(id1.startsWith('internal_'))
  assert.ok(id2.startsWith('internal_'))
  assert.notEqual(id1, id2)
})

test('internal-agent: config options are honoured', () => {
  const agent = new InternalAgent({
    dryRun: false, maxParallel: 20, commandTimeout: 60000,
    cleanupOnComplete: true, mode: 'speed-run',
  })
  assert.equal(agent.config.dryRun, false)
  assert.equal(agent.config.maxParallel, 20)
  assert.equal(agent.config.commandTimeout, 60000)
  assert.equal(agent.config.cleanupOnComplete, true)
  assert.equal(agent.config.mode, 'speed-run')
})

test('internal-agent: dry-run chain returns audit id and stops on empty recon', async () => {
  const agent = new InternalAgent({ dryRun: true })
  // 目标无存活主机：不得伪造入侵结果
  agent.recon.scanLiveHosts = async () => ({ success: true, hosts: [] })

  const result = await agent.executeInternalChain(
    '192.168.1.100',
    { username: 'admin', password: 'pass', type: 'local' },
    'recon-first',
    {},
  )

  assert.equal(result.success, false, 'no live hosts must not claim success')
  assert.ok(result.audit_id)
  assert.ok(Array.isArray(result.chain))
})

test('internal-agent: recon failure is reported, not swallowed', async () => {
  const agent = new InternalAgent({ dryRun: true })
  agent.recon.scanLiveHosts = async () => { throw new Error('Network unreachable') }

  const result = await agent.executeInternalChain(
    '192.168.1.100',
    { username: 'admin', password: 'pass' },
  )

  assert.equal(result.success, false)
  assert.ok(result.error)
  assert.ok(result.audit_id)
})

test('internal-agent: cleanup delegates to anti-forensics agent', async () => {
  const agent = new InternalAgent({ dryRun: true })
  agent.compromisedHosts = [
    { ip: '192.168.1.10', os: 'Windows' },
    { ip: '192.168.1.20', os: 'Linux' },
  ]
  agent.forensics.executeFullCleanup = async () => ({
    success: true,
    cleaned: ['192.168.1.10', '192.168.1.20'],
    auditId: 'cleanup-123',
  })

  const result = await agent.cleanup('chain-123', { strategy: 'comprehensive' })
  assert.equal(result.success, true)
  assert.equal(result.cleaned, 2)
})
