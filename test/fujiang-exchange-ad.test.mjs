import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCveCatalog, matchCveCandidates } from '../lib/redteam/cve-knowledge.js'
import { getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

test('all fourteen Exchange and AD references retain historical sources and corrected advisory context', () => {
  const rows = loadCveCatalog().filter(row => row.category === 'exchange-ad')
  assert.equal(rows.length, 14)
  for (const row of rows) {
    assert.equal(row.verified, false)
    assert.equal(row.advisory_status, 'vendor-corrected')
    assert.ok(row.version_reference)
    const name = row.source_url.split('/').pop().replace(/\.md$/, '')
    const reference = getBundledKnowledge('fujiang:exchange-ad:' + name)
    assert.ok(reference, name)
    assert.equal(reference.verified, false)
    assert.match(reference.body, /原始资料元数据/)
    assert.match(reference.body, /修复与缓解/)
  }
})

test('Exchange and AD corrections distinguish security updates, configuration and independent CVEs', () => {
  const get = name => getBundledKnowledge('fujiang:exchange-ad:' + name).body
  assert.match(get('adcs-esc1-esc8'), /不适用（配置类风险，无单一 CVE）/)
  assert.match(get('adcs-esc1-esc8'), /EPA/)
  assert.match(get('cve-2017-0144-eternalblue'), /MS17-010/)
  assert.match(get('cve-2020-0688-exchange-viewstate'), /2016 CU14\/CU15/)
  assert.match(get('cve-2020-1472-zerologon'), /2021-02-09/)
  assert.match(get('cve-2021-26855-proxylogon'), /2010 仅涉及 CVE-2021-26857/)
  assert.match(get('cve-2021-34473-proxyshell'), /2021-04 和 2021-05/)
  assert.match(get('cve-2021-34527-printnightmare'), /2021-08-10/)
  assert.match(get('cve-2021-42287-nopac'), /2022-10-11/)
  assert.match(get('cve-2021-42321-exchange-deser'), /2013 不受此 CVE 影响/)
  assert.match(get('cve-2022-30190-follina'), /KB5015805/)
  assert.match(get('cve-2022-41040-proxynotshell'), /MFA 不是/)
  assert.match(get('cve-2024-21410-exchange-ntlm-relay'), /CU14 若选择退出/)
  assert.match(get('cve-2024-21413-outlook-monikerlink'), /客户端构建/)
  assert.match(get('cve-2024-45519-zimbra-postjournal'), /MITRE CNA 10\.0/)
  for (const cve of ['CVE-2021-26855','CVE-2021-26857','CVE-2021-26858','CVE-2021-27065','CVE-2021-34473','CVE-2021-34523','CVE-2021-31207']) {
    const result = matchCveCandidates({cve})
    assert.equal(result.total, 1, cve)
    assert.ok(result.items[0].cve.includes(cve))
    assert.equal(result.items[0].verified, false)
    assert.equal(result.items[0].version_applicability.status, 'unknown')
  }
  assert.equal(matchCveCandidates({cve:'CVE-2024-21410', version:'15.2.1544.4'}).items[0].version_applicability.status, 'unknown')
})
