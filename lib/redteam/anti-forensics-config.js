/**
 * 防溯源配置管理模块（Anti-Forensics Configuration Manager）
 * 
 * 负责：
 * 1. 防溯源隐私等级定义与选择
 * 2. 清除范围管理（哪些能力开启/关闭）
 * 3. 目标平台检测与能力过滤
 * 4. 策略验证与冲突检测
 */

import { platform as getPlatform } from 'node:os'

/**
 * 隐私等级定义
 * 从最宽松到最严格
 */
const PRIVACY_LEVELS = {
  minimal: {
    id: 'minimal',
    label: '最小化清除',
    description: '仅清除明确的恶意工件（shell history、浏览历史）',
    cleanupScope: ['shellhistory-cleanup', 'browser-history-nuke'],
    riskLevel: 'low',
    estimatedTime: 30, // 秒
  },
  basic: {
    id: 'basic',
    label: '基础清除',
    description: '清除常见取证痕迹（日志、网络抓包、文件元数据）',
    cleanupScope: [
      'shellhistory-cleanup',
      'browser-history-nuke',
      'eventlog-purge-windows',
      'syslog-erase-linux',
      'journal-erase-systemd',
      'network-capture-wipe',
      'file-metadata-spoof',
      'timestamp-spoofing',
    ],
    riskLevel: 'medium',
    estimatedTime: 120,
  },
  comprehensive: {
    id: 'comprehensive',
    label: '完整清除',
    description: '清除系统级与应用级所有痕迹（包括内存、交换分区、防火墙日志）',
    cleanupScope: [
      'shellhistory-cleanup',
      'browser-history-nuke',
      'eventlog-purge-windows',
      'syslog-erase-linux',
      'journal-erase-systemd',
      'network-capture-wipe',
      'proxy-log-cleanup',
      'firewall-log-erase',
      'file-metadata-spoof',
      'memory-forensics-anti',
      'swap-wipe',
      'hibernation-file-delete',
      'command-audit-disable',
      'timestamp-spoofing',
    ],
    riskLevel: 'high',
    estimatedTime: 300,
  },
  extreme: {
    id: 'extreme',
    label: '极限清除',
    description: '最大化清除覆盖，包括安全覆写与证物发现评估',
    cleanupScope: [
      'artifact-discovery',
      'file-secure-delete',
      'file-metadata-spoof',
      'shellhistory-cleanup',
      'browser-history-nuke',
      'eventlog-purge-windows',
      'syslog-erase-linux',
      'journal-erase-systemd',
      'network-capture-wipe',
      'proxy-log-cleanup',
      'firewall-log-erase',
      'memory-forensics-anti',
      'swap-wipe',
      'hibernation-file-delete',
      'command-audit-disable',
      'timestamp-spoofing',
      'anti-forensics-timeline-desync',
    ],
    riskLevel: 'critical',
    estimatedTime: 600,
  },
}

/**
 * 清除策略映射（与 forensics-evasion-orchestrator 对应）
 */
const STRATEGY_MAPPING = {
  safe: 'minimal',
  balanced: 'comprehensive',
  aggressive: 'extreme',
}

/**
 * 平台特定能力过滤
 */
const PLATFORM_CAPABILITIES = {
  Windows: {
    supported: ['eventlog-purge-windows', 'hibernation-file-delete', 'file-metadata-spoof', 'browser-history-nuke'],
    unsupported: ['syslog-erase-linux', 'journal-erase-systemd', 'swap-wipe'],
  },
  Linux: {
    supported: ['syslog-erase-linux', 'journal-erase-systemd', 'swap-wipe', 'memory-forensics-anti'],
    unsupported: ['eventlog-purge-windows', 'hibernation-file-delete'],
  },
  Darwin: {
    supported: ['browser-history-nuke', 'file-metadata-spoof', 'memory-forensics-anti'],
    unsupported: ['syslog-erase-linux', 'eventlog-purge-windows', 'swap-wipe'],
  },
}

/**
 * 防溯源配置类
 */
class AntiForensicsConfig {
  constructor(options = {}) {
    this.privacyLevel = options.privacyLevel || 'comprehensive'
    this.strategy = options.strategy || 'balanced'
    this.platform = options.platform || getPlatform()
    this.customCapabilities = options.customCapabilities || null
    this.dryRun = options.dryRun !== false
    this.auditLogPath = options.auditLogPath || null
    this.rollbackEnabled = options.rollbackEnabled !== false
    this.verificationEnabled = options.verificationEnabled !== false
  }

  /**
   * 验证配置有效性
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = []

    if (!PRIVACY_LEVELS[this.privacyLevel]) {
      errors.push(`Invalid privacy level: ${this.privacyLevel}. Valid: ${Object.keys(PRIVACY_LEVELS).join(', ')}`)
    }

    if (this.strategy && !['safe', 'balanced', 'aggressive'].includes(this.strategy)) {
      errors.push(`Invalid strategy: ${this.strategy}. Valid: safe, balanced, aggressive`)
    }

    const normalizedPlatform = this._normalizePlatform()
    if (!PLATFORM_CAPABILITIES[normalizedPlatform]) {
      errors.push(`Unsupported platform: ${this.platform}`)
    }

    if (this.customCapabilities && !Array.isArray(this.customCapabilities)) {
      errors.push('customCapabilities must be an array')
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * 获取应用于该配置的清除能力列表
   * @returns {string[]} 能力 ID 数组
   */
  getApplicableCapabilities() {
    // 自定义能力优先级最高
    if (this.customCapabilities && Array.isArray(this.customCapabilities)) {
      return this._filterByPlatform(this.customCapabilities)
    }

    // 其次使用隐私等级配置
    const level = PRIVACY_LEVELS[this.privacyLevel]
    if (level) {
      return this._filterByPlatform(level.cleanupScope)
    }

    // 最后降级到策略映射
    const mappedLevel = STRATEGY_MAPPING[this.strategy] || 'comprehensive'
    const capabilities = PRIVACY_LEVELS[mappedLevel]?.cleanupScope || []
    return this._filterByPlatform(capabilities)
  }

  /**
   * 按平台过滤能力（移除不支持的）
   * @private
   */
  _filterByPlatform(capabilities) {
    const normalizedPlatform = this._normalizePlatform()
    const platformConfig = PLATFORM_CAPABILITIES[normalizedPlatform]

    if (!platformConfig) {
      return capabilities
    }

    return capabilities.filter((capId) => {
      // 如果在不支持列表中，剔除
      if (platformConfig.unsupported.includes(capId)) {
        return false
      }
      return true
    })
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
   * 获取当前配置的元数据
   */
  getMetadata() {
    const capabilities = this.getApplicableCapabilities()
    const level = PRIVACY_LEVELS[this.privacyLevel]

    return {
      privacyLevel: this.privacyLevel,
      strategy: this.strategy,
      platform: this._normalizePlatform(),
      capabilityCount: capabilities.length,
      riskLevel: level?.riskLevel || 'unknown',
      estimatedTime: level?.estimatedTime || 0,
      dryRun: this.dryRun,
      rollbackEnabled: this.rollbackEnabled,
      verificationEnabled: this.verificationEnabled,
    }
  }

  /**
   * 生成配置摘要（用于日志记录）
   */
  summarize() {
    const level = PRIVACY_LEVELS[this.privacyLevel]
    return {
      privacyLevel: `${this.privacyLevel} - ${level?.label || 'unknown'}`,
      description: level?.description || 'No description available',
      capabilityCount: this.getApplicableCapabilities().length,
      platform: this._normalizePlatform(),
      mode: this.dryRun ? 'DRY RUN' : 'EXECUTE',
    }
  }
}

export {
  AntiForensicsConfig,
  PRIVACY_LEVELS,
  STRATEGY_MAPPING,
  PLATFORM_CAPABILITIES,
}
