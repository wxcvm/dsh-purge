/** Stable diagnostic categories for thrown tool errors. No automatic retry or execution. */
import { redactCredentialText } from './report-shareable.js'

export function structuredToolFailure(error) {
  const raw = error && error.message ? String(error.message) : String(error)
  const code = typeof error?.code === 'string' ? error.code : ''
  const badInput = /非法|invalid|required|不能为空|not found|不存在/i.test(raw)
  let error_code = 'failed'
  let hint = '工具执行失败；先核对实际记录和错误原因，不要静默跳过或盲目重试。'
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || /database is (?:locked|busy)/i.test(raw)) {
    error_code = 'storage_busy'
    hint = '本地数据库正忙或已锁定；先检查宿主及其他写入任务，确认原操作结果后再决定是否重试。'
  } else if (code === 'EACCES' || code === 'EPERM' || /permission denied|access is denied|权限不足/i.test(raw)) {
    error_code = 'permission_denied'
    hint = '本地文件或服务访问被拒绝；核对权限与配置，不应通过重复执行绕过限制。'
  } else if (code === 'ETIMEDOUT' || /timed?\s*out|timeout|超时/i.test(raw)) {
    error_code = 'timeout'
    hint = '操作超时；结束状态可能未知，先核对已保存的结果及宿主活动，不自动重试。'
  } else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /store unavailable|service unavailable|服务不可用/i.test(raw)) {
    error_code = 'unavailable'
    hint = '所需本地服务或依赖不可用；检查服务是否启动、配置及当前宿主状态。'
  } else if (/not found|不存在/i.test(raw)) {
    error_code = 'not_found'
    hint = '对象或文件不存在；先用对应列表核对当前项目和记录 ID，不猜测新 ID。'
  } else if (badInput || error instanceof TypeError) {
    error_code = 'bad_input'
    hint = '参数或对象标识有误；核对参数名、格式及真实记录 ID。'
  }
  return {
    ok: false,
    error: redactCredentialText(raw).slice(0, 1000),
    // Keep the historic two-value contract; new callers can use error_code.
    error_kind: badInput ? 'bad_input' : 'failed',
    error_code,
    hint,
  }
}
