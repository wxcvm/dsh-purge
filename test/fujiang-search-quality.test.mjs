import test from 'node:test'
import assert from 'node:assert/strict'
import { listBundledKnowledge, getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

test('exact CVE searches prioritize the primary reference over guides and incidental mentions', () => {
  const id = 'fujiang:cloud-container:cve-2021-43798-grafana-file-read'
  for (const query of ['CVE-2021-43798', 'cve 2021 43798', 'ＣＶＥ－２０２１－４３７９８', 'CVE_2021_43798', 'CVE–2021–43798']) {
    const rows = listBundledKnowledge(query)
    assert.equal(rows[0]?.id, id, query)
    assert.equal(rows[0].verified, false)
    assert.ok(rows.every(row => !Object.hasOwn(row, 'body')))
  }
  assert.equal(listBundledKnowledge('CVE-2021-437980').length, 0)
  assert.equal(listBundledKnowledge('CVE-2021-43798', '富江 · 业务安全').length, 0)
  const article = getBundledKnowledge(id)
  assert.deepEqual(article.cve_ids, ['CVE-2021-43798'])
  assert.ok(article.advisory_url.startsWith('https://'))
  assert.equal(listBundledKnowledge('CVE-2021-43798')[0].advisory_url, article.advisory_url)
  assert.notEqual(article.source_url, article.advisory_url)
  assert.equal(article.verified, false)
})

test('multiple CVE identifiers and ordinary component spellings retain search semantics', () => {
  const apache = 'fujiang:web-cms:cve-2021-41773-apache-path-traversal'
  assert.equal(listBundledKnowledge('CVE-2021-42013')[0]?.id, apache)
  assert.equal(listBundledKnowledge('CVE-2021-41773 CVE-2021-42013')[0]?.id, apache)
  const query = 'backup migration'
  const ids = q => listBundledKnowledge(q).map(row => row.id)
  assert.deepEqual(ids('backup-migration'), ids(query))
  assert.deepEqual(ids('ＢＡＣＫＵＰ　ＭＩＧＲＡＴＩＯＮ'), ids(query))
  assert.ok(ids(query).includes('fujiang:web-cms:cve-2023-6553-backup-migration-rce'))
  assert.ok(ids('支付回调 签名').includes('fujiang:gray-market:payment-notify-forgery'))
  assert.equal(listBundledKnowledge('', '富江 · 业务安全').length, 60)
  const web = getBundledKnowledge('fujiang:web-cms:cve-2023-23752-joomla-config-leak')
  assert.match(web.advisory_url, /joomla\.org\/security-centre/)
  assert.equal(listBundledKnowledge('CVE-2023-23752')[0].advisory_url, web.advisory_url)
  const business = getBundledKnowledge('fujiang:gray-market:payment-notify-forgery')
  assert.equal(business.advisory_url, undefined)
})
