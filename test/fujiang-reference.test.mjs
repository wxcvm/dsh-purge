import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadFujiangReferences } from '../lib/redteam/fujiang-reference.js'
import { loadCveCatalog } from '../lib/redteam/cve-knowledge.js'
import { listBundledKnowledge, getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

test('all original archive knowledge filenames are represented once, with nine reconstructed category guides', () => {
  const rows = loadFujiangReferences()
  assert.equal(rows.length, 176)
  assert.equal(new Set(rows.map(r=>r.id)).size,176)
  assert.equal(new Set(rows.map(r=>r.source_ref)).size,176)
  const originalPaths = readFileSync(new URL('./fixtures/fujiang-source-paths.txt', import.meta.url), 'utf8').trim().split(/\r?\n/).sort()
  assert.deepEqual(rows.map(r=>r.source_ref).sort(),originalPaths)
  assert.equal(rows.filter(r=>r.body.includes('原包参考资料')).length,164)
  const counts = Object.fromEntries(['cloud-container','edge-device','exchange-ad','gray-market','java-deser','java-web','linux-priv','triage','web-cms'].map(category=>[category,rows.filter(r=>r.fujiang_category===category).length]))
  assert.deepEqual(counts,{'cloud-container':15,'edge-device':17,'exchange-ad':15,'gray-market':60,'java-deser':10,'java-web':23,'linux-priv':12,'triage':4,'web-cms':20})
  for (const row of loadCveCatalog()) {
    const name = row.source_url.split('/').pop()
    const ref = rows.find(r=>r.source_ref==='plugin/knowledge/'+row.category+'/'+name)
    assert.ok(ref, name)
    assert.match(ref.body,/修复与缓解/)
    assert.equal(ref.verified,false)
  }
  assert.ok(rows.every(r=>r.body.length>80 && r.source.includes('0.20.13') && r.verified===false))
})

test('business, CVE and methodology summaries are searchable through the existing bundled index', () => {
  const get = id => getBundledKnowledge(id)
  const payment=listBundledKnowledge('支付回调 签名').find(r=>r.id==='fujiang:gray-market:payment-notify-forgery')
  assert.ok(payment)
  assert.equal(payment.verified,false)
  assert.equal(payment.source_ref,'plugin/knowledge/gray-market/payment-notify-forgery.md')
  assert.match(get(payment.id).body,/幂等|唯一事件键/)
  const grafana=listBundledKnowledge('CVE-2021-43798').find(r=>r.id==='fujiang:cloud-container:cve-2021-43798-grafana-file-read')
  assert.ok(grafana)
  assert.equal(grafana.review_status,'vendor-reference-reviewed')
  assert.match(get(grafana.id).body,/8\.0\.7/)
  assert.match(get('fujiang:triage:fingerprint-workflow').body,/反向代理/)
  assert.equal(listBundledKnowledge('', '富江 · 业务安全').length,60)
  assert.ok(listBundledKnowledge('支付回调').every(r=>!Object.hasOwn(r,'body')))
})

test('reference details distinguish vendor correction, historical claims and target verification', () => {
  const pg=getBundledKnowledge('fujiang:cloud-container:cve-2019-9193-postgres')
  assert.match(pg.body,/预期权限功能/)
  assert.match(pg.body,/postgresql\.org/)
  assert.equal(pg.verified,false)
  const s=getBundledKnowledge('fujiang:java-web:cve-2024-53677-struts2-s2-067')
  assert.match(s.body,/6\.4\.0/)
  assert.match(s.body,/迁移/)
  assert.equal(s.verified,false)
})
