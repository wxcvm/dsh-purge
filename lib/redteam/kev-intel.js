/**
 * Opt-in CISA Known Exploited Vulnerabilities reference feed.
 *
 * The cache is global to the Purge redteam data root and never touches target
 * records. Only refreshKev() performs network I/O, on explicit invocation.
 * CISA catalog inclusion does not establish that a particular asset is affected.
 * Source: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 * Adapted from the upstream dsh-purge-safe KEV reference layer (Apache-2.0).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'

export const KEV_FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const CACHE_VERSION = 1
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_BYTES = 12 * 1024 * 1024
const fileOf = root => join(root, 'kb', 'cisa-kev.json')
const cveId = value => {
  const id = String(value || '').trim().toUpperCase()
  return /^CVE-\d{4}-\d{4,}$/.test(id) ? id : ''
}
const short = value => String(value ?? '').slice(0, 250)

function readCache(root) {
  try {
    const data = JSON.parse(readFileSync(fileOf(root), 'utf8'))
    if (data.version !== CACHE_VERSION || !Number.isFinite(data.fetched_at)
        || !Array.isArray(data.items) || data.items.length === 0) throw new Error('invalid')
    return { data }
  } catch (error) {
    return { reason: error?.code === 'ENOENT' ? 'not_downloaded' : 'invalid_cache' }
  }
}

export function kevStatus(root, now = Date.now()) {
  const cache = readCache(root)
  if (!cache.data) return { ok: true, available: false, count: 0, reason: cache.reason, source: KEV_FEED }
  const ageMs = Math.max(0, now - cache.data.fetched_at)
  return {
    ok: true, available: true, count: cache.data.items.length,
    fetched_at: new Date(cache.data.fetched_at).toISOString(),
    age_hours: Math.round(ageMs / 360000) / 10,
    stale: ageMs > TTL_MS, source: KEV_FEED,
  }
}

export function lookupKev(root, value, now = Date.now()) {
  const cve = cveId(value)
  if (!cve) return { ok: false, error: '请输入完整 CVE 编号（例如 CVE-2021-44228）' }
  const status = kevStatus(root, now)
  if (!status.available) return { ...status, cve, known_exploited: null,
    note: '尚无可用的 CISA KEV 缓存，不能把没有命中说成未被收录。' }
  const item = readCache(root).data?.items.find(row => row.cve === cve) || null
  return { ...status, cve, known_exploited: !!item, item,
    note: item ? 'CISA 已收录该 CVE；不表示任何特定资产已经确认受影响。'
      : '当前缓存未收录该 CVE；不表示漏洞不存在或未被利用。' }
}

function slimFeed(raw, now) {
  if (!Array.isArray(raw?.vulnerabilities) || !raw.vulnerabilities.length) throw new Error('invalid_feed')
  const seen = new Set()
  const items = []
  for (const row of raw.vulnerabilities) {
    const cve = cveId(row?.cveID)
    if (!cve || seen.has(cve)) continue
    seen.add(cve)
    items.push({
      cve, vendor: short(row.vendorProject), product: short(row.product),
      name: short(row.vulnerabilityName), added: short(row.dateAdded),
      ransomware: row.knownRansomwareCampaignUse === 'Known',
    })
  }
  if (!items.length) throw new Error('invalid_feed')
  return { version: CACHE_VERSION, fetched_at: now, items }
}

/** Explicit refresh only; no startup fetch, no automatic retry, no target access. */
export async function refreshKev(root, options = {}) {
  const fetchFn = options.fetchFn || fetch
  const now = options.now ?? Date.now()
  try {
    const response = await fetchFn(KEV_FEED, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('http_' + response.status)
    const advertised = Number(response.headers?.get?.('content-length') || 0)
    if (advertised > MAX_BYTES) throw new Error('feed_too_large')
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) throw new Error('feed_too_large')
    const payload = slimFeed(JSON.parse(Buffer.from(bytes).toString('utf8')), now)
    mkdirSync(join(root, 'kb'), { recursive: true })
    atomicWriteFileSync(fileOf(root), JSON.stringify(payload))
    return { ...kevStatus(root, now), action: 'refreshed' }
  } catch (error) {
    return { ok: false, action: 'failed', reason: String(error?.message || 'refresh_failed').slice(0, 120),
      previous: kevStatus(root, now) }
  }
}
