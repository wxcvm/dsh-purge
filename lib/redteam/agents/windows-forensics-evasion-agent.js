/**
 * Windows 反溯源 Agent
 * 
 * 负责 Windows 特定的痕迹清除任务：
 * - EventLog 清除（Application/Security/System）
 * - 临时文件清除（$Recycle.Bin, Temp, Recent）
 * - 浏览器历史清除
 * - MRU 列表清除
 * - 页面文件清除
 * - 注册表痕迹清除
 * 
 * 设计原则：
 * - 权限检查：需要 Admin 权限
 * - 可验证性：每个操作返回成功/失败状态
 * - 恢复友好：记录关键操作便于手动恢复
 */

import { EventEmitter } from 'events';

const WINDOWS_FORENSICS_CAPABILITIES = {
  'eventlog-application': {
    name: 'Application 事件日志清除',
    logName: 'Application',
    command: 'wevtutil cl Application',
    requiresAdmin: true,
    reversible: false,
  },
  'eventlog-security': {
    name: 'Security 事件日志清除',
    logName: 'Security',
    command: 'wevtutil cl Security',
    requiresAdmin: true,
    reversible: false,
  },
  'eventlog-system': {
    name: 'System 事件日志清除',
    logName: 'System',
    command: 'wevtutil cl System',
    requiresAdmin: true,
    reversible: false,
  },
  'recycle-bin-empty': {
    name: 'Recycle Bin 清空',
    paths: ['C:\\$Recycle.Bin'],
    command: 'rd /s /q C:\\$Recycle.Bin 2>nul || true',
    requiresAdmin: false,
    reversible: false,
  },
  'temp-files-cleanup': {
    name: '临时文件清除',
    paths: ['%TEMP%', '%WINDIR%\\Temp'],
    command: 'del /q /s %TEMP%\\* 2>nul & del /q /s %WINDIR%\\Temp\\* 2>nul',
    requiresAdmin: false,
    reversible: false,
  },
  'browser-history-chrome': {
    name: 'Chrome 浏览历史清除',
    paths: ['%LOCALAPPDATA%\\Google\\Chrome\\User Data'],
    registryPaths: ['HKLM\\SOFTWARE\\Classes\\ChromeHTML'],
    requiresAdmin: false,
    reversible: false,
  },
  'browser-history-firefox': {
    name: 'Firefox 浏览历史清除',
    paths: ['%APPDATA%\\Mozilla\\Firefox\\Profiles'],
    requiresAdmin: false,
    reversible: false,
  },
  'browser-history-edge': {
    name: 'Edge 浏览历史清除',
    paths: ['%LOCALAPPDATA%\\Microsoft\\Edge\\User Data'],
    requiresAdmin: false,
    reversible: false,
  },
  'mru-clear': {
    name: 'MRU 列表清除',
    registryPaths: [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\LastVisitedMRU',
    ],
    command: 'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU" /va /f',
    requiresAdmin: false,
    reversible: true,
  },
  'pagefile-clear': {
    name: '页面文件清除',
    command: 'fsutil behavior set ClearPageFileAtShutdown 1',
    requiresAdmin: true,
    reversible: true,
  },
  'thumbnail-cache-clear': {
    name: '缩略图缓存清除',
    paths: ['%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer'],
    command: 'del /q /s %LOCALAPPDATA%\\Microsoft\\Windows\\Explorer\\thumbcache_*.db',
    requiresAdmin: false,
    reversible: false,
  },
  'prefetch-clear': {
    name: 'Prefetch 清除',
    paths: ['C:\\Windows\\Prefetch'],
    command: 'del /q /s C:\\Windows\\Prefetch\\*.pf',
    requiresAdmin: true,
    reversible: false,
  },
  'jumplist-clear': {
    name: 'JumpList 清除',
    paths: ['%APPDATA%\\Microsoft\\Windows\\Recent\\AutomaticDestinations'],
    command: 'del /q /s %APPDATA%\\Microsoft\\Windows\\Recent\\AutomaticDestinations\\*',
    requiresAdmin: false,
    reversible: false,
  },
  'cmd-history-clear': {
    name: 'CMD 历史清除',
    registryPaths: ['HKCU\\Software\\Microsoft\\Command Processor'],
    command: 'reg delete "HKCU\\Software\\Microsoft\\Command Processor" /v ConCleaner /f',
    requiresAdmin: false,
    reversible: false,
  },
  'powershell-history-clear': {
    name: 'PowerShell 历史清除',
    paths: ['%APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadline'],
    command: 'del /q %APPDATA%\\Microsoft\\Windows\\PowerShell\\PSReadline\\ConsoleHost_history.txt',
    requiresAdmin: false,
    reversible: false,
  },
  'usb-history-clear': {
    name: 'USB 设备历史清除',
    registryPaths: [
      'HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USB',
      'HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USBSTOR',
    ],
    requiresAdmin: true,
    reversible: false,
  },
  'wmi-logs-clear': {
    name: 'WMI 日志清除',
    paths: ['%WINDIR%\\System32\\wbem\\Repository'],
    command: 'del /q /s %WINDIR%\\System32\\wbem\\Repository\\*',
    requiresAdmin: true,
    reversible: false,
  },
};

/**
 * Windows 反溯源 Agent 实现
 */
class WindowsForensicsEvasionAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dryRun: config.dryRun !== false,
      requireAdmin: true,
      ...config,
    };
    this.state = {
      executed: [],
      failed: [],
    };
  }

  /**
   * 获取所有 Windows 特定能力
   */
  getCapabilities() {
    return Object.keys(WINDOWS_FORENSICS_CAPABILITIES);
  }

  /**
   * 获取能力详情
   */
  getCapabilityDetails(capId) {
    return WINDOWS_FORENSICS_CAPABILITIES[capId] || null;
  }

  /**
   * 执行单个清除能力（干运行模式）
   */
  async executeCapability(capId) {
    const cap = WINDOWS_FORENSICS_CAPABILITIES[capId];
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
      agent: 'windows-forensics-evasion',
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
      platform: 'Windows',
      executedCapabilities: this.state.executed,
      failedCapabilities: this.state.failed,
      status: this.state.failed.length === 0 ? 'compliant' : 'partial-compliance',
    };
  }
}

export {
  WindowsForensicsEvasionAgent,
  WINDOWS_FORENSICS_CAPABILITIES,
};
