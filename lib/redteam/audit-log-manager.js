/**
 * 审计日志集中管理
 * 
 * 职责：
 * - 集中记录所有操作（命令、时间、结果、用户）
 * - SQLite 本地存储（脱敏靶标信息）
 * - 导出为脱敏报告
 * - 不可篡改日志保证
 */

import { createWriteStream, appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { hostname as getHostname } from 'os'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

class AuditLogManager extends EventEmitter {
  constructor(config = {}) {
    super()
    this.config = {
      logDir: config.logDir || './.redteam-audit',
      dbPath: config.dbPath || './.redteam-audit/audit.db',
      enableImmutable: config.enableImmutable !== true, // JSONL 文件备份
      enableSqlite: config.enableSqlite !== false,
      maxSize: config.maxSize || 100 * 1024 * 1024, // 100MB per file
      retentionDays: config.retentionDays || 90,
      sanitizeTargets: config.sanitizeTargets !== false, // 脱敏靶标IP/域名
      ...config,
    }
    this.logs = []
    this.sessionId = this._generateSessionId()
    this.db = null
    this.Database = null

    this._initDb()
  }

  /**
   * 初始化数据库
   * @private
   */
  _initDb() {
    if (!this.config.enableSqlite) return

    try {
      // 延迟加载 better-sqlite3
      const DbModule = require('better-sqlite3')
      this.Database = DbModule.default || DbModule

      // 确保目录存在
      const dbDir = dirname(this.config.dbPath)
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true })
      }

      this.db = new this.Database(this.config.dbPath)
      this.db.pragma('journal_mode = WAL') // 预写日志以确保不可篡改
      this.db.pragma('synchronous = FULL') // 完全同步

      // 创建表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          type TEXT NOT NULL,
          capability_id TEXT,
          command TEXT,
          command_hash TEXT,
          status TEXT,
          result_json TEXT,
          error TEXT,
          duration_ms INTEGER,
          user_id TEXT,
          hostname TEXT,
          sanitized BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_session_id ON audit_logs(session_id);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_capability_id ON audit_logs(capability_id);
        CREATE INDEX IF NOT EXISTS idx_type ON audit_logs(type);
        CREATE INDEX IF NOT EXISTS idx_status ON audit_logs(status);
      `)
      this.emit('db-initialized', { dbPath: this.config.dbPath })
    } catch (error) {
      console.error('Failed to initialize audit database:', error)
      this.emit('db-error', error)
      this.db = null
    }
  }

  /**
   * 记录操作
   * @param {object} operation - { type, capabilityId, command, status, result, error, duration, userId, hostname }
   * @returns {object} entry
   */
  logOperation(operation) {
    const entry = {
      id: this._generateEntryId(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      type: operation.type, // 'command-exec', 'capability-execute', 'cleanup-complete', 'rollback'
      capabilityId: operation.capabilityId || null,
      command: operation.command || null,
      status: operation.status, // 'pending', 'success', 'failed', 'error', 'simulated'
      result: operation.result || {},
      error: operation.error || null,
      duration: operation.duration || 0,
      userId: operation.userId || process.env.USER || 'unknown',
      hostname: operation.hostname || getHostname(),
    }

    this.logs.push(entry)

    // 持久化
    if (this.config.enableImmutable) {
      this._persistToJsonl(entry)
    }

    if (this.config.enableSqlite && this.db) {
      this._persistToSqlite(entry)
    }

    this.emit('operation-logged', entry)
    return entry
  }

  /**
   * 持久化到 JSONL（不可篡改备份）
   * @private
   */
  _persistToJsonl(entry) {
    try {
      const logDir = this.config.logDir
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true })
      }

      const logPath = join(logDir, `audit-${this.sessionId}.jsonl`)
      const logLine = JSON.stringify(entry) + '\n'
      appendFileSync(logPath, logLine, { flag: 'a', mode: 0o444 }) // 只读
    } catch (error) {
      console.error('Failed to persist JSONL audit log:', error)
      this.emit('persist-error', { type: 'jsonl', error })
    }
  }

  /**
   * 持久化到 SQLite
   * @private
   */
  _persistToSqlite(entry) {
    if (!this.db) return

    try {
      const commandHash = entry.command ? this._hashCommand(entry.command) : null
      const resultJson = JSON.stringify(entry.result)

      const stmt = this.db.prepare(`
        INSERT INTO audit_logs (
          id, session_id, timestamp, type, capability_id, command, command_hash,
          status, result_json, error, duration_ms, user_id, hostname, sanitized
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      stmt.run(
        entry.id,
        entry.sessionId,
        entry.timestamp,
        entry.type,
        entry.capabilityId,
        entry.command,
        commandHash,
        entry.status,
        resultJson,
        entry.error,
        entry.duration,
        entry.userId,
        entry.hostname,
        0
      )
    } catch (error) {
      console.error('Failed to persist SQLite audit log:', error)
      this.emit('persist-error', { type: 'sqlite', error })
    }
  }

  /**
   * 计算命令哈希（用于检测命令重复）
   * @private
   */
  _hashCommand(command) {
    return createHash('sha256').update(command).digest('hex').substring(0, 16)
  }

  /**
   * 获取操作历史
   * @param {object} filter - { type, capabilityId, status, startTime, endTime, limit }
   * @returns {Array}
   */
  getHistory(filter = {}) {
    if (!this.db) return this._getHistoryMemory(filter)

    const filters = []
    const params = []

    if (filter.type) {
      filters.push('type = ?')
      params.push(filter.type)
    }
    if (filter.capabilityId) {
      filters.push('capability_id = ?')
      params.push(filter.capabilityId)
    }
    if (filter.status) {
      filters.push('status = ?')
      params.push(filter.status)
    }
    if (filter.startTime) {
      filters.push('timestamp >= ?')
      params.push(filter.startTime.toISOString?.() || filter.startTime)
    }
    if (filter.endTime) {
      filters.push('timestamp <= ?')
      params.push(filter.endTime.toISOString?.() || filter.endTime)
    }

    const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : ''
    const limit = filter.limit ? ` LIMIT ${Math.min(filter.limit, 10000)}` : ''
    const query = `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC${limit}`

    try {
      const stmt = this.db.prepare(query)
      return stmt.all(...params)
    } catch (error) {
      console.error('Failed to query audit logs:', error)
      return []
    }
  }

  /**
   * 内存中获取历史（备用）
   * @private
   */
  _getHistoryMemory(filter = {}) {
    let results = this.logs

    if (filter.type) results = results.filter(l => l.type === filter.type)
    if (filter.capabilityId) results = results.filter(l => l.capabilityId === filter.capabilityId)
    if (filter.status) results = results.filter(l => l.status === filter.status)
    if (filter.startTime) results = results.filter(l => new Date(l.timestamp) >= filter.startTime)
    if (filter.endTime) results = results.filter(l => new Date(l.timestamp) <= filter.endTime)

    const limit = filter.limit || 1000
    return results.slice(0, limit)
  }

  /**
   * 生成报告（脱敏）
   * @param {object} options - { sanitize, format }
   * @returns {object}
   */
  generateReport(options = {}) {
    const opts = {
      sanitize: options.sanitize !== false,
      format: options.format || 'json', // 'json', 'csv', 'html'
      ...options,
    }

    const history = this.getHistory({ limit: 10000 })
    const successCount = history.filter(l => l.status === 'success').length
    const failureCount = history.filter(l => l.status === 'failed').length
    const errorCount = history.filter(l => l.status === 'error').length
    // Handle both memory (duration) and SQLite (duration_ms) property names
    const totalDuration = history.reduce((sum, l) => sum + ((l.duration_ms || l.duration) || 0), 0)

    const report = {
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
      totalOperations: history.length,
      successCount,
      failureCount,
      errorCount,
      successRate: history.length > 0 ? ((successCount / history.length) * 100).toFixed(2) + '%' : 'N/A',
      totalDuration,
      averageDuration: history.length > 0 ? (totalDuration / history.length).toFixed(0) + 'ms' : '0ms',
      operations: opts.sanitize ? this._sanitizeOperations(history) : history,
      sanitized: opts.sanitize,
    }

    if (opts.format === 'csv') {
      return this._reportToCsv(report)
    } else if (opts.format === 'html') {
      return this._reportToHtml(report)
    }

    return report
  }

  /**
   * 脱敏操作（隐去IP、域名、敏感参数）
   * @private
   */
  _sanitizeOperations(operations) {
    if (!this.config.sanitizeTargets) return operations

    return operations.map(op => ({
      ...op,
      command: this._sanitizeString(op.command),
      error: op.error ? this._sanitizeString(op.error) : null,
      result_json: op.result_json ? this._sanitizeString(op.result_json) : null,
    }))
  }

  /**
   * 脱敏字符串（IP、域名等）
   * @private
   */
  _sanitizeString(str) {
    if (!str) return str
    // 脱敏 IP
    str = str.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[IP]')
    // 脱敏 URL
    str = str.replace(/https?:\/\/[^\s]+/g, '[URL]')
    // 脱敏邮箱
    str = str.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[EMAIL]')
    // 脱敏路径（仅保留最后一级）
    str = str.replace(/\/[^\s]+\/([^\s/]+)(?=\s|$)/g, '/[PATH]/$1')
    return str
  }

  /**
   * 导出为 CSV
   * @private
   */
  _reportToCsv(report) {
    const headers = ['ID', 'Timestamp', 'Type', 'Capability', 'Status', 'Duration(ms)']
    const rows = report.operations.map(op => [
      op.id,
      op.timestamp,
      op.type,
      op.capabilityId || 'N/A',
      op.status,
      op.duration_ms || 0,
    ])

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n')

    return csv
  }

  /**
   * 导出为 HTML
   * @private
   */
  _reportToHtml(report) {
    const rows = report.operations
      .map(
        op =>
          `<tr><td>${op.id}</td><td>${op.timestamp}</td><td>${op.type}</td><td>${op.status}</td><td>${op.duration_ms}ms</td></tr>`
      )
      .join('')

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Audit Report</title>
  <style>
    body { font-family: Arial; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>Audit Report</h1>
  <p><strong>Session:</strong> ${report.sessionId}</p>
  <p><strong>Total Operations:</strong> ${report.totalOperations}</p>
  <p><strong>Success Rate:</strong> ${report.successRate}</p>
  <table>
    <tr><th>ID</th><th>Timestamp</th><th>Type</th><th>Status</th><th>Duration</th></tr>
    ${rows}
  </table>
</body>
</html>
    `
  }

  /**
   * 生成会话 ID
   * @private
   */
  _generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substring(7)}`
  }

  /**
   * 生成条目 ID
   * @private
   */
  _generateEntryId() {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}`
  }

  /**
   * 清理过期日志
   * @param {number} olderThanDays
   */
  cleanupOldLogs(olderThanDays = this.config.retentionDays) {
    if (!this.db) return

    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
      const stmt = this.db.prepare('DELETE FROM audit_logs WHERE timestamp < ?')
      const info = stmt.run(cutoffDate)
      this.emit('cleanup-completed', { deleted: info.changes, cutoffDate })
      return info.changes
    } catch (error) {
      console.error('Failed to cleanup old logs:', error)
      this.emit('cleanup-error', error)
      return 0
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

export { AuditLogManager }
