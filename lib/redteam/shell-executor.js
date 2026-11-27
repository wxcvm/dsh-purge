/**
 * Shell 执行层（增强版）
 * 
 * 职责：
 * - 实际运行系统命令（不仅干运行）
 * - 状态追踪、超时控制、错误处理
 * - 输出捕获 + 结构化日志
 * - 与审计日志集成
 */

import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec as execCallback } from 'child_process'
import { EventEmitter } from 'events'

const exec = promisify(execCallback)

class ShellExecutor extends EventEmitter {
  constructor(config = {}) {
    super()
    this.config = {
      platform: config.platform || process.platform, // 'win32' or 'linux' or 'darwin'
      dryRun: config.dryRun !== false,
      timeout: config.timeout || 30000, // 30 seconds default
      captureOutput: config.captureOutput !== false,
      auditLog: config.auditLog || null, // 可选的 AuditLogManager 实例
      shell: config.shell || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'),
      ...config,
    }
    this.state = {
      executed: [],
      failed: [],
      totalDuration: 0,
    }
  }

  /**
   * 执行单个命令（核心接口）
   * @param {string} command - 要执行的命令
   * @param {object} options - 执行选项 { capabilityId, label, requiresAdmin, requiresRoot, reversible, reversalCmd }
   * @returns {Promise<ExecutionResult>}
   */
  async executeCommand(command, options = {}) {
    const opts = {
      captureOutput: this.config.captureOutput,
      timeout: this.config.timeout,
      capabilityId: options.capabilityId || 'unknown',
      label: options.label || command,
      reversible: options.reversible || false,
      reversalCmd: options.reversalCmd || null,
      ...options,
    }

    const startTime = Date.now()
    let result

    // 权限检查
    if (!this._verifyPermissions(command, options)) {
      result = {
        command,
        status: 'permission-denied',
        stdout: '',
        stderr: 'Insufficient permissions to execute this command',
        exitCode: 1,
        duration: 0,
      }
      this.state.failed.push({
        capabilityId: opts.capabilityId,
        command,
        error: 'permission-denied',
      })
      await this._logExecution(opts, result, 'failed')
      this.emit('permission-denied', { capabilityId: opts.capabilityId, command })
      return result
    }

    // 干运行模式
    if (this.config.dryRun) {
      result = {
        command,
        status: 'simulated',
        stdout: `[DRY RUN] Would execute: ${command}`,
        stderr: '',
        exitCode: 0,
        duration: 0,
        reversible: opts.reversible,
        reversalCmd: opts.reversalCmd,
      }
      this.state.executed.push({
        capabilityId: opts.capabilityId,
        command,
        status: 'simulated',
        duration: 0,
        reversible: opts.reversible,
      })
      await this._logExecution(opts, result, 'simulated')
      this.emit('command-simulated', { capabilityId: opts.capabilityId, command })
      return result
    }

    // 实际执行
    try {
      result = await this._executeReal(command, opts)
      this.state.executed.push({
        capabilityId: opts.capabilityId,
        command,
        status: result.exitCode === 0 ? 'success' : 'failed',
        duration: result.duration,
        reversible: opts.reversible,
        reversalCmd: opts.reversalCmd,
      })
      await this._logExecution(opts, result, result.exitCode === 0 ? 'success' : 'failed')
      
      if (result.exitCode === 0) {
        this.emit('command-success', { capabilityId: opts.capabilityId, command })
      } else {
        this.emit('command-failed', { capabilityId: opts.capabilityId, command, stderr: result.stderr })
      }
    } catch (error) {
      result = {
        command,
        status: 'error',
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        duration: Date.now() - startTime,
      }
      this.state.failed.push({
        capabilityId: opts.capabilityId,
        command,
        error: error.message,
      })
      await this._logExecution(opts, result, 'error')
      this.emit('command-error', { capabilityId: opts.capabilityId, command, error: error.message })
    }

    this.state.totalDuration += result.duration
    return result
  }

  /**
   * 实际执行命令
   * @private
   */
  async _executeReal(command, opts) {
    const startTime = Date.now()

    try {
      const { stdout, stderr } = await exec(command, {
        timeout: opts.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: this.config.shell,
      })

      const duration = Date.now() - startTime

      return {
        command,
        status: 'success',
        stdout: opts.captureOutput ? stdout : '',
        stderr: opts.captureOutput ? stderr : '',
        exitCode: 0,
        duration,
        reversible: opts.reversible,
        reversalCmd: opts.reversalCmd,
      }
    } catch (error) {
      const duration = Date.now() - startTime

      return {
        command,
        status: 'failed',
        stdout: error.stdout ? (opts.captureOutput ? error.stdout : '') : '',
        stderr: error.stderr ? (opts.captureOutput ? error.stderr : '') : error.message,
        exitCode: error.code || 1,
        duration,
        error: error.message,
      }
    }
  }

  /**
   * 执行命令序列（带中止支持）
   * @param {Array} commands - 命令数组 [{ command, options }, ...]
   * @param {object} config - { stopOnError, parallel }
   * @returns {Promise<ExecutionResult[]>}
   */
  async executeSequence(commands, config = {}) {
    const cfg = {
      stopOnError: config.stopOnError !== false,
      parallel: config.parallel || false,
      ...config,
    }

    if (cfg.parallel) {
      return Promise.all(commands.map(c => this.executeCommand(c.command, c.options)))
    }

    const results = []
    for (const item of commands) {
      const result = await this.executeCommand(item.command, item.options)
      results.push(result)
      if (cfg.stopOnError && result.exitCode !== 0) {
        this.emit('sequence-stopped', { failedAt: item.command, results })
        break
      }
    }
    return results
  }

  /**
   * 验证命令权限要求
   * @private
   */
  _verifyPermissions(command, options = {}) {
    if (this.config.platform === 'win32' && options.requiresAdmin) {
      return this._isWindowsAdmin()
    }

    if (this.config.platform !== 'win32' && options.requiresRoot) {
      return process.getuid?.() === 0
    }

    return true
  }

  /**
   * 检查 Windows Admin 权限（同步）
   * @private
   */
  _isWindowsAdmin() {
    try {
      // 简单检查：管理员权限下可以读取 System32 中的某些文件
      const { execSync } = require('child_process')
      execSync('fsutil fsinfo volumeinfo C: > nul 2>&1')
      return true
    } catch {
      return false
    }
  }

  /**
   * 与审计日志集成
   * @private
   */
  async _logExecution(opts, result, status) {
    if (!this.config.auditLog) return

    this.config.auditLog.logOperation({
      type: 'command-exec',
      capabilityId: opts.capabilityId,
      command: opts.label || opts.capabilityId,
      status,
      result: {
        exitCode: result.exitCode,
        stdout_lines: (result.stdout || '').split('\n').length,
        stderr_summary: result.stderr ? result.stderr.substring(0, 100) : '',
        reversible: result.reversible,
      },
      error: result.stderr || null,
      duration: result.duration,
    })
  }

  /**
   * 获取执行状态
   */
  getState() {
    const successCount = this.state.executed.filter(e => e.status === 'success' || e.status === 'simulated').length
    return {
      platform: this.config.platform,
      dryRun: this.config.dryRun,
      executed: this.state.executed,
      failed: this.state.failed,
      successCount,
      failureCount: this.state.failed.length,
      totalDuration: this.state.totalDuration,
      summary: {
        total: this.state.executed.length + this.state.failed.length,
        success: this.state.executed.filter(e => e.status === 'success').length,
        failed: this.state.failed.length,
        simulated: this.state.executed.filter(e => e.status === 'simulated').length,
        reversible: this.state.executed.filter(e => e.reversible).length,
      },
    }
  }

  /**
   * 获取可逆操作（用于回滚）
   */
  getReversibleOperations() {
    return this.state.executed.filter(e => e.reversible && e.reversalCmd)
  }
}

export { ShellExecutor }
