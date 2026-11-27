/**
 * Linux 反溯源 Agent
 * 
 * 负责 Linux 特定的痕迹清除任务：
 * - Syslog/Auth.log/Audit.log 清除
 * - Shell 历史清除（Bash/Zsh/Ksh/Tcsh）
 * - Systemd Journal 清除
 * - 临时文件清除
 * - 安全删除（shred/wipe）
 * - 交换分区清除
 * - 审计日志禁用
 * 
 * 设计原则：
 * - 权限检查：需要 Root 权限
 * - 可验证性：每个操作返回成功/失败状态
 * - 恢复友好：记录关键操作便于手动恢复
 */

import { EventEmitter } from 'events';

const LINUX_FORENSICS_CAPABILITIES = {
  'syslog-auth-erase': {
    name: 'Auth.log 清除',
    path: '/var/log/auth.log',
    command: 'rm -f /var/log/auth.log /var/log/auth.log.*',
    requiresRoot: true,
    reversible: false,
  },
  'syslog-syslog-erase': {
    name: 'Syslog 清除',
    path: '/var/log/syslog',
    command: 'rm -f /var/log/syslog /var/log/syslog.*',
    requiresRoot: true,
    reversible: false,
  },
  'syslog-audit-erase': {
    name: 'Audit.log 清除',
    path: '/var/log/audit',
    command: 'rm -f /var/log/audit/audit.log /var/log/audit/audit.log.*',
    requiresRoot: true,
    reversible: false,
  },
  'journal-erase-systemd': {
    name: 'Systemd Journal 清除',
    command: 'journalctl --rotate && journalctl --vacuum=1s',
    requiresRoot: true,
    reversible: false,
  },
  'bash-history-clear': {
    name: 'Bash 历史清除',
    paths: ['~/.bash_history', '/root/.bash_history'],
    command: 'rm -f ~/.bash_history /root/.bash_history && history -c',
    requiresRoot: false,
    reversible: false,
  },
  'zsh-history-clear': {
    name: 'Zsh 历史清除',
    paths: ['~/.zsh_history', '/root/.zsh_history'],
    command: 'rm -f ~/.zsh_history /root/.zsh_history',
    requiresRoot: false,
    reversible: false,
  },
  'ksh-history-clear': {
    name: 'Ksh 历史清除',
    paths: ['~/.sh_history'],
    command: 'rm -f ~/.sh_history',
    requiresRoot: false,
    reversible: false,
  },
  'tcsh-history-clear': {
    name: 'Tcsh 历史清除',
    paths: ['~/.history'],
    command: 'rm -f ~/.history',
    requiresRoot: false,
    reversible: false,
  },
  'file-secure-delete': {
    name: '文件安全删除',
    algorithms: ['shred', 'wipe', 'dd'],
    command: 'shred -vfz -n 3 [FILE]',
    requiresRoot: false,
    reversible: false,
  },
  'swap-wipe': {
    name: 'Swap 分区清除',
    command: 'swapoff -a && dd if=/dev/zero of=/swapfile bs=1M && mkswap /swapfile && swapon -a',
    requiresRoot: true,
    reversible: false,
    riskLevel: 'high',
  },
  'tmp-cleanup': {
    name: '/tmp 清除',
    paths: ['/tmp', '/var/tmp'],
    command: 'find /tmp -type f -delete; find /var/tmp -type f -delete',
    requiresRoot: false,
    reversible: false,
  },
  'audit-disable': {
    name: '审计日志禁用',
    command: 'systemctl stop auditd && auditctl -D',
    requiresRoot: true,
    reversible: true,
  },
  'audit-rules-clear': {
    name: '审计规则清除',
    command: 'auditctl -D && systemctl stop auditd',
    requiresRoot: true,
    reversible: true,
  },
  'wtmp-erase': {
    name: 'Wtmp 清除',
    path: '/var/log/wtmp',
    command: 'rm -f /var/log/wtmp /var/log/wtmp*',
    requiresRoot: true,
    reversible: false,
  },
  'utmp-erase': {
    name: 'Utmp 清除',
    path: '/var/run/utmp',
    command: 'rm -f /var/run/utmp /var/run/utmp*',
    requiresRoot: true,
    reversible: false,
  },
  'lastlog-erase': {
    name: 'Lastlog 清除',
    path: '/var/log/lastlog',
    command: 'rm -f /var/log/lastlog',
    requiresRoot: true,
    reversible: false,
  },
  'package-manager-history': {
    name: '包管理器历史清除',
    command: 'rm -f ~/.apt_history ~/.bash_history ~/.cache/apt/*.log /var/log/apt/*',
    requiresRoot: false,
    reversible: false,
  },
  'docker-logs-clear': {
    name: 'Docker 日志清除',
    command: 'find /var/lib/docker -name "*.log" -delete',
    requiresRoot: true,
    reversible: false,
  },
  'kernel-messages-clear': {
    name: 'Kernel 消息清除',
    command: 'dmesg -c || echo "" > /proc/kmsg',
    requiresRoot: true,
    reversible: true,
  },
  'cron-logs-clear': {
    name: 'Cron 日志清除',
    command: 'rm -f /var/log/cron /var/log/cron* /var/spool/cron/crontabs/*',
    requiresRoot: true,
    reversible: false,
  },
};

/**
 * Linux 反溯源 Agent 实现
 */
class LinuxForensicsEvasionAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dryRun: config.dryRun !== false,
      requireRoot: true,
      ...config,
    };
    this.state = {
      executed: [],
      failed: [],
    };
  }

  /**
   * 获取所有 Linux 特定能力
   */
  getCapabilities() {
    return Object.keys(LINUX_FORENSICS_CAPABILITIES);
  }

  /**
   * 获取能力详情
   */
  getCapabilityDetails(capId) {
    return LINUX_FORENSICS_CAPABILITIES[capId] || null;
  }

  /**
   * 执行单个清除能力（干运行模式）
   */
  async executeCapability(capId) {
    const cap = LINUX_FORENSICS_CAPABILITIES[capId];
    if (!cap) {
      throw new Error(`Unknown capability: ${capId}`);
    }

    this.emit('execute-start', { capId, capability: cap });

    if (this.config.dryRun) {
      this.state.executed.push(capId);
      return {
        capId,
        status: 'simulated',
        command: cap.command || `clear ${cap.name}`,
        message: `[DRY RUN] ${cap.name}`,
      };
    }

    // 实际执行需要与 shell 交互
    return {
      capId,
      status: 'pending-execution',
      message: 'Awaiting shell integration',
    };
  }

  /**
   * 执行整个策略清除
   */
  async orchestrate(capabilities = null) {
    const toExecute = capabilities || this.getCapabilities();
    const results = [];

    for (const capId of toExecute) {
      try {
        const result = await this.executeCapability(capId);
        results.push(result);
      } catch (err) {
        this.state.failed.push({ capId, error: err.message });
        this.emit('error', { capId, error: err });
      }
    }

    return {
      agent: 'linux-forensics-evasion',
      dryRun: this.config.dryRun,
      executedCapabilities: this.state.executed,
      failedCapabilities: this.state.failed,
      results,
    };
  }

  /**
   * 验证清除完整性
   */
  async verify() {
    return {
      timestamp: new Date().toISOString(),
      platform: 'Linux',
      executedCapabilities: this.state.executed,
      failedCapabilities: this.state.failed,
      status: this.state.failed.length === 0 ? 'compliant' : 'partial-compliance',
    };
  }
}

export {
  LinuxForensicsEvasionAgent,
  LINUX_FORENSICS_CAPABILITIES,
};
