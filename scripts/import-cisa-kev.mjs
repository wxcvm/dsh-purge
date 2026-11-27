import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUTPUT = resolve(ROOT, 'lib/redteam/cve-catalog/cisa-kev.json')
const CISA_CATALOG_URL = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog'
const CISA_FEED_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'

function clean(value) {
  return String(value ?? '').trim()
}

function keywordsFor(parts) {
  const words = parts.join(' ').toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) || []
  return [...new Set(words)]
}

/**
 * Convert a downloaded official CISA KEV JSON snapshot to Purge's offline
 * catalog schema. No network requests are made by this importer.
 */
export function normalizeCisaKevPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.vulnerabilities)) {
    throw new TypeError('CISA KEV payload must contain a vulnerabilities array')
  }
  const catalogVersion = clean(payload.catalogVersion)
  const dateReleased = clean(payload.dateReleased)
  const mirrorCommit = clean(options?.sourceCatalogCommit)
  if (mirrorCommit && !/^[\da-f]{40}$/i.test(mirrorCommit)) {
    throw new Error('CISA mirror commit must be a 40-character hexadecimal SHA')
  }
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(catalogVersion) || !dateReleased) {
    throw new Error('CISA KEV catalogVersion/dateReleased is missing or invalid')
  }
  if (Number(payload.count) !== payload.vulnerabilities.length) {
    throw new Error('CISA KEV count does not match vulnerabilities.length')
  }
  const seen = new Set()
  return payload.vulnerabilities.map((entry, index) => {
    const cve = clean(entry?.cveID).toUpperCase()
    if (!/^CVE-\d{4}-\d{4,}$/.test(cve)) throw new Error('Invalid CISA CVE ID at row ' + index)
    if (seen.has(cve)) throw new Error('Duplicate CISA CVE ID: ' + cve)
    seen.add(cve)
    const vendor = clean(entry.vendorProject)
    const productName = clean(entry.product)
    const title = clean(entry.vulnerabilityName)
    if (!vendor || !productName || !title) throw new Error('Missing vendor/product/title for ' + cve)
    const cwes = Array.isArray(entry.cwes) ? entry.cwes.map(clean).filter(Boolean) : []
    return {
      title,
      cve: [cve],
      severity: 'unknown',
      product: vendor + ' ' + productName,
      versions: 'CISA KEV 未提供受影响版本范围',
      source_versions: '',
      ports: [],
      keywords: keywordsFor([vendor, productName, title, ...cwes]),
      verified: false,
      source_url: CISA_CATALOG_URL,
      advisory_status: 'cisa-kev',
      advisory_note: 'CISA KEV 将此 CVE 列为已知遭利用漏洞；该目录不提供受影响版本边界，不能据此单独判定 affected/not_affected。',
      source_catalog: 'CISA Known Exploited Vulnerabilities',
      source_catalog_version: catalogVersion,
      source_catalog_date_released: dateReleased,
      source_catalog_count: payload.count,
      ...(mirrorCommit ? { source_catalog_commit: mirrorCommit } : {}),
      source_license: 'CC0-1.0',
      source_feed_url: CISA_FEED_URL,
      source_vendor_project: vendor,
      source_product: productName,
      source_date_added: clean(entry.dateAdded),
      source_due_date: clean(entry.dueDate),
      source_description: clean(entry.shortDescription),
      source_required_action: clean(entry.requiredAction),
      source_ransomware_use: clean(entry.knownRansomwareCampaignUse) || 'Unknown',
      source_forensic_triage: clean(entry.forensicTriage),
      source_notes: clean(entry.notes),
      source_cwes: cwes,
    }
  })
}

function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Usage: node scripts/import-cisa-kev.mjs <downloaded-CISA-KEV.json> [output.json]')
  const payload = JSON.parse(readFileSync(resolve(input), 'utf8'))
  const rows = normalizeCisaKevPayload(payload, { sourceCatalogCommit: process.env.CISA_KEV_MIRROR_COMMIT })
  const output = resolve(process.argv[3] || DEFAULT_OUTPUT)
  const serialized = '[\n' + rows.map(row => '  ' + JSON.stringify(row)).join(',\n') + '\n]\n'
  writeFileSync(output, serialized, 'utf8')
  process.stdout.write('Imported ' + rows.length + ' unique CISA KEV CVEs (' + payload.catalogVersion + ') to ' + output + '\n')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main()
