import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCveCatalog, matchCveCandidates } from '../lib/redteam/cve-knowledge.js'
import { getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'
const find = id => loadCveCatalog().find(row => row.cve.includes(id))

test('FortiManager advisory separates local, cloud and older product branches', () => {
  const row = find('CVE-2024-47575')
  for (const value of ['6.2.13','6.4.15','7.2.8','7.4.5','Cloud 7.6 不受影响']) assert.ok(row.versions.includes(value), value)
  assert.ok(row.source_versions.includes('7.2.5'))
  assert.equal(row.verified,false)
  assert.equal(matchCveCandidates({cve:'CVE-2024-47575',version:'7.4.5'}).items[0].version_applicability.status,'unknown')
})

test('GoAnywhere historical 6.x claim is not presented as a fixed boundary', () => {
  const row = find('CVE-2024-0204')
  assert.ok(row.versions.includes('6.0.1'))
  assert.ok(!row.versions.includes('6.4.3'))
  assert.ok(row.source_versions.includes('6.4.3'))
  assert.ok(row.versions.includes('7.4.1'))
})

test('Citrix build-specific patches retain all five ADC branches and WANOP scope', () => {
  const row = find('CVE-2019-19781')
  for (const build of ['10.5.70.12','11.1.63.15','12.0.63.13','12.1.55.18','13.0.47.24','10.2.6b','11.0.3b']) assert.ok(row.versions.includes(build),build)
  assert.ok(row.source_versions.includes('2019-12'))
  assert.equal(matchCveCandidates({cve:'CVE-2019-19781',version:'13.0.47.24'}).items[0].version_applicability.status,'unknown')
})

test('FortiClient EMS fixes the advisory reference and preserves distinct patch branches', () => {
  const row = find('CVE-2023-48788')
  assert.ok(row.advisory_note.includes('FG-IR-24-007'))
  const match = version => matchCveCandidates({cve:'CVE-2023-48788',version}).items[0].version_applicability.status
  assert.equal(match('7.0.10'),'affected')
  assert.equal(match('7.0.11'),'not_affected')
  assert.equal(match('7.2.2'),'affected')
  assert.equal(match('7.2.3'),'not_affected')
  assert.equal(row.verified,false)
})

test('FortiOS MFA reference distinguishes version and configuration', () => {
  const row = find('CVE-2020-12812')
  assert.ok(row.advisory_note.includes('远程身份认证'))
  assert.ok(row.advisory_note.includes('不能仅凭版本'))
  assert.equal(row.verified,false)
  const doc = getBundledKnowledge('fujiang:edge-device:cve-2020-12812-fortios-2fa-case-bypass')
  assert.ok(doc.body.includes('FortiToken'))
})
