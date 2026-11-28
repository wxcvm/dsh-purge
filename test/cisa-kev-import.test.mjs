import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCisaKevPayload } from '../scripts/import-cisa-kev.mjs'

const sample = {
  catalogVersion: '2026.11.25',
  dateReleased: '2026-11-25T19:48:12.4344Z',
  count: 1,
  vulnerabilities: [{
    cveID: 'CVE-2026-103406',
    vendorProject: 'Hewlett Packard Enterprise (HPE)',
    product: 'Juniper Session Smart Conductor and Session Smart Router',
    vulnerabilityName: 'OS Command Injection Vulnerability',
    dateAdded: '2026-11-25',
    shortDescription: 'A command injection vulnerability.',
    requiredAction: 'Apply vendor mitigations.',
    dueDate: '2026-11-28',
    knownRansomwareCampaignUse: 'Unknown',
    forensicTriage: 'Yes',
    notes: 'https://nvd.nist.gov/vuln/detail/CVE-2026-103406',
    cwes: ['CWE-78'],
  }],
}

test('normalize CISA KEV preserves source provenance and leaves version applicability unknown', () => {
  const [row] = normalizeCisaKevPayload(sample)
  assert.equal(row.cve[0], 'CVE-2026-103406')
  assert.equal(row.advisory_status, 'cisa-kev')
  assert.equal(row.verified, false)
  assert.equal(row.severity, 'unknown')
  assert.equal(row.source_catalog_version, '2026.11.25')
  assert.equal(row.source_ransomware_use, 'Unknown')
  assert.deepEqual(row.source_cwes, ['CWE-78'])
  assert.equal(row.source_versions, '')
  assert.equal(row.source_catalog_commit, undefined)
  assert.equal(row.versions, 'CISA KEV 未提供受影响版本范围')
  const [mirrored] = normalizeCisaKevPayload(sample, {
    sourceCatalogCommit: '51e0a777743fa06957afbaeb280f8735d292c1be',
  })
  assert.equal(mirrored.source_catalog_commit, '51e0a777743fa06957afbaeb280f8735d292c1be')
  assert.throws(() => normalizeCisaKevPayload(sample, { sourceCatalogCommit: 'not-a-commit' }), /40-character/)
})

test('normalize CISA KEV rejects mismatched counts, malformed IDs and duplicate IDs', () => {
  assert.throws(() => normalizeCisaKevPayload({ ...sample, count: 2 }), /count does not match/)
  assert.throws(() => normalizeCisaKevPayload({ ...sample, vulnerabilities: [{ ...sample.vulnerabilities[0], cveID: 'not-a-cve' }] }), /Invalid CISA CVE ID/)
  assert.throws(() => normalizeCisaKevPayload({ ...sample, count: 2, vulnerabilities: [sample.vulnerabilities[0], sample.vulnerabilities[0]] }), /Duplicate CISA CVE ID/)
})
