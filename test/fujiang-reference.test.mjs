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
  assert.equal(grafana.review_status,'reference-available-not-fully-reviewed')
  assert.match(get(grafana.id).body,/8\.0\.7/)
  assert.match(get('fujiang:triage:fingerprint-workflow').body,/反代|网关/)
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


test('adding an unrelated CVE catalog entry does not break the Fujiang reference library', () => {
  const catalog = [...loadCveCatalog(), { title:'Other advisory', category:'other', source_url:'https://example.com/other.md' }]
  assert.equal(loadFujiangReferences(catalog).length,176)
})


test('methodology preserves the source authorization, evidence, cleanup and report structure', () => {
  const fingerprint=getBundledKnowledge('fujiang:triage:fingerprint-workflow').body
  const safe=getBundledKnowledge('fujiang:triage:safe-verification').body
  const report=getBundledKnowledge('fujiang:triage:report-template').body
  assert.match(fingerprint,/反代|网关/)
  assert.match(fingerprint,/CDN/)
  assert.match(safe,/默认停在 L2/)
  assert.match(safe,/授权/)
  assert.match(safe,/清理与恢复/)
  assert.doesNotMatch(safe,/\x60\x60\x60/)
  for (const heading of ['摘要','资产与指纹','验证记录','证据','影响分析','修复建议','复测','附录']) assert.ok(report.includes(heading),heading)
})

test('category indexes preserve the source guide inventory without importing attack entry examples', () => {
  const java=getBundledKnowledge('fujiang:java-web:SKILL').body
  const business=getBundledKnowledge('fujiang:gray-market:SKILL').body
  assert.match(java,/原始分类目录（22 条）/)
  assert.match(java,/cve-2024-53677-struts2-s2-067\.md/)
  assert.match(business,/原始分类目录（59 条）/)
  assert.match(business,/payment-notify-forgery\.md/)
  assert.doesNotMatch(java,/UploadFileName.*\.\./)
})

test('Apache path traversal repair summary keeps the two CVE fix boundaries separate', () => {
  const item=getBundledKnowledge('fujiang:web-cms:cve-2021-41773-apache-path-traversal')
  assert.match(item.body,/41773.*2\.4\.50/)
  assert.match(item.body,/42013.*2\.4\.51/)
  assert.doesNotMatch(item.body,/2\.4\.51 修复相关两项/)
})


test('cloud and container entries preserve source evidence while separating vendor-corrected facts', () => {
  const rows = loadFujiangReferences().filter(r => r.fujiang_category === 'cloud-container' && r.id !== 'fujiang:cloud-container:SKILL')
  assert.equal(rows.length,14)
  assert.ok(rows.every(r => r.body.includes('原始资料元数据') && r.verified === false))
  const nexus=getBundledKnowledge('fujiang:cloud-container:cve-2019-7238-nexus-rce')
  assert.match(nexus.body,/3\.15\.0/)
  assert.match(nexus.source_url,/sanjiu2024\/dsh-team-workflow/)
  const postgres=getBundledKnowledge('fujiang:cloud-container:cve-2019-9193-postgres')
  assert.match(postgres.body,/厂商已否认该漏洞/)
  const nacos=getBundledKnowledge('fujiang:cloud-container:cve-2021-29441-nacos')
  assert.match(nacos.body,/该 CVE 仅适用于/)
  const grafana=getBundledKnowledge('fujiang:cloud-container:cve-2021-43798-grafana-file-read')
  assert.match(grafana.body,/原始 CVSS：8\.6/)
  assert.match(grafana.body,/当前 CVSS：7\.5/)
  const cgroup=getBundledKnowledge('fujiang:cloud-container:cve-2022-0492-cgroup-release-agent')
  assert.match(cgroup.body,/5\.16\.6/)
  assert.match(cgroup.body,/原始修复建议（已由厂商资料纠正）/)
  const currentRepair = cgroup.body.split('## 修复与缓解（Purge 防御性归纳）')[1]?.split('\n## ')[0] || ''
  assert.match(currentRepair,/5\.16\.6/)
  assert.doesNotMatch(currentRepair,/5\.16\.2\+/)
  const esxi=getBundledKnowledge('fujiang:cloud-container:cve-2024-37085-esxi-auth-bypass')
  assert.match(esxi.body,/原始 CVSS：9\.8/)
  assert.match(esxi.body,/当前 CVSS：6\.8/)
  assert.match(esxi.body,/没有计划补丁/)
  const redis=getBundledKnowledge('fujiang:cloud-container:redis-unauth')
  assert.match(redis.body,/Debian 打包引入/)
  assert.match(redis.body,/不是 CVE-2022-0543/)
})


test('Java web knowledge preserves source metadata and corrected vendor boundaries', () => {
  const rows = loadFujiangReferences().filter(r => r.fujiang_category === 'java-web' && r.id !== 'fujiang:java-web:SKILL')
  assert.equal(rows.length,22)
  assert.ok(rows.every(r => r.body.includes('元数据') && r.verified === false))
  const druid=getBundledKnowledge('fujiang:java-web:cve-2021-25646-druid-rce')
  assert.match(druid.title,/已认证用户/)
  assert.match(druid.body,/当前 CVSS：8\.8/)
  assert.match(druid.body,/不是未授权 RCE/)
  assert.doesNotMatch(druid.tags,/未授权/)
  const confluence=getBundledKnowledge('fujiang:java-web:cve-2023-22518-confluence-setup-restore')
  assert.match(confluence.body,/原始 CVSS：9\.1/)
  assert.match(confluence.body,/当前 CVSS：10\.0/)
  assert.match(confluence.body,/8\.3\.4、8\.4\.4、8\.5\.3、8\.6\.1/)
  const gitlab=getBundledKnowledge('fujiang:java-web:cve-2023-7028-gitlab-takeover')
  assert.match(gitlab.body,/16\.4\.4/)
  assert.match(gitlab.body,/16\.6\.3/)
  const activemq=getBundledKnowledge('fujiang:java-web:cve-2023-46604-activemq-openwire')
  assert.match(activemq.body,/Artemis.*2\.31\.2/)
  assert.match(activemq.body,/当前 CVSS：9\.8/)
  assert.match(activemq.body,/CVSS 评分来源：https:\/\/advisories\.gitlab\.com/)
  const struts=getBundledKnowledge('fujiang:java-web:cve-2024-53677-struts2-s2-067')
  assert.match(struts.body,/2\.5\.0–2\.5\.33/)
  assert.match(struts.body,/Action File Upload/)
  assert.doesNotMatch(struts.body,/## PoC|## 利用步骤/)
  assert.match(struts.source_url,/sanjiu2024\/dsh-team-workflow/)
})


test('all 167 archive articles preserve original frontmatter and stable source paths', () => {
  const rows = loadFujiangReferences().filter(r => !r.id.endsWith(':SKILL'))
  assert.equal(rows.length, 167)
  assert.equal(new Set(rows.map(r => r.id)).size, 167)
  assert.deepEqual(Object.fromEntries(['cloud-container','edge-device','exchange-ad','gray-market','java-deser','java-web','linux-priv','triage','web-cms'].map(category => [category, rows.filter(r => r.fujiang_category === category).length])), {
    'cloud-container':14,'edge-device':16,'exchange-ad':14,'gray-market':59,'java-deser':9,'java-web':22,'linux-priv':11,'triage':3,'web-cms':19,
  })
  for (const row of rows) {
    assert.equal(row.verified, false)
    assert.match(row.body, /原始资料元数据/, row.id)
    assert.match(row.body, /原始 CVSS：/, row.id)
    assert.match(row.body, /原始 verified：false/, row.id)
    assert.match(row.source_ref, /^plugin\/knowledge\//, row.id)
    assert.match(row.source_url, /sanjiu2024\/dsh-team-workflow/, row.id)
    assert.doesNotMatch(row.body, /^## (?:PoC|利用步骤)$/m, row.id)
  }
  const tomcat = getBundledKnowledge('fujiang:java-web:cve-2017-12615-tomcat-put')
  assert.match(tomcat.body, /原始 CVSS：9\.8/)
  assert.doesNotMatch(tomcat.body, /原文无 frontmatter/)
  const business = getBundledKnowledge('fujiang:gray-market:payment-notify-forgery')
  assert.match(business.body, /原始修复建议/)
  assert.match(business.body, /修复与缓解/)
  const method = getBundledKnowledge('fujiang:triage:fingerprint-workflow')
  assert.match(method.body, /原始资料元数据/)
  assert.match(method.body, /方法归纳/)
})


test('Confluence and ActiveMQ source claims do not override corrected branch boundaries', () => {
  const ognl=getBundledKnowledge('fujiang:java-web:cve-2022-26134-confluence-ognl')
  assert.match(ognl.body,/修复版本不属于受影响版本/)
  const admin=getBundledKnowledge('fujiang:java-web:cve-2023-22515-confluence-admin')
  assert.match(admin.body,/8\.0\.0–8\.3\.2、8\.4\.0–8\.4\.2、8\.5\.0–8\.5\.1/)
  const mq=getBundledKnowledge('fujiang:java-web:cve-2023-46604-activemq-openwire')
  assert.match(mq.body,/5\.15\.16 之前/)
  assert.match(mq.body,/Apache Software Foundation CNA 评分为 10\.0/)
})
