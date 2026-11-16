import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCveCatalog, matchCveCandidates } from '../lib/redteam/cve-knowledge.js'
import { getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

const find = id => loadCveCatalog().find(row=>row.cve.includes(id))

test('F5 advisory boundaries preserve historical source and unsupported branches', () => {
  const row=find('CVE-2022-1388')
  assert.match(row.versions,/16\\.1\\.2\\.2/)
  assert.match(row.versions,/15\\.1\\.5\\.1/)
  assert.match(row.versions,/12\\.1\\.x.*11\\.6\\.x.*无修复补丁/)
  assert.match(row.source_versions,/16\\.0\\.0/)
  assert.equal(row.verified,false)
  assert.equal(matchCveCandidates({cve:'CVE-2022-1388',version:'16.1.2.2'}).items[0].version_applicability.status,'unknown')
})

test('PAN-OS hotfix revisions and separate CVE scopes are retained without false applicability', () => {
  const row=find('CVE-2024-0012')
  assert.match(row.versions,/10\\.2\\.12-h2/)
  assert.match(row.versions,/11\\.1\\.5-h1/)
  assert.match(row.versions,/CVE-2024-9474.*10\\.1\\.x/)
  assert.match(row.advisory_note,/不是 GlobalProtect/)
  assert.equal(row.additional_advisories['CVE-2024-9474'],'https://security.paloaltonetworks.com/CVE-2024-9474')
  assert.equal(matchCveCandidates({cve:'CVE-2024-0012',version:'11.1.5'}).items[0].version_applicability.status,'unknown')
  const doc=getBundledKnowledge('fujiang:edge-device:cve-2024-0012-panos-auth-bypass')
  assert.match(doc.body,/11\\.1\\.5-h1/)
  assert.match(doc.body,/厂商核对/)
})

test('FortiOS and FortiProxy reference also includes FortiSwitchManager', () => {
  const row=find('CVE-2022-40684')
  assert.match(row.product,/FortiSwitchManager/)
  assert.match(row.versions,/FortiSwitchManager 7\\.0\\.0/)
  assert.match(row.advisory_note,/原包遗漏/)
  assert.equal(row.verified,false)
})
