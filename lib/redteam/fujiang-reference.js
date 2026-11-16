/** Defensive summaries of the uploaded Fujiang 0.20.13 archive.
 * Original filenames are stable provenance; no PoC or exploit body is embedded.
 * CVE metadata is reused from the existing catalog so vendor corrections stay in sync.
 */
import { readFileSync } from 'node:fs'
import { loadCveCatalog } from './cve-knowledge.js'

const data = JSON.parse(readFileSync(new URL('./fujiang-reference-data.json', import.meta.url), 'utf8'))
const categoryTitles = new Map(data.categories.map(([key, title]) => [key, title]))
const categoryOf = key => '富江 · ' + categoryTitles.get(key)
const sourcePath = (category, name) => 'plugin/knowledge/' + category + '/' + name + '.md'
const stableId = (category, name) => 'fujiang:' + category + ':' + name
const categoryRows = (category, rows) => rows.filter(row => row.fujiang_category === category)

function reference({ category, name, title, tags, body, sourceUrl = '', reviewed = false }) {
  const path = sourcePath(category, name)
  return {
    id: stableId(category, name), title, category: categoryOf(category), tags,
    body, source: '富江 v' + data.sourceVersion + ' · ' + path,
    source_ref: path, source_url: sourceUrl, verified: false,
    review_status: reviewed ? 'vendor-reference-reviewed' : 'source-summary-unverified',
    fujiang_category: category,
  }
}

export function loadFujiangReferences(catalog = loadCveCatalog()) {
  const rows = []
  const seen = new Set()
  for (const row of catalog) {
    const name = String(row.source_url || '').split('/').pop().replace(/\.md$/, '')
    const repair = data.cve[name]
    // The general CVE catalog may grow with unrelated sources; only map the archive's own entries.
    if (!repair) continue
    if (!categoryTitles.has(row.category)) throw new Error('Unknown Fujiang category: ' + row.category)
    if (seen.has(name)) throw new Error('Duplicate Fujiang source: ' + name)
    seen.add(name)
    const identifiers = (row.cve || []).join('、') || '通用配置或实现问题'
    const metadata = [
      '组件：' + row.product,
      '标识：' + identifiers,
      '等级：' + (row.severity || '未知'),
      '版本记录：' + (row.versions || '未记录'),
      ...(row.source_versions ? ['原始版本声明（历史，已纠正）：' + row.source_versions] : []),
      ...(row.advisory_note ? ['厂商核对：' + row.advisory_note] : []),
    ].join('\n')
    const review = row.version_reference
      ? '厂商或公告参考：' + row.version_reference
      : '原包历史资料尚未逐条独立核验；升级前核对当前厂商公告、受支持分支和发行版回补。'
    rows.push(reference({ category: row.category, name, title: row.title,
      tags: [name, row.product, ...(row.cve || []), ...(row.keywords || []), '修复 缓解 防护'].join(' '),
      sourceUrl: row.source_url, reviewed: !!row.version_reference,
      body: ['## 适用范围与来源状态', metadata, '## 修复与缓解（防御归纳）', repair,
        '## 核对与复测', review,
        '根据实际组件、版本、配置和厂商公告核对适用性；在授权环境核对修复后的版本、配置及正常业务，不从版本或知识命中推断漏洞已验证。',
        '原包参考资料（书目线索，尚未全部复核）：' + data.reference_notes[name],
        '来源：上传归档 ' + sourcePath(row.category, name)].join('\n\n') }))
  }
  if (seen.size !== Object.keys(data.cve).length) throw new Error('Fujiang CVE source coverage mismatch')
  for (const item of data.business) {
    const category = 'gray-market'
    rows.push(reference({ category, name: item.id, title: item.title,
      tags: [item.id, item.title, item.product, '业务安全 防护 修复'].join(' '),
      body: ['## 适用范围与来源状态', '场景：' + item.product,
        '原包风险等级：' + item.severity + '（不是当前系统风险结论）',
        '原包版本声明：' + item.versions + '；此类问题取决于实际实现与配置，不以版本断言。',
        '## 修复与缓解（防御归纳）', item.remediation,
        '## 核对与复测', '审查服务端实现、配置及审计记录；在隔离预发布环境使用合成账户、订单及数据检查预期安全控制、正常功能和状态一致性。原始条目未验证，未导入利用代码或执行步骤。',
        '原包参考资料（书目线索，尚未全部复核）：' + data.reference_notes[item.id],
        '来源：上传归档 ' + sourcePath(category, item.id)].join('\n\n') }))
  }
  for (const item of data.methods) rows.push(reference({category:'triage',name:item.id,title:item.title,
    tags: item.id + ' ' + item.title + ' 证据 复测 报告',
    body:'## 方法归纳\n' + item.body + '\n\n来源：上传归档 ' + sourcePath('triage',item.id) }))
  const guides = data.categories.map(([category,title,description]) => {
    const children = categoryRows(category, rows)
    return reference({category,name:'SKILL',title:'富江分类索引：' + title,
      tags:category + ' ' + title + ' 索引 修复 防护',
      body:['## 分类概述',description,'## 条目索引（' + children.length + '）',
        ...children.map(row => '- ' + row.title + ' · ' + row.id),
        '## 来源状态','分类索引按实际文件清单重建；所有条目为知识参考，不能证明某个系统存在漏洞。'].join('\n')})
  })
  return [...rows, ...guides]
}
