import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCveCatalog, matchCveCandidates } from '../lib/redteam/cve-knowledge.js'
import { getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

test('all eleven Linux references retain historical source and distro-specific advisory context', () => {
  const rows = loadCveCatalog().filter(row => row.category === 'linux-priv')
  assert.equal(rows.length, 11)
  for (const row of rows) {
    assert.equal(row.verified, false)
    assert.equal(row.advisory_status, 'vendor-corrected')
    assert.match(row.version_reference, /^https:\/\/ubuntu\.com\/security\/CVE-/)
    const name = row.source_url.split('/').pop().replace(/\.md$/, '')
    const ref = getBundledKnowledge('fujiang:linux-priv:' + name)
    assert.ok(ref, name)
    assert.equal(ref.verified, false)
    assert.match(ref.body, /原始资料元数据/)
    assert.match(ref.body, /修复与缓解/)
    assert.match(ref.body, /厂商/)
    for (const cve of row.cve) {
      const hit = matchCveCandidates({cve, version:'5.15.0'}).items[0]
      assert.ok(hit, cve)
      assert.equal(hit.version_applicability.status, 'unknown')
      assert.equal(hit.verified, false)
    }
  }
})

test('Linux advisory corrections preserve backport, configuration and upstream branch distinctions', () => {
  const get = name => getBundledKnowledge('fujiang:linux-priv:' + name).body
  assert.match(get('cve-2021-3156-baron-samedit'), /1\.8\.31-1ubuntu1\.2/)
  assert.match(get('cve-2021-3493-ubuntu-overlayfs'), /非特权挂载之前的 Ubuntu 回补/)
  assert.match(get('cve-2021-4034-pwnkit'), /2022-01-25/)
  assert.match(get('cve-2022-0185-fs-context-overflow'), /5\.4\.0-96\.109/)
  assert.match(get('cve-2022-0847-dirtypipe'), /5\.10\.102、5\.15\.25、5\.16\.11/)
  assert.match(get('cve-2023-0386-overlayfs'), /20\.04 generic 不受影响/)
  assert.match(get('cve-2023-22809-sudo-edit'), /1\.9\.12p2/)
  assert.match(get('cve-2023-2640-gameoverlay'), /CVE-2023-32629/)
  assert.match(get('cve-2023-32233-nftables'), /独立状态表/)
  assert.match(get('cve-2024-0582-io-uring-uaf'), /IORING_REGISTER_PBUF_RING/)
  assert.match(get('cve-2024-0582-io-uring-uaf'), /6\.5\.0-21\.21/)
  assert.match(get('cve-2024-1086-nftables'), /4\.15\.0-223\.235/)
})
