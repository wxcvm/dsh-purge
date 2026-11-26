/**
 * 防溯源 API 处理器（Anti-Forensics API Handler）
 * 
 * 通过 /redteam/api 暴露防溯源工作流的三个核心操作：
 * - antiforensicsPreview：干运行预览会被清除的文件清单
 * - antiforensicsExecute：执行完整清除流程
 * - antiforensicsRollback：回滚指定的清除操作
 */

import { AntiForensicsAgent } from './anti-forensics-agent.js'

/** 防溯源操作类型检测 */
function isAntiForensicsOp(op) {
  return op === 'antiforensicsPreview'
    || op === 'antiforensicsExecute'
    || op === 'antiforensicsRollback'
}

/** 安全错误消息提取 */
function safeError(error, fallback = '防溯源操作失败') {
  const message = error && error.message ? String(error.message) : ''
  if (message.length > 0 && message.length < 500) return message
  return fallback
}

/** 防溯源操作响应包装 */
function antiForensicsResult(result = {}, extra = {}) {
  return {
    ok: true,
    ...result,
    ...extra,
  }
}

/**
 * 处理防溯源操作
 * 
 * 对非防溯源操作返回 undefined，让上级路由继续处理。
 * 
 * @param {Object} request - API 请求对象 { op, strategy, auditId, partial, ... }
 * @param {Object} options - 处理器选项（如 agent 实例等）
 * @returns {Promise<Object>} 操作结果或 undefined
 */
export async function handleAntiForensicsOp(request, options = {}) {
  const op = request && request.op
  if (!isAntiForensicsOp(op)) return undefined

  // 获取或创建 AntiForensicsAgent 实例
  let agent = options.agent
  if (!agent) {
    agent = new AntiForensicsAgent(options.agentOptions || {})
  }

  try {
    // ━━━ antiforensicsPreview: 干运行预览 ━━━
    if (op === 'antiforensicsPreview') {
      const strategy = request.strategy || 'balanced'
      const dryRun = true

      // 获取适用的防溯源能力清单
      const artifacts = await agent.previewCleanup(strategy, dryRun)

      return antiForensicsResult({
        ok: true,
        strategy,
        targetArtifacts: artifacts || [],
        dryRun: true,
      })
    }

    // ━━━ antiforensicsExecute: 执行清除 ━━━
    if (op === 'antiforensicsExecute') {
      const strategy = request.strategy || 'balanced'
      const session = request.engagement
        ? { id: request.engagement }
        : undefined

      const result = await agent.executeFullCleanup(session, strategy, 'auto')

      // 返回脱敏结果：不直接暴露清除的文件路径
      return antiForensicsResult({
        ok: result.success !== false,
        auditId: result.auditId,
        strategy,
        cleaned: result.cleaned ? result.cleaned.map(c => ({
          capability: c.capability,
          success: c.success !== false,
          duration: c.duration,
        })) : [],
        failed: result.failed ? result.failed.map(f => ({
          capability: f.capability,
          error: f.error,
        })) : [],
        report: result.report || {},
      })
    }

    // ━━━ antiforensicsRollback: 回滚操作 ━━━
    if (op === 'antiforensicsRollback') {
      const auditId = request.auditId
      const partial = request.partial === true

      if (!auditId) {
        return {
          ok: false,
          error: '缺少审计 ID（auditId）',
        }
      }

      const result = await agent.rollback(auditId, partial)

      return antiForensicsResult({
        ok: result.success !== false,
        rollbackId: result.rollbackId,
        targetAuditId: auditId,
        partial,
        recovered: result.recovered ? result.recovered.length : 0,
        message: partial ? '部分回滚已完成' : '完整回滚已完成',
      })
    }

  } catch (error) {
    return {
      ok: false,
      error: safeError(error, '防溯源操作失败'),
      operation: op,
    }
  }

  // 未处理的操作返回 undefined
  return undefined
}

export { AntiForensicsAgent }
