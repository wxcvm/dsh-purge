/**
 * 防溯源隐私姿态评估模块（Anti-Forensics Privacy Posture）
 * 
 * 评估系统在防溯源方面的风险状态：
 * 1. 证物泄露风险识别
 * 2. 取证可用性评估
 * 3. 清除能力就绪检查
 * 4. 平台特定的漏洞分析
 */

import { execSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { platform as getPlatform } from 'node:os'
import { join } from 'node:path'

/**
 * 证物风险等级
 */
const ARTIFACT_RISK_LEVELS = {
  critical: 'CRITICAL', // 直接暴露关键活动证据
  high: 'HIGH', // 易被取证工具发现
  medium: 'MEDIUM', // 需要特殊工具才能提取
  low: 'LOW', // 技术成本高或关键度低
  info: 'INFO', // 仅供参考
}

/**
 * 已知的常见证物位置与风险
 */
const FORENSIC_ARTIFACTS = {
  Windows: [
    {
      path: 'C:\\Windows\\System32\\winevt\\Logs\\',
      name: 'Windows Event Logs',
      riskLevel: ARTIFACT_RISK_LEVELS.critical,
      description: '包含所有系统/安全/应用事件',
      cleanable: true,
      capability: 'eventlog-purge-windows',
    },
    {
      path: 'C:\\Users\\*\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadline\\',
      name: 'PowerShell Command History',
      riskLevel: ARTIFACT_RISK_LEVELS.high,
      description: 'PSReadline 命令历史',
      cleanable: true,
      capability: 'shellhistory-cleanup',
    },
    {
      path: 'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\UsrClass.dat',
      name: 'User Registry (MRU/Links)',
      riskLevel: ARTIFACT_RISK_LEVELS.high,
      description: '最近使用文件、快捷方式',
      cleanable: true,
      capability: 'file-metadata-spoof',
    },
    {
      path: 'C:\\hiberfil.sys',
      name: 'Hibernation File',
      riskLevel: ARTIFACT_RISK_LEVELS.high,
      description: '休眠文件含完整内存转储',
      cleanable: true,
      capability: 'hibernation-file-delete',
    },
    {
      path: 'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\History',
      name: 'Chrome Browser History',
      riskLevel: ARTIFACT_RISK_LEVELS.medium,
      description: '访问历史、搜索记录、下载',
      cleanable: true,
      capability: 'browser-history-nuke',
    },
  ],
  Linux: [
    {
      path: '/var/log/auth.log',
      name: 'Authentication Log',
      riskLevel: ARTIFACT_RISK_LEVELS.critical,
      description: '登录、权限提升、ssh 活动',
      cleanable: true,
      capability: 'syslog-erase-linux',
    },
    {
      path: '/var/log/syslog',
      name: 'System Log',
      riskLevel: ARTIFACT_RISK_LEVELS.high,
      description: '系统事件、守护进程活动',
      cleanable: true,
      capability: 'syslog-erase-linux',
    },
    {
      path: '/var/log/audit/audit.log',
      name: 'Audit Log',
      riskLevel: ARTIFACT_RISK_LEVELS.critical,
      description: 'auditd 审计日志（高保真）',
      cleanable: true,
      capability: 'command-audit-disable',
    },
    {
      path: '/var/log/journal/',
      name: 'Systemd Journal',
      riskLevel: ARTIFACT_RISK_LEVELS.high,
      description: 'systemd-journald 日志数据库',
      cleanable: true,
      capability: 'journal-erase-systemd',
    },
    {
      path: '/root/.bash_history',
      name: 'Bash Command History',
      riskLevel: ARTIFACT_RISK_LEVELS.high,
      description: 'shell 命令执行历史',
      cleanable: true,
      capability: 'shellhistory-cleanup',
    },
    {
      path: '/home/*/.bash_history',
      name: 'User Bash History',
      riskLevel: ARTIFACT_RISK_LEVELS.medium,
      description: '用户级 shell 历史',
      cleanable: true,
      capability: 'shellhistory-cleanup',
    },
  ],
}

/**
 * 防溯源隐私姿态评估类
 */
class AntiForensicsPosture {
  constructor(options = {}) {
    this.platform = options.platform || getPlatform()
    this.checkTimestamp = new Date().toISOString()
  }

  /**
   * 执行完整的隐私姿态评估
   * @returns {Promise<PostureReport>}
   */
  async assess() {
    const normalizedPlatform = this._normalizePlatform()
    const artifacts = this._getArtifactsForPlatform(normalizedPlatform)

    const artifactStatus = await Promise.all(
      artifacts.map((artifact) => this._checkArtifact(artifact, normalizedPlatform)),
    )

    const riskSummary = this._summarizeRisks(artifactStatus)
    const recommendations = this._generateRecommendations(artifactStatus, normalizedPlatform)

    return {
      timestamp: this.checkTimestamp,
      platform: normalizedPlatform,
      overallRisk: riskSummary.overallRisk,
      criticalCount: riskSummary.criticalCount,
      highCount: riskSummary.highCount,
      mediumCount: riskSummary.mediumCount,
      artifacts: artifactStatus,
      recommendations,
      summary: {
        total: artifactStatus.length,
        detectable: artifactStatus.filter((a) => a.exists).length,
        cleanableCount: artifactStatus.filter((a) => a.cleanable).length,
      },
    }
  }

  /**
   * 检查单个证物是否存在
   * @private
   */
  async _checkArtifact(artifact, platform) {
    const exists = this._artifactExists(artifact.path, platform)

    return {
      name: artifact.name,
      path: artifact.path,
      riskLevel: artifact.riskLevel,
      description: artifact.description,
      exists,
      cleanable: artifact.cleanable,
      capability: artifact.capability,
      status: exists ? 'present' : 'absent',
      forensicValue: exists ? 'high' : 'none',
    }
  }

  /**
   * 检查证物路径是否存在
   * 支持通配符 * 匹配
   * @private
   */
  _artifactExists(pathPattern, platform) {
    if (platform === 'Windows' && !this._isWindows()) return null
    if (platform === 'Linux' && !this._isLinux()) return null

    if (!pathPattern.includes('*')) {
      return existsSync(pathPattern)
    }

    // 简单的通配符支持：/path/*/file
    const parts = pathPattern.split('*')
    if (parts.length === 2) {
      try {
        // 对于 /home/*/.bash_history，检查 /home 目录是否存在
        const baseDir = parts[0]
        return existsSync(baseDir)
      } catch {
        return false
      }
    }

    return false
  }

  /**
   * 总结风险等级
   * @private
   */
  _summarizeRisks(artifacts) {
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    }

    for (const artifact of artifacts) {
      if (artifact.exists) {
        const level = artifact.riskLevel.toLowerCase()
        if (counts.hasOwnProperty(level)) {
          counts[level]++
        }
      }
    }

    let overallRisk = 'low'
    if (counts.critical > 0) overallRisk = 'critical'
    else if (counts.high > 2) overallRisk = 'high'
    else if (counts.medium > 3) overallRisk = 'medium'

    return {
      overallRisk,
      criticalCount: counts.critical,
      highCount: counts.high,
      mediumCount: counts.medium,
      lowCount: counts.low,
    }
  }

  /**
   * 生成清除建议
   * @private
   */
  _generateRecommendations(artifacts, platform) {
    const recommendations = []

    // 按风险等级分组建议
    const critical = artifacts.filter((a) => a.riskLevel === ARTIFACT_RISK_LEVELS.critical && a.exists)
    if (critical.length > 0) {
      recommendations.push({
        priority: 'URGENT',
        title: `清除 ${critical.length} 个关键证物`,
        description: '以下证物位置含关键活动证据，应立即清除',
        artifacts: critical.map((a) => ({ name: a.name, capability: a.capability })),
      })
    }

    const high = artifacts.filter((a) => a.riskLevel === ARTIFACT_RISK_LEVELS.high && a.exists)
    if (high.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        title: `清除 ${high.length} 个高风险证物`,
        description: '易被标准取证工具发现',
        artifacts: high.map((a) => ({ name: a.name, capability: a.capability })),
      })
    }

    // 能力检查建议
    const cleanableNotFound = artifacts.filter((a) => a.cleanable && !a.exists)
    if (cleanableNotFound.length > 0) {
      recommendations.push({
        priority: 'INFO',
        title: '可清除能力未发现目标',
        description: `${cleanableNotFound.length} 个清除能力对应的证物不存在，可能已被清除或不适用`,
      })
    }

    return recommendations
  }

  /**
   * 获取平台对应的证物列表
   * @private
   */
  _getArtifactsForPlatform(platform) {
    if (platform === 'Windows') {
      return FORENSIC_ARTIFACTS.Windows || []
    }
    if (platform === 'Linux') {
      return FORENSIC_ARTIFACTS.Linux || []
    }
    return []
  }

  /**
   * 标准化平台名称
   * @private
   */
  _normalizePlatform() {
    const p = this.platform.toLowerCase()
    if (p === 'win32') return 'Windows'
    if (p === 'linux') return 'Linux'
    if (p === 'darwin') return 'Darwin'
    return p
  }

  /**
   * 检查是否运行在 Windows
   * @private
   */
  _isWindows() {
    return this._normalizePlatform() === 'Windows'
  }

  /**
   * 检查是否运行在 Linux
   * @private
   */
  _isLinux() {
    return this._normalizePlatform() === 'Linux'
  }

  /**
   * 生成可读的隐私状态总结
   */
  summarize(report) {
    return {
      overallRisk: report.overallRisk,
      message: `检测到 ${report.summary.detectable} 个存在的证物，其中 ${report.summary.cleanableCount} 个可清除`,
      criticalIssues: report.criticalCount,
      recommendations: report.recommendations.map((r) => r.title),
    }
  }
}

export { AntiForensicsPosture, FORENSIC_ARTIFACTS, ARTIFACT_RISK_LEVELS }
