/**
 * 回滚机制
 * 
 * 职责：
 * - 记录可逆操作的反向命令
 * - 按优先级排序回滚队列
 * - 执行完整回滚或部分恢复
 */

import { EventEmitter } from 'events'

class RollbackHandler extends EventEmitter {
  constructor(config = {}) {
    super()
    this.config = {
      dryRun: config.dryRun !== false,
      shellExecutor: config.shellExecutor || null, // ShellExecutor 实例
      auditLog: config.auditLog || null, // AuditLogManager 实例
      strict: config.strict !== false, // 严格模式：回滚失败立即停止
      parallel: config.parallel || false, // 并行回滚
      ...config,
    }
    this.rollbackQueue = []
    this.executedOperations = []
  }

  /**
   * 注册可逆操作
   * @param {object} operation - { capabilityId, command, reversalCmd, priority, description, reversible }
   */
  registerReversible(operation) {
    const reversible = {
      id: this._generateId(),
      capabilityId: operation.capabilityId,
      command: operation.command,
      reversalCmd: operation.reversalCmd,
      priority: operation.priority || 50, // 0-100, 高优先级先回滚
      description: operation.description || operation.command,
      status: 'registered', // registered, pending, completed, failed
      executedAt: null,
      reversedAt: null,
      error: null,
    }

    this.rollbackQueue.push(reversible)
    this.emit('reversible-registered', reversible)
    return reversible
  }

  /**
   * 标记操作已执行
   * @param {string} reversibleId
   * @param {object} executionResult
   */
  markExecuted(reversibleId, executionResult = {}) {
    const reversible = this.rollbackQueue.find(r => r.id === reversibleId)
    if (!reversible) return

    reversible.status = 'pending'
    reversible.executedAt = new Date().toISOString()
    this.executedOperations.push({
      id: reversibleId,
      capabilityId: reversible.capabilityId,
      command: reversible.command,
      timestamp: reversible.executedAt,
      result: executionResult,
    })

    this.emit('operation-executed', reversible)
  }

  /**
   * 获取回滚队列（按优先级排序）
   * @returns {Array}
   */
  getQueue() {
    return [...this.rollbackQueue].sort((a, b) => b.priority - a.priority)
  }

  /**
   * 执行完整回滚
   * @param {object} options - { dryRun, stopOnError, onProgress }
   * @returns {Promise<RollbackResult>}
   */
  async rollback(options = {}) {
    const opts = {
      dryRun: options.dryRun !== undefined ? options.dryRun : this.config.dryRun,
      stopOnError: options.stopOnError !== false,
      onProgress: options.onProgress || (() => {}),
      ...options,
    }

    if (!this.config.shellExecutor) {
      throw new Error('ShellExecutor not configured')
    }

    this.emit('rollback-started', { queueSize: this.rollbackQueue.length })

    const queue = this.getQueue()
    const results = []
    const failed = []

    for (const reversible of queue) {
      if (reversible.status !== 'pending') continue

      try {
        opts.onProgress({
          current: results.length + 1,
          total: queue.length,
          capabilityId: reversible.capabilityId,
        })

        const result = await this._executeReversal(reversible, opts)
        results.push(result)

        if (result.status === 'failed' && opts.stopOnError) {
          failed.push(result)
          this.emit('rollback-stopped', { failedAt: reversible.id, results, failed })
          break
        }

        if (result.status === 'failed') {
          failed.push(result)
        }
      } catch (error) {
        const result = {
          reversibleId: reversible.id,
          capabilityId: reversible.capabilityId,
          command: reversible.reversalCmd,
          status: 'error',
          error: error.message,
        }
        results.push(result)
        failed.push(result)

        if (opts.stopOnError) {
          this.emit('rollback-stopped', { failedAt: reversible.id, results, failed })
          break
        }
      }
    }

    const summary = {
      totalQueued: queue.length,
      totalProcessed: results.length,
      successCount: results.filter(r => r.status === 'success').length,
      failureCount: failed.length,
      successRate: results.length > 0
        ? ((results.filter(r => r.status === 'success').length / results.length) * 100).toFixed(2) + '%'
        : 'N/A',
    }

    this.emit('rollback-completed', { summary, results, failed })

    return {
      success: failed.length === 0,
      summary,
      results,
      failed,
    }
  }

  /**
   * 执行单个回滚
   * @private
   */
  async _executeReversal(reversible, opts) {
    const reversible_updated = this.rollbackQueue.find(r => r.id === reversible.id)

    if (opts.dryRun) {
      reversible_updated.status = 'completed'
      reversible_updated.reversedAt = new Date().toISOString()

      const result = {
        reversibleId: reversible.id,
        capabilityId: reversible.capabilityId,
        command: reversible.reversalCmd,
        status: 'success',
        dryRun: true,
        message: `[DRY RUN] Would execute reversal: ${reversible.reversalCmd}`,
      }

      await this._logReversal(reversible, result)
      return result
    }

    try {
      const execResult = await this.config.shellExecutor.executeCommand(reversible.reversalCmd, {
        capabilityId: reversible.capabilityId,
        label: `Reversal: ${reversible.description}`,
      })

      const success = execResult.exitCode === 0
      reversible_updated.status = success ? 'completed' : 'failed'
      reversible_updated.reversedAt = new Date().toISOString()

      if (!success) {
        reversible_updated.error = execResult.stderr
      }

      const result = {
        reversibleId: reversible.id,
        capabilityId: reversible.capabilityId,
        command: reversible.reversalCmd,
        status: success ? 'success' : 'failed',
        exitCode: execResult.exitCode,
        error: execResult.stderr,
        stdout: execResult.stdout ? execResult.stdout.substring(0, 200) : '',
      }

      await this._logReversal(reversible, result)
      return result
    } catch (error) {
      reversible_updated.status = 'failed'
      reversible_updated.reversedAt = new Date().toISOString()
      reversible_updated.error = error.message

      const result = {
        reversibleId: reversible.id,
        capabilityId: reversible.capabilityId,
        command: reversible.reversalCmd,
        status: 'error',
        error: error.message,
      }

      await this._logReversal(reversible, result)
      return result
    }
  }

  /**
   * 执行部分回滚（按能力ID）
   * @param {string} capabilityId
   * @param {object} options
   * @returns {Promise<RollbackResult>}
   */
  async rollbackCapability(capabilityId, options = {}) {
    const toRollback = this.rollbackQueue.filter(r => r.capabilityId === capabilityId && r.status === 'pending')

    if (toRollback.length === 0) {
      return {
        success: true,
        summary: { totalQueued: 0, totalProcessed: 0, successCount: 0, failureCount: 0 },
        results: [],
        failed: [],
      }
    }

    this.emit('partial-rollback-started', { capabilityId, count: toRollback.length })

    const opts = {
      dryRun: options.dryRun !== undefined ? options.dryRun : this.config.dryRun,
      stopOnError: options.stopOnError !== false,
      ...options,
    }

    const results = []
    const failed = []

    for (const reversible of toRollback) {
      try {
        const result = await this._executeReversal(reversible, opts)
        results.push(result)
        if (result.status === 'failed') failed.push(result)
      } catch (error) {
        const result = {
          reversibleId: reversible.id,
          capabilityId: reversible.capabilityId,
          command: reversible.reversalCmd,
          status: 'error',
          error: error.message,
        }
        results.push(result)
        failed.push(result)
      }
    }

    return {
      success: failed.length === 0,
      summary: {
        capabilityId,
        totalQueued: toRollback.length,
        totalProcessed: results.length,
        successCount: results.filter(r => r.status === 'success').length,
        failureCount: failed.length,
      },
      results,
      failed,
    }
  }

  /**
   * 执行部分回滚（按操作ID）
   * @param {string[]} operationIds
   * @param {object} options
   * @returns {Promise<RollbackResult>}
   */
  async rollbackOperations(operationIds, options = {}) {
    const toRollback = this.rollbackQueue
      .filter(r => operationIds.includes(r.id) && r.status === 'pending')
      .sort((a, b) => b.priority - a.priority)

    if (toRollback.length === 0) {
      return {
        success: true,
        summary: { totalQueued: 0, totalProcessed: 0, successCount: 0, failureCount: 0 },
        results: [],
        failed: [],
      }
    }

    this.emit('selective-rollback-started', { count: toRollback.length })

    const opts = {
      dryRun: options.dryRun !== undefined ? options.dryRun : this.config.dryRun,
      ...options,
    }

    const results = []
    const failed = []

    for (const reversible of toRollback) {
      try {
        const result = await this._executeReversal(reversible, opts)
        results.push(result)
        if (result.status === 'failed') failed.push(result)
      } catch (error) {
        const result = {
          reversibleId: reversible.id,
          capabilityId: reversible.capabilityId,
          command: reversible.reversalCmd,
          status: 'error',
          error: error.message,
        }
        results.push(result)
        failed.push(result)
      }
    }

    return {
      success: failed.length === 0,
      summary: {
        requested: operationIds.length,
        found: toRollback.length,
        processed: results.length,
        successCount: results.filter(r => r.status === 'success').length,
        failureCount: failed.length,
      },
      results,
      failed,
    }
  }

  /**
   * 与审计日志集成
   * @private
   */
  async _logReversal(reversible, result) {
    if (!this.config.auditLog) return

    this.config.auditLog.logOperation({
      type: 'rollback',
      capabilityId: reversible.capabilityId,
      command: `Reversal: ${reversible.description}`,
      status: result.status === 'success' ? 'success' : 'failed',
      result: {
        reversalCommand: reversible.reversalCmd,
        exitCode: result.exitCode || 0,
        reversedAt: reversible.reversedAt,
      },
      error: result.error || null,
    })
  }

  /**
   * 获取回滚统计
   */
  getStats() {
    const total = this.rollbackQueue.length
    const pending = this.rollbackQueue.filter(r => r.status === 'pending').length
    const completed = this.rollbackQueue.filter(r => r.status === 'completed').length
    const failed = this.rollbackQueue.filter(r => r.status === 'failed').length

    return {
      total,
      registered: this.rollbackQueue.filter(r => r.status === 'registered').length,
      pending,
      completed,
      failed,
      executed: this.executedOperations.length,
    }
  }

  /**
   * 清空回滚队列
   */
  clear() {
    this.rollbackQueue = []
    this.executedOperations = []
    this.emit('queue-cleared')
  }

  /**
   * 生成ID
   * @private
   */
  _generateId() {
    return `rvl-${Date.now()}-${Math.random().toString(36).substring(7)}`
  }
}

export { RollbackHandler }
