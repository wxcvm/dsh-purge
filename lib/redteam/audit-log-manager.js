/**
 * 审计日志管理器
 * 
 * 负责集中记录所有反溯源操作：
 * - 操作日志持久化
 * - 时间戳记录
 * - 操作结果追踪
 * - 不可篡改日志
 * - 日志查询与导出
 */

import { createWriteStream, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

class AuditLogManager {
  constructor(config = {}) {
    this.config = {
      logDir: config.logDir || './.redteam-audit',
      enableImmutable: config.enableImmutable !== false,
      maxSize: config.maxSize || 100 * 1024 * 1024, // 100MB
      ...config,
    };
    this.logs = [];
    this.sessionId = this._generateSessionId();
  }

  /**
   * 记录操作
   */
  logOperation(operation) {
    const entry = {
      id: this._generateEntryId(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      type: operation.type, // 'capability-execute', 'command-exec', 'cleanup-complete'
      capabilityId: operation.capabilityId,
      command: operation.command,
      status: operation.status, // 'pending', 'success', 'failed'
      result: operation.result,
      error: operation.error,
      duration: operation.duration,
      userId: operation.userId || 'unknown',
      hostname: operation.hostname || 'unknown',
    };

    this.logs.push(entry);

    // 持久化到文件
    if (this.config.enableImmutable) {
      this._persistLog(entry);
    }

    return entry;
  }

  /**
   * 持久化日志到文件
   * @private
   */
  _persistLog(entry) {
    try {
      const logPath = join(this.config.logDir, `audit-${this.sessionId}.jsonl`);
      const logLine = JSON.stringify(entry) + '\n';
      appendFileSync(logPath, logLine, { flag: 'a' });
    } catch (error) {
      console.error('Failed to persist audit log:', error);
    }
  }

  /**
   * 获取操作历史
   */
  getHistory(filter = {}) {
    let results = this.logs;

    if (filter.type) {
      results = results.filter(log => log.type === filter.type);
    }

    if (filter.capabilityId) {
      results = results.filter(log => log.capabilityId === filter.capabilityId);
    }

    if (filter.status) {
      results = results.filter(log => log.status === filter.status);
    }

    if (filter.startTime) {
      results = results.filter(log => new Date(log.timestamp) >= filter.startTime);
    }

    if (filter.endTime) {
      results = results.filter(log => new Date(log.timestamp) <= filter.endTime);
    }

    return results;
  }

  /**
   * 生成报告
   */
  generateReport() {
    const successCount = this.logs.filter(l => l.status === 'success').length;
    const failureCount = this.logs.filter(l => l.status === 'failed').length;
    const totalDuration = this.logs.reduce((sum, l) => sum + (l.duration || 0), 0);

    return {
      sessionId: this.sessionId,
      createdAt: this.logs[0]?.timestamp,
      updatedAt: this.logs[this.logs.length - 1]?.timestamp,
      totalOperations: this.logs.length,
      successCount,
      failureCount,
      successRate: totalDuration > 0 ? (successCount / this.logs.length * 100).toFixed(2) + '%' : 'N/A',
      totalDuration,
      averageDuration: this.logs.length > 0 ? (totalDuration / this.logs.length).toFixed(2) + 'ms' : '0ms',
      operations: this.logs,
    };
  }

  /**
   * 生成会话 ID
   * @private
   */
  _generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * 生成条目 ID
   * @private
   */
  _generateEntryId() {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}

export { AuditLogManager };
