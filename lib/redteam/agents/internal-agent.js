/**
 * InternalAgent — 红队作战智能体（内网渗透编排）
 *
 * 核心职责：通过已有隧道做纵深渗透
 *   内网侦察 → 目标识别 → 横向移动 → 权限提升 → 数据窃取 → 防溯源清理
 *
 * 三种模式：
 *   - recon-first：完整侦察后按风险排序逐个打
 *   - speed-run：并行快速横向，尽快扩张
 *   - stealth：低速串行，避免 IDS / 防火墙告警
 *
 * 硬约束：
 *   1. 默认 dryRun，不执行任何目标侧操作
 *   2. 只调用下层模块的真实方法签名
 *   3. 报告脱敏（不含内网 IP 明文）
 */

import { InternalRecon } from '../internal-recon.js'
import { LateralExecutor } from '../lateral-executor.js'
import { PrivescEngine } from '../privesc-engine.js'
import { DataExfiltration } from '../data-exfiltration.js'
import { AntiForensicsAgent } from '../anti-forensics-agent.js'

export class InternalAgent {
  constructor(options = {}) {
    this.recon = new InternalRecon(options)
    this.lateral = new LateralExecutor(options)
    this.privesc = new PrivescEngine(options)
    this.exfiltration = new DataExfiltration(options)
    this.forensics = new AntiForensicsAgent(options)
    this.config = {
      dryRun: options.dryRun !== false,
      maxParallel: options.maxParallel || 5,
      commandTimeout: options.commandTimeout || 30000,
      cleanupOnComplete: options.cleanupOnComplete !== false,
      mode: options.mode || 'recon-first',
      auditStore: options.store || null,
      ...options,
    }
    this.operationHistory = []
    this.discoveredAssets = new Map()
    this.compromisedHosts = []
  }

  /* ───────────────────────── 主入口 ───────────────────────── */

  /**
   * 内网渗透主流程
   * @param {string} startingHost
   * @param {Object} startingCreds - { username, password, type }
   * @param {string} mode - recon-first | speed-run | stealth
   * @param {Object} options
   */
  async executeInternalChain(startingHost, _startingCreds, mode = 'recon-first', _options = {}) {
    const auditId = this._generateAuditId()
    if (!startingHost) {
      return { success: false, status: 'invalid-input', reason: 'starting_host_required', chain: [], audit_id: auditId }
    }

    // InternalRecon/LateralExecutor still contain fixture responses and no real adapters.
    // Never run those fixtures through the campaign pipeline or report them as discoveries.
    if (this.config.dryRun) {
      return {
        success: false,
        status: 'simulated',
        simulated: true,
        actual_execution: false,
        reason: 'dry_run_simulation_only',
        mode,
        planned_stages: ['internal-reconnaissance', 'asset-review', 'access-validation', 'evidence-review'],
        assets_discovered: null,
        hosts_compromised: null,
        data_sources: null,
        chain: [],
        audit_id: auditId,
      }
    }

    // Fail closed until real, scope-aware adapters are wired to the configured environment.
    return {
      success: false,
      status: 'unsupported',
      simulated: false,
      actual_execution: false,
      reason: 'internal_campaign_execution_not_implemented',
      mode,
      planned_stages: [],
      assets_discovered: null,
      hosts_compromised: null,
      data_sources: null,
      chain: [],
      audit_id: auditId,
    }
  }

  /* ───────────────────────── 侦察 ───────────────────────── */

  async _performReconnaissance(startingHost, startingCreds, options = {}) {
    const steps = []
    const assets = []

    try {
      // 真实签名：scanLiveHosts(networkRange)
      const range = options.targetNetwork || this._inferNetworkRange(startingHost)
      const scan = await this.recon.scanLiveHosts(range)
      const hosts = scan && Array.isArray(scan.hosts) ? scan.hosts : []

      steps.push({ stage: 'live-hosts-scan', range, found: hosts.length, dryRun: this.config.dryRun, timestamp: Date.now() })

      for (const host of hosts) {
        const ip = typeof host === 'string' ? host : host.ip
        if (!ip) continue

        // 真实签名：scanPorts(ip)
        const portScan = await this.recon.scanPorts(ip)
        const ports = portScan && Array.isArray(portScan.ports) ? portScan.ports : []

        // 真实签名：getServiceFingerprint(ip, port) — 逐个端口取指纹
        const services = []
        for (const entry of ports.slice(0, 10)) {
          const fp = await this.recon.getServiceFingerprint(ip, entry.port)
          if (fp && fp.success) services.push({ port: entry.port, service: fp.service, version: fp.version })
        }

        assets.push({ ip, ports: ports.map((p) => p.port), services, timestamp: Date.now() })
        steps.push({
          stage: 'asset-profile',
          host: ip,
          open_ports: ports.length,
          services: services.length,
          dryRun: this.config.dryRun,
          timestamp: Date.now(),
        })
      }

      // 域环境补一轮 LDAP（真实签名：queryLDAP(dc, creds)）
      if (startingCreds && startingCreds.type === 'domain') {
        const ldap = await this.recon.queryLDAP(startingHost, startingCreds)
        if (ldap && ldap.success) {
          steps.push({
            stage: 'domain-recon',
            users: ldap.users ? ldap.users.length : 0,
            computers: ldap.computers ? ldap.computers.length : 0,
            timestamp: Date.now(),
          })
          for (const c of ldap.computers || []) {
            if (c.name && !assets.some((a) => a.ip === c.name)) {
              assets.push({ ip: c.name, hostname: c.name, domain_member: true, os: c.os, ports: [], services: [] })
            }
          }
        }
      }

      return { success: assets.length > 0, assets, steps }
    } catch (err) {
      steps.push({ stage: 'recon-error', error: err.message, timestamp: Date.now() })
      return { success: false, error: err.message, assets: [], steps }
    }
  }

  /* ───────────────────────── 扩张策略 ───────────────────────── */

  async _reconFirstExpand(assets, baseCreds, options = {}) {
    const steps = []
    const compromised = []
    const analysis = this._analyzeAssets(assets)

    steps.push({
      stage: 'risk-analysis',
      high: analysis.highRisk.length,
      medium: analysis.mediumRisk.length,
      low: analysis.lowRisk.length,
      timestamp: Date.now(),
    })

    for (const target of analysis.highRisk) {
      const attack = await this._attackTarget(target, baseCreds, options)
      steps.push({
        stage: 'targeted-attack',
        host: target.ip,
        success: attack.success === true,
        method: attack.method || null,
        dryRun: this.config.dryRun,
        timestamp: Date.now(),
      })
      if (attack.success) compromised.push({
        ip: target.ip,
        credentials: attack.credential || null,
        access_level: attack.access_level,
      })
    }

    return { success: compromised.length > 0, compromised, steps }
  }

  async _speedRunExpand(assets, baseCreds, options = {}) {
    const steps = []
    const compromised = []

    for (let i = 0; i < assets.length; i += this.config.maxParallel) {
      const batch = assets.slice(i, i + this.config.maxParallel)
      const results = await Promise.allSettled(
        batch.map((a) => this._attackTarget(a, baseCreds, options).then((r) => ({ ...r, host: a.ip }))),
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.success) {
          compromised.push({ ip: r.value.host, credentials: r.value.credential || null, access_level: r.value.access_level })
        }
      }
    }

    steps.push({
      stage: 'parallel-attacks',
      attempted: assets.length,
      compromised: compromised.length,
      dryRun: this.config.dryRun,
      timestamp: Date.now(),
    })

    return { success: compromised.length > 0, compromised, steps }
  }

  async _stealthExpand(assets, baseCreds, options = {}) {
    const steps = []
    const compromised = []

    for (const asset of assets) {
      const attack = await this._attackTarget(asset, baseCreds, { ...options, lowSpeed: true })
      steps.push({
        stage: 'stealth-attack',
        host: asset.ip,
        success: attack.success === true,
        method: attack.method || null,
        dryRun: this.config.dryRun,
        timestamp: Date.now(),
      })
      if (attack.success) compromised.push({
        ip: asset.ip,
        credentials: attack.credential || null,
        access_level: attack.access_level,
      })
    }

    return { success: compromised.length > 0, compromised, steps }
  }

  /* ───────────────────────── 单目标攻击 ───────────────────────── */

  async _attackTarget(asset, baseCreds, options = {}) {
    const methods = this._getAttackMethodsForAsset(asset)
    const creds = {
      username: baseCreds && baseCreds.username ? baseCreds.username : null,
      password: baseCreds && baseCreds.password ? baseCreds.password : null,
      domain: baseCreds && baseCreds.domain ? baseCreds.domain : undefined,
    }

    for (const method of methods) {
      try {
        let result = null

        // 全部使用真实签名：executeSSH(ip, creds, command) / executeWinRM(ip, creds, command)
        if (method === 'ssh') {
          result = await this.lateral.executeSSH(asset.ip, creds, 'id')
        } else if (method === 'smb') {
          result = await this.lateral.transferFileSMB(asset.ip, creds, null, null)
        } else if (method === 'winrm') {
          result = await this.lateral.executeWinRM(asset.ip, creds, 'whoami')
        } else if (method === 'db') {
          result = await this.lateral.passwordSpray(asset.ip, 'db', [creds.username], [creds.password])
        }

        if (result && result.success) {
          let accessLevel = baseCreds && baseCreds.type === 'admin' || baseCreds && baseCreds.type === 'sa'
            ? 'admin' : 'user'

          if (accessLevel !== 'admin') {
            const osType = (asset.os || '').toLowerCase().includes('windows') ? 'windows' : 'linux'
            // 真实签名：identifyPrivescOpportunities(ip, creds, osType)
            const ident = await this.privesc.identifyPrivescOpportunities(
              asset.ip,
              { username: creds.username, currentPrivilege: 'user' },
              osType,
            )
            if (ident && Array.isArray(ident.opportunities) && ident.opportunities.length > 0) {
              accessLevel = 'admin-candidate'
            }
          }

          return { success: true, method, credential: creds, access_level: accessLevel }
        }
      } catch {
        continue
      }
    }

    return { success: false, error: 'all_methods_failed' }
  }

  /* ───────────────────────── 数据窃取 ───────────────────────── */

  async _exfiltrateData(hosts, options = {}) {
    const steps = []
    const dataSources = []

    for (const host of hosts) {
      const creds = host.credentials || { username: null, password: null }

      // 真实签名：scanSensitiveFiles(ip, creds, options)
      const files = await this.exfiltration.scanSensitiveFiles(host.ip, creds, {})
      const found = files && Array.isArray(files.files) ? files.files.length : 0
      steps.push({
        stage: 'sensitive-file-scan',
        host: host.ip,
        found,
        dryRun: this.config.dryRun,
        timestamp: Date.now(),
      })
      if (found > 0) dataSources.push({ host: host.ip, source: 'files', count: found })

      // 真实签名：harvestCredentials(ip, creds, target)
      const harvested = await this.exfiltration.harvestCredentials(host.ip, creds, 'browser')
      const credCount = harvested && Array.isArray(harvested.credentials) ? harvested.credentials.length : 0
      if (credCount > 0) dataSources.push({ host: host.ip, source: 'credentials', count: credCount })
    }

    return { success: dataSources.length > 0, data_sources: dataSources, steps }
  }

  /* ───────────────────────── 收尾 / 报告 ───────────────────────── */

  async cleanup(auditId, options = {}) {
    try {
      const result = await this.forensics.executeFullCleanup(
        { auditId },
        options.strategy || 'balanced',
        'auto',
      )
      return {
        success: result && result.success !== false,
        cleaned: result && Array.isArray(result.cleaned) ? result.cleaned.length : 0,
        audit_id: result && result.auditId ? result.auditId : auditId,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  generateReport() {
    return {
      total_assets_discovered: this.discoveredAssets.size,
      total_hosts_compromised: this.compromisedHosts.length,
      operations_count: this.operationHistory.length,
      timestamp: Date.now(),
      _sanitized: true,
    }
  }

  /* ───────────────────────── 内部工具 ───────────────────────── */

  _inferNetworkRange(ip) {
    const parts = String(ip).split('.')
    if (parts.length !== 4) return ip
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }

  _analyzeAssets(assets = []) {
    const highRisk = [], mediumRisk = [], lowRisk = []
    for (const asset of assets) {
      const score = Array.isArray(asset.ports) ? asset.ports.length : 0
      if (score >= 5) highRisk.push(asset)
      else if (score >= 2) mediumRisk.push(asset)
      else lowRisk.push(asset)
    }
    return { highRisk, mediumRisk, lowRisk }
  }

  _getAttackMethodsForAsset(asset) {
    const methods = []
    for (const port of asset.ports || []) {
      if (port === 22) methods.push('ssh')
      else if (port === 139 || port === 445) methods.push('smb')
      else if (port === 5985 || port === 5986) methods.push('winrm')
      else if (port === 1433 || port === 3306 || port === 5432) methods.push('db')
    }
    return methods
  }

  _record(auditId, startingHost, mode, steps, success) {
    this.operationHistory.push({
      auditId,
      startingHost,
      mode,
      steps,
      success: success === true,
      timestamp: Date.now(),
    })
    if (this.operationHistory.length > 200) this.operationHistory.shift()
  }

  _generateAuditId() {
    return `internal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  getOperationHistory() { return this.operationHistory.slice() }
  getDiscoveredAssets() { return Array.from(this.discoveredAssets.values()) }
  getCompromisedHosts() { return this.compromisedHosts.slice() }
}
