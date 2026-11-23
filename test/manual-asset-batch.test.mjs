import test from 'node:test'
import assert from 'node:assert/strict'
import { planManualAssetBatch, planManualAssessmentBatch } from '../lib/redteam/manual-asset-batch.js'

const asset = (ip, extra = {}) => ({
  ip, provenance: 'passive', tool: 'import-fixture', state: 'unknown',
  ...extra,
})

test('batch planner is offline, separates in-scope records and identifies each reject', () => {
  const planned = planManualAssetBatch([
    asset('192.0.2.10', { ports: [{ port: 443, service: 'https', proto: 'tcp' }] }),
    asset('198.51.100.1'),
    asset('192.0.2.10'),
    asset('not-ip'),
    asset('192.0.2.12', { provenance: 'unknown' }),
    asset('192.0.2.13', { ports: [{ port: 65536 }] }),
  ], ['192.0.2.0/24'], { commit: true })
  assert.equal(planned.total, 6)
  assert.deepEqual(planned.accepted.map(row => row.asset.ip), ['192.0.2.10'])
  assert.deepEqual(planned.rejected.map(row => [row.index, row.reason]), [
    [1, 'outside-scope'], [2, 'duplicate_in_batch'], [3, 'ipv4_required'],
    [4, 'provenance_required'], [5, 'invalid_ports'],
  ])
})

test('unscoped preview is allowed, but commit requires explicit confirm', () => {
  const rows = [asset('203.0.113.20')]
  const preview = planManualAssetBatch(rows, [], { commit: false })
  assert.equal(preview.unscoped, true)
  assert.equal(preview.accepted.length, 1)
  const denied = planManualAssetBatch(rows, [], { commit: true })
  assert.equal(denied.accepted.length, 0)
  assert.equal(denied.rejected[0].reason, 'scope-empty-needs-confirm')
  const allowed = planManualAssetBatch(rows, [], { commit: true, confirm: true })
  assert.equal(allowed.accepted.length, 1)
})

test('invalid names, duplicate entries, and empty/overlong batches fail closed', () => {
  assert.deepEqual(
    planManualAssetBatch([asset('192.0.2.8', { names: [{ name: '' }] })], ['192.0.2.0/24']).rejected
      .map(row => row.reason), ['invalid_names'])
  assert.deepEqual(
    planManualAssetBatch([asset('192.0.2.9'), asset('192.0.2.9')], ['192.0.2.0/24']).rejected
      .map(row => row.reason), ['duplicate_in_batch'])
  assert.throws(() => planManualAssetBatch([]), /1\.\.500/)
  assert.throws(() => planManualAssetBatch(Array.from({ length: 501 }, (_, i) => asset('192.0.2.1'))), /1\.\.500/)
})


test('manual assessment planner resolves existing assets and reports per-item rejections without writes', () => {
  const assets = [{ id: 7, ip: '192.0.2.20' }, { id: 8, ip: '198.51.100.20' }]
  let lookups = 0
  const resolve = item => {
    lookups += 1
    return assets.find(asset => item.asset_id != null
      ? asset.id === item.asset_id : asset.ip === item.ip) || null
  }
  const plan = planManualAssessmentBatch([
    { asset_id: 7, ip: '192.0.2.20', priority: 'high', reason: 'observed service banner' },
    { asset_id: 8, priority: 'low', reason: 'separate network' },
    { asset_id: 7, priority: 'medium', reason: 'duplicate assessment' },
    { asset_id: 999, priority: 'high', reason: 'unknown asset' },
    { asset_id: 8, ip: '192.0.2.20', priority: 'high', reason: 'identity mismatch' },
    { asset_id: 7, priority: 'unknown', reason: 'invalid priority' },
    { asset_id: 7, priority: 'high', reason: '' },
  ], resolve, ['192.0.2.0/24'], { commit: true })
  assert.equal(plan.accepted.length, 1)
  assert.equal(plan.accepted[0].asset_id, 7)
  assert.deepEqual(plan.rejected.map(row => [row.index, row.reason]), [
    [1, 'outside-scope'], [2, 'duplicate_in_batch'], [3, 'asset_not_found'],
    [4, 'asset_reference_mismatch'], [5, 'priority_required'], [6, 'reason_required'],
  ])
  assert.equal(lookups, 5, 'invalid inputs do not need database lookups')
})

test('assessment preview of an unscoped engagement is allowed; commit requires confirmation', () => {
  const item = [{ ip: '203.0.113.2', priority: 'medium', reason: 'manual review' }]
  const resolve = () => ({ id: 15, ip: '203.0.113.2' })
  assert.equal(planManualAssessmentBatch(item, resolve, [], { commit: false }).accepted.length, 1)
  assert.equal(planManualAssessmentBatch(item, resolve, [], { commit: true }).rejected[0].reason,
    'scope-empty-needs-confirm')
  assert.equal(planManualAssessmentBatch(item, resolve, [], { commit: true, confirm: true }).accepted.length, 1)
  assert.throws(() => planManualAssessmentBatch([], resolve), /1\.\.200/)
  assert.throws(() => planManualAssessmentBatch(Array.from({ length: 201 }, () => item[0]), resolve), /1\.\.200/)
})
