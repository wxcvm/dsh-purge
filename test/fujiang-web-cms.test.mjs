import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCveCatalog, matchCveCandidates } from '../lib/redteam/cve-knowledge.js'
import { getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

test('all nineteen Web CMS references retain source metadata and reviewed scope', () => {
  const rows = loadCveCatalog().filter(row => row.category === 'web-cms')
  assert.equal(rows.length, 19)
  assert.equal(rows.filter(row => row.cve.length > 0).length, 12)
  assert.equal(rows.filter(row => row.cve.length === 0).length, 7)
  for (const row of rows) {
    assert.equal(row.verified, false)
    assert.ok(row.version_reference)
    assert.equal(row.advisory_status, row.cve.length ? 'vendor-corrected' : 'guidance-reviewed')
    const name = row.source_url.split('/').pop().replace(/\.md$/, '')
    const ref = getBundledKnowledge('fujiang:web-cms:' + name)
    assert.ok(ref, name)
    assert.equal(ref.verified, false)
    assert.match(ref.body, /原始资料元数据/)
    assert.match(ref.body, /修复与缓解/)
    if (!row.cve.length) assert.match(ref.body, /不适用（配置类风险，无单一 CVE）/)
  }
})

test('Web CMS corrections distinguish dependencies, version branches and configuration', () => {
  const get = name => getBundledKnowledge('fujiang:web-cms:' + name).body
  assert.match(get('cve-2017-9841-phpunit'), /4\.8\.28/)
  assert.match(get('cve-2018-7600-drupalgeddon2'), /8\.0–8\.2/)
  assert.match(get('cve-2019-11043-phpfpm-underflow'), /7\.3\.11/)
  assert.match(get('cve-2019-16759-vbulletin'), /补丁级别/)
  assert.match(get('cve-2021-3129-laravel-ignition'), /1\.6\.15、1\.16\.14、2\.4\.2、2\.5\.2/)
  assert.match(get('cve-2021-41773-apache-path-traversal'), /2\.4\.51/)
  assert.match(get('cve-2023-23752-joomla-config-leak'), /4\.2\.8/)
  assert.match(get('cve-2023-6553-backup-migration-rce'), /1\.3\.8/)
  assert.match(get('cve-2024-25600-bricks-rce'), /1\.9\.6\.1 已修复/)
  assert.match(get('cve-2024-27956-wp-automatic-sqli'), /3\.92\.1/)
  assert.match(get('cve-2024-4577-phpcgi-windows'), /8\.1\.29/)
  assert.match(get('thinkphp5-rce'), /NoneCms 1\.3/)
  assert.match(get('thinkphp5-rce'), /ThinkPHP <3\.2\.4/)
  assert.match(get('command-injection'), /独立参数数组/)
  assert.match(get('lfi-to-rce'), /固定文件映射/)
  assert.match(get('nginx-alias-traversal'), /尾斜杠/)
  assert.match(get('php-object-injection'), /allowed_classes/)
  assert.match(get('sqli-union-error'), /参数化查询/)
  assert.match(get('ssti-rce'), /固定可信模板/)
  assert.match(get('xxe-file-read'), /禁用 DTD/)
  const status = (cve, version) => matchCveCandidates({cve, version}).items[0].version_applicability.status
  for (const [cve, affected, fixed] of [
    ['CVE-2018-7600','8.2.0','8.3.9'],
    ['CVE-2018-7600','8.4.5','8.4.6'],
    ['CVE-2023-23752','4.2.7','4.2.8'],
    ['CVE-2023-6553','1.3.7','1.3.8'],
    ['CVE-2024-27956','3.92.0','3.92.1']
  ]) {
    assert.equal(status(cve, affected), 'affected')
    assert.equal(status(cve, fixed), 'not_affected')
  }
  assert.equal(status('CVE-2024-25600','1.9.6.1'), 'unknown')
  assert.equal(status('CVE-2018-20062','5.0.23'), 'unknown')
})
