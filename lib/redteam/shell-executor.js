/**
 * Shell 执行器
 * 
 * 负责在真实系统上执行清除命令：
 * - Windows PowerShell 命令执行
 * - Linux/macOS bash/sh 命令执行
 * - 命令验证与权限检查
 * - 执行结果捕获与错误处理
 * - 超时与中止机制
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

class ShellExecutor {
  constructor(config = {}) {
    this.config = {
      platform: config.platform || process.platform, // 'win32' or 'linux' or 'darwin'
      dryRun: config.dryRun !== false,
      timeout: config.timeout || 30000, // 30 seconds default
      captureOutput: config.captureOutput !== false,
      ...config,
    };
    this.state = {
      executed: [],
      failed: [],
    };
  }

  /**
   * 执行单个命令
   * @param {string} command - 要执行的命令
   * @param {object} options - 执行选项
   * @returns {Promise<ExecutionResult>}
   */
  async executeCommand(command, options = {}) {
    const opts = {
      captureOutput: this.config.captureOutput,
      timeout: this.config.timeout,
      ...options,
    };

    // 干运行模式
    if (this.config.dryRun) {
      return {
        command,
        status: 'simulated',
        stdout: `[DRY RUN] Would execute: ${command}`,
        stderr: '',
        exitCode: 0,
        duration: 0,
      };
    }

    // 实际执行
    return this._executeReal(command, opts);
  }

  /**
   * 实际执行命令
   * @private
   */
  async _executeReal(command, opts) {
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await exec(command, {
        timeout: opts.timeout,
        maxBuffer: 1024 * 1024, // 1MB
      });

      const duration = Date.now() - startTime;
      
      this.state.executed.push({
        command,
        status: 'success',
        duration,
      });

      return {
        command,
        status: 'success',
        stdout: opts.captureOutput ? stdout : '',
        stderr: opts.captureOutput ? stderr : '',
        exitCode: 0,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.state.failed.push({
        command,
        error: error.message,
        duration,
      });

      return {
        command,
        status: 'failed',
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
        duration,
        error: error.message,
      };
    }
  }

  /**
   * 验证命令权限要求
   */
  verifyPermissions(command, requiresAdmin = false, requiresRoot = false) {
    if (this.config.platform === 'win32' && requiresAdmin) {
      // 检查是否以 Admin 权限运行
      return this._isWindowsAdmin();
    }

    if (this.config.platform !== 'win32' && requiresRoot) {
      // 检查是否以 root 运行
      return process.getuid?.() === 0;
    }

    return true;
  }

  /**
   * 检查 Windows Admin 权限
   * @private
   */
  async _isWindowsAdmin() {
    try {
      const { stdout } = await exec('net session');
      return stdout.includes('command completed successfully');
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取执行状态
   */
  getState() {
    return {
      platform: this.config.platform,
      dryRun: this.config.dryRun,
      executed: this.state.executed,
      failed: this.state.failed,
      successCount: this.state.executed.length,
      failureCount: this.state.failed.length,
    };
  }
}

export { ShellExecutor };
