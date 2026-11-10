/**
 * Read-only cross-store candidate reconciliation. ARTEX and DSH integer IDs
 * are unrelated; match only exact IP or domain/alias, then verify open ports
 * when the ARTEX record identifies a service.
 */
const host = (value) => typeof value === 'string'
  ? value.trim().toLowerCase().replace(/\.$/, '') : ''

export function matchArtexSourceAssets(db, refs) {
  if (!Array.isArray(refs)) throw new Error('ARTEX 资产列表无效')
  const lookup = db.prepare(`SELECT a.id, a.ip, a.primary_name,
      (lower(a.ip) = NULLIF(?, '')) AS ip_match,
      (lower(a.primary_name) = NULLIF(?, '')) AS name_match,
      EXISTS (SELECT 1 FROM asset_name n WHERE n.asset_id = a.id AND lower(n.name) = NULLIF(?, '')) AS alias_match
    FROM asset a
    WHERE lower(a.ip) = NULLIF(?, '') OR lower(a.primary_name) = NULLIF(?, '')
      OR EXISTS (SELECT 1 FROM asset_name n WHERE n.asset_id = a.id AND lower(n.name) = NULLIF(?, ''))
    ORDER BY a.id LIMIT 21`)
  const hasPort = db.prepare("SELECT 1 FROM port WHERE asset_id = ? AND port = ? AND state = 'open' LIMIT 1")
  const items = []
  for (const raw of refs) {
    const ref = raw && typeof raw === 'object' ? raw : {}
    const sourceID = ref.asset_id
    if (!Number.isSafeInteger(sourceID) || sourceID <= 0) throw new Error('ARTEX 来源资产 ID 无效')
    const ip = host(ref.ip)
    const domain = host(ref.domain)
    const port = Number.isSafeInteger(ref.port) && ref.port >= 1 && ref.port <= 65535 ? ref.port : null
    const service = port !== null || ref.type === 'service' || ref.type === 'endpoint'
    if (!ip && !domain) {
      items.push({ source_asset_id: sourceID, status: 'unavailable', candidates: [] })
      continue
    }
    const rows = lookup.all(ip, domain, domain, ip, domain, domain)
    const candidates = rows.map((row) => {
      const reasons = []
      if (row.ip_match) reasons.push('ip')
      if (row.name_match || row.alias_match) reasons.push('domain')
      const portMatch = port !== null && !!hasPort.get(row.id, port)
      return {
        dsh_asset_id: row.id,
        ip: row.ip,
        primary_name: row.primary_name || null,
        matched_by: reasons.join('+'),
        port_match: portMatch,
      }
    })
    // Exact source service requires host AND open port; a host alone is a hint.
    const strong = service ? candidates.filter((c) => c.port_match) : candidates
    const status = strong.length === 1 && rows.length <= 20 ? 'matched'
      : strong.length > 1 || rows.length > 20 ? 'ambiguous'
      : candidates.length > 0 ? 'host_only' : 'unmatched'
    items.push({
      source_asset_id: sourceID,
      status,
      candidates: (strong.length ? strong : candidates).slice(0, 20),
      candidates_truncated: rows.length > 20,
    })
  }
  return {
    matched: items.filter((x) => x.status === 'matched').length,
    ambiguous: items.filter((x) => x.status === 'ambiguous').length,
    host_only: items.filter((x) => x.status === 'host_only').length,
    unmatched: items.filter((x) => x.status === 'unmatched').length,
    unavailable: items.filter((x) => x.status === 'unavailable').length,
    items,
    read_only: true,
  }
}

/**
 * Attach source-to-DSH match outcomes to a bounded human review queue.
 * Only an unambiguous strong match receives dsh_asset_id. All other matches
 * remain explicitly labeled as leads, not verified vulnerability mappings.
 */
export function correlateArtexReviewQueue(queue, matches) {
  const bySource = new Map((Array.isArray(matches?.items) ? matches.items : [])
    .map((entry) => [entry.source_asset_id, entry]))
  return (Array.isArray(queue) ? queue : []).slice(0, 20).map((finding) => {
    const ids = [...new Set((Array.isArray(finding.asset_ids) ? finding.asset_ids : [])
      .filter((id) => Number.isSafeInteger(id) && id > 0))]
    const links = ids.map((sourceID) => {
      const match = bySource.get(sourceID)
      const status = match?.status || 'not_compared'
      const candidates = Array.isArray(match?.candidates) ? match.candidates : []
      const exact = status === 'matched' && candidates.length === 1
      return {
        source_asset_id: sourceID,
        status,
        dsh_asset_id: exact ? candidates[0].dsh_asset_id : null,
        candidate_dsh_asset_ids: exact ? [] : candidates.map((candidate) => candidate.dsh_asset_id),
      }
    })
    return { finding_id: finding.finding_id, links }
  })
}
