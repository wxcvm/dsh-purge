/**
 * Manual multi-asset intake, sharing the existing importBundle transaction.
 * It never probes targets or changes vulnerability/evidence/score records.
 *
 * Upstream reference: CallMeGuLab/dsh-purge-safe redteam_batch (Apache-2.0).
 * Only the distinct manual "assets" capability is adopted; scanner-file
 * ingestion already exists in redteam_ingest.
 */
import { isIP } from 'node:net'
import { targetInScope } from './scan-runner.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const oneOf = (value, choices) => value === undefined || choices.includes(value)
const sourceOf = value => typeof value === 'string' && value.trim().length > 0

/**
 * Return accepted {index, asset} and rejected {index, ip, reason} without I/O.
 * Missing scope permits a preview, but an actual commit requires confirm=true.
 */
export function planManualAssetBatch(items, scopes = [], options = {}) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
    throw new Error('assets must contain 1..500 items')
  }
  const scope = Array.isArray(scopes) ? scopes : []
  const accepted = []
  const rejected = []
  const seen = new Set()
  for (const [index, item] of items.entries()) {
    const ip = typeof item?.ip === 'string' ? item.ip.trim() : ''
    const reject = reason => rejected.push({ index, ip: ip || null, reason })
    if (!object(item) || isIP(ip) !== 4) { reject('ipv4_required'); continue }
    if (seen.has(ip)) { reject('duplicate_in_batch'); continue }
    if (!oneOf(item.state, ['live', 'dead', 'unknown'])) { reject('invalid_state'); continue }
    if (!oneOf(item.provenance, ['active', 'passive']) || !item.provenance) {
      reject('provenance_required'); continue
    }
    if (item.tool !== undefined && typeof item.tool !== 'string') { reject('invalid_tool'); continue }
    if (['primary_name', 'discovered_at', 'first_seen'].some(key =>
      item[key] !== undefined && typeof item[key] !== 'string')) {
      reject('invalid_metadata'); continue
    }
    if (item.names !== undefined && (!Array.isArray(item.names)
      || item.names.some(n => !object(n) || !sourceOf(n.name)
        || !oneOf(n.kind, ['domain', 'hostname', 'cert_cn'])
        || !oneOf(n.provenance, ['active', 'passive'])))) {
      reject('invalid_names'); continue
    }
    if (item.ports !== undefined && (!Array.isArray(item.ports)
      || item.ports.some(p => !object(p) || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535
        || !oneOf(p.proto, ['tcp', 'udp']) || !oneOf(p.provenance, ['active', 'passive'])
        || ['service', 'product', 'version', 'banner', 'url', 'title', 'tool'].some(key =>
          p[key] !== undefined && typeof p[key] !== 'string')
        || (p.fingerprints !== undefined && (!Array.isArray(p.fingerprints)
          || p.fingerprints.some(f => !object(f)
            || ['category', 'vendor', 'product', 'version', 'evidence', 'tool'].some(key =>
              f[key] !== undefined && typeof f[key] !== 'string')
            || !oneOf(f.provenance, ['active', 'passive'])
            || (f.confidence !== undefined && (typeof f.confidence !== 'number'
              || f.confidence < 0 || f.confidence > 1)))))))) {
      reject('invalid_ports'); continue
    }
    const check = targetInScope(scope, ip, {
      // Preview never writes. An unscoped commit requires an explicit confirmation.
      confirm: options.commit !== true || options.confirm === true,
    })
    if (!check.ok) { reject(check.reason); continue }
    seen.add(ip)
    accepted.push({
      index,
      asset: {
        ip, state: item.state || 'unknown', provenance: item.provenance,
        tool: item.tool || 'manual-batch', primary_name: item.primary_name,
        discovered_at: item.discovered_at, first_seen: item.first_seen,
        names: item.names || [], ports: item.ports || [],
      },
    })
  }
  return { total: items.length, accepted, rejected, unscoped: scope.length === 0 }
}


/**
 * Offline preview of manual assessments for assets that already exist in this
 * engagement. The caller supplies a read-only lookup; this helper never writes,
 * scans, creates a finding, or silently changes an asset's test/score state.
 */
export function planManualAssessmentBatch(items, resolveAsset, scopes = [], options = {}) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
    throw new Error('assess items must contain 1..200 entries')
  }
  if (typeof resolveAsset !== 'function') throw new TypeError('resolveAsset must be a function')
  const scope = Array.isArray(scopes) ? scopes : []
  const accepted = []
  const rejected = []
  const seen = new Set()
  for (const [index, item] of items.entries()) {
    const reject = reason => rejected.push({ index, reason })
    if (!object(item)) { reject('invalid_item'); continue }
    const hasId = item.asset_id !== undefined && item.asset_id !== null
    const hasIp = typeof item.ip === 'string' && item.ip.trim() !== ''
    if (!hasId && !hasIp) { reject('asset_reference_required'); continue }
    if (hasId && (!Number.isSafeInteger(item.asset_id) || item.asset_id < 1)) {
      reject('invalid_asset_id'); continue
    }
    if (item.ip !== undefined && (!hasIp || isIP(item.ip.trim()) !== 4)) {
      reject('invalid_ip'); continue
    }
    if (!['high', 'medium', 'low'].includes(item.priority)) {
      reject('priority_required'); continue
    }
    if (!sourceOf(item.reason)) { reject('reason_required'); continue }
    if (item.potential !== undefined && typeof item.potential !== 'string') {
      reject('invalid_potential'); continue
    }
    if (item.assessed_by !== undefined && typeof item.assessed_by !== 'string') {
      reject('invalid_assessed_by'); continue
    }
    const asset = resolveAsset(item)
    if (!asset || !Number.isSafeInteger(asset.id) || typeof asset.ip !== 'string') {
      reject('asset_not_found'); continue
    }
    if (hasIp && item.ip.trim() !== asset.ip) {
      reject('asset_reference_mismatch'); continue
    }
    if (seen.has(asset.id)) { reject('duplicate_in_batch'); continue }
    const inScope = targetInScope(scope, asset.ip, {
      confirm: options.commit !== true || options.confirm === true,
    })
    if (!inScope.ok) { reject(inScope.reason); continue }
    seen.add(asset.id)
    accepted.push({
      index, asset_id: asset.id, ip: asset.ip,
      assessment: {
        asset_id: asset.id, priority: item.priority, reason: item.reason.trim(),
        ...(item.potential !== undefined ? { potential: item.potential } : {}),
        ...(item.assessed_by !== undefined ? { assessed_by: item.assessed_by } : {}),
      },
    })
  }
  return { total: items.length, accepted, rejected, unscoped: scope.length === 0 }
}
