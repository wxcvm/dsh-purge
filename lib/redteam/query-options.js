/** Shared pagination contract: invalid input must never become SQLite LIMIT -1. */
export function queryPage(options = {}, maxLimit = 2000) {
  const integer = (value, fallback, name, minimum) => {
    if (value === undefined) return fallback
    const acceptable = typeof value === 'number'
      || (typeof value === 'string' && /^\d+$/.test(value.trim()))
    const number = acceptable ? Number(value) : NaN
    if (!Number.isSafeInteger(number) || number < minimum) {
      throw new TypeError(`${name} must be a safe integer >= ${minimum}`)
    }
    return number
  }
  return {
    limit: Math.min(integer(options.limit, 200, 'limit', 1), maxLimit),
    offset: integer(options.offset, 0, 'offset', 0),
  }
}

export function pageMetadata(total, returned, { limit, offset }) {
  const hasMore = returned > 0 && returned < total - offset
  return { limit, offset, returned, hasMore, nextOffset: hasMore ? offset + returned : null }
}

/**
 * 把一个分页读取器按页拉完。
 *
 * 报告/导出这类"必须覆盖全部记录"的调用方不能只读第一页 —— 单页上限（资产 2000、
 * 漏洞 1000）一过就会静默少算，而少算在报告里表现为"漏洞数量对不上"，比报错更难发现。
 * 这里按 `nextOffset` 逐页推进，并对"不前进/不返回 items"的读取器直接报错，
 * 免得死循环把宿主拖死。
 *
 * @param fetchPage - 接收 `{ limit, offset }` 的分页函数（listVulns / listAssets / queryHttpEvidence）。
 * @param options - 传给分页函数的固定条件（含 limit）。
 * @param guard - `{ maxPages }` 安全上限（默认 1000 页 ≈ 100 万行）。
 */
export function collectAllPages(fetchPage, options = {}, guard = {}) {
  const maxPages = Number.isSafeInteger(guard.maxPages) && guard.maxPages > 0 ? guard.maxPages : 1000
  const items = []
  let offset = Number.isSafeInteger(options.offset) && options.offset > 0 ? options.offset : 0
  for (let page = 0; page < maxPages; page += 1) {
    const result = fetchPage({ ...options, offset })
    if (!result || !Array.isArray(result.items)) {
      throw new TypeError('paged reader must return an items array')
    }
    items.push(...result.items)
    const next = result.nextOffset
    if (next === null || next === undefined) return items
    if (!Number.isSafeInteger(next) || next <= offset) {
      throw new RangeError('paged reader did not advance past the current offset')
    }
    offset = next
  }
  throw new RangeError(`paged reader exceeded ${maxPages} pages`)
}

/** 批量漏洞查询只保留可定位、可判断证据缺口的字段；原始 HTTP 正文按 ID 再取。 */
export function compactVuln(v) {
  return {
    id: v.id, asset_id: v.asset_id, asset_ip: v.asset_ip, title: v.title,
    cve: v.cve, severity: v.severity, status: v.status, target: v.target,
    confidence: v.confidence, source: v.source,
    gained: String(v.gained || '').slice(0, 160),
    evidence_summary: String(v.evidence || '').slice(0, 240),
    http_evidence_count: Number(v.http_evidence_count) || 0,
    evidence_present: !!String(v.evidence || '').trim() || Number(v.http_evidence_count) > 0,
  }
}
