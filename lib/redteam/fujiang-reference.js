/** Defensive summaries of the uploaded Fujiang 0.20.13 archive.
 * Original filenames are stable provenance; no PoC or exploit body is embedded.
 * CVE metadata is reused from the existing catalog so vendor corrections stay in sync.
 */
import { readFileSync } from 'node:fs'
import { loadCveCatalog } from './cve-knowledge.js'

const data = JSON.parse(readFileSync(new URL('./fujiang-reference-data.json', import.meta.url), 'utf8'))
const sourceGuides = JSON.parse(readFileSync(new URL('./fujiang-source-guides.json', import.meta.url), 'utf8'))
const sourceGuideById = new Map(sourceGuides.entries.map(item => [item.id, item]))
const cloudSourceData = JSON.parse(readFileSync(new URL('./fujiang-source-articles-cloud-container.json', import.meta.url), 'utf8'))
const javaWebSourceData = JSON.parse(readFileSync(new URL('./fujiang-source-articles-java-web.json', import.meta.url), 'utf8'))
const sourceArticleById = new Map([...cloudSourceData.entries, ...javaWebSourceData.entries].map(item => [item.id, item]))
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
    review_status: reviewed ? 'reference-available-not-fully-reviewed' : 'reference-not-available',
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
    const sourceArticle = sourceArticleById.get(stableId(row.category, name))
    const sourceMeta = sourceArticle?.metadata || {}
    const currentCvss = row.advisory_status === 'vendor-disputed'
      ? '不适用（厂商认定非漏洞）'
      : row.cvss_status === 'not-applicable-configuration-risk'
        ? '不适用（配置类风险，无单一 CVE）'
        : row.cvss !== undefined ? String(row.cvss) + '（CVSS ' + (row.cvss_version || '版本未注明') + '）' : '尚未独立核验'
    const metadata = [
      '组件：' + row.product,
      '标识：' + identifiers,
      '当前风险等级：' + (row.severity || '未知'),
      '当前 CVSS：' + currentCvss,
      '当前版本范围：' + (row.versions || '未记录'),
      ...(sourceArticle ? [
        '原始标题：' + sourceMeta.title,
        '原始严重度：' + sourceMeta.severity,
        '原始 CVSS：' + (sourceMeta.source_cvss || '未记录'),
        '原始版本声明：' + (sourceMeta.versions || '未记录'),
        '端口线索：' + (sourceMeta.ports || '未记录'),
        '原始关键词：' + (sourceMeta.keywords || '未记录'),
        '当前检索关键词：' + (row.keywords || []).join('、'),
        '来源说明：' + (sourceMeta.sources || '未记录'),
        '原始 verified：' + (sourceMeta.verified || 'false'),
        ...(row.related_cves?.length ? ['相关但独立的 CVE：' + row.related_cves.join('、')] : []),
      ] : []),
      ...(row.source_versions ? ['原始版本声明（历史）：' + row.source_versions] : []),
      ...(row.advisory_note ? ['厂商核对：' + row.advisory_note] : []),
      ...(row.cvss_note ? ['CVSS 评分说明：' + row.cvss_note] : []),
      ...(row.cvss_reference ? ['CVSS 评分来源：' + row.cvss_reference] : []),
    ].join('\n')
    const review = row.version_reference
      ? '参考资料：' + row.version_reference + '（存在参考链接不等于目标已验证）'
      : '原包历史资料尚未逐条独立核验；升级前核对当前厂商公告、受支持分支和发行版回补。'
    const originalFixHeading = row.advisory_status === 'vendor-disputed'
      ? '原始修复建议（厂商已否认该漏洞，不作为修复依据）'
      : row.advisory_status === 'vendor-corrected'
        ? '原始修复建议（已由厂商资料纠正）'
        : '原始修复建议（尚未独立核验）'
    const sourceSections = sourceArticle ? [
      sourceArticle.fingerprint ? '## 指纹识别线索（已移除原始探测代码）\n' + sourceArticle.fingerprint : '',
      sourceArticle.preconditions ? '## 原始前置条件（待核验）\n' + sourceArticle.preconditions : '',
      sourceArticle.remediation_source ? '## ' + originalFixHeading + '\n' + sourceArticle.remediation_source : '',
      sourceArticle.reference_notes ? '## 原始参考资料\n' + sourceArticle.reference_notes : '',
      ...(sourceArticle.references?.length ? ['## 参考链接\n' + sourceArticle.references.map(url => '- ' + url).join('\n')] : []),
    ].filter(Boolean) : []
    rows.push(reference({ category: row.category, name, title: row.title,
      tags: [name, row.product, ...(row.cve || []), ...(row.related_cves || []), ...(row.keywords || []), '修复 缓解 防护'].join(' '),
      sourceUrl: sourceArticle?.mirror_url || row.source_url, reviewed: !!row.version_reference,
      body: [sourceArticle ? '## ' + (sourceArticle.metadata_origin === 'source-frontmatter' ? '原始资料元数据' : '随包索引元数据（原文无 frontmatter）') + '（富江 v0.20.13，verified=false）' : '## 适用范围与来源状态', metadata, ...sourceSections,
        '## 修复与缓解（Purge 防御性归纳）', repair,
        ...(row.advisory_note ? ['## 厂商核对与纠正', row.advisory_note] : []),
        '## 核对与复测', review,
        '根据实际组件、版本、配置和厂商公告核对适用性；在授权环境核对修复后的版本、配置及正常业务，不从版本或知识命中推断漏洞已验证。',
        '原包参考资料（书目线索，尚未全部复核）：' + (data.reference_notes[name] || '见原始资料参考章节'),
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
  for (const item of data.methods) {
    const source = sourceGuideById.get(stableId('triage', item.id))
    rows.push(reference({category:'triage',name:item.id,title:item.title,
      tags: item.id + ' ' + item.title + ' 证据 复测 报告',
      body:'## 方法归纳（保留原文防御要点）\n' + (source?.safe_body || item.body) + '\n\n来源：上传归档 ' + sourcePath('triage',item.id) }))
  }
  const guides = data.categories.map(([category,title,description]) => {
    const children = categoryRows(category, rows)
    const source = sourceGuideById.get(stableId(category, 'SKILL'))
    const original = source?.guide_entries || []
    return reference({category,name:'SKILL',title:source?.title || '富江分类索引：' + title,
      tags:category + ' ' + title + ' 索引 修复 防护 ' + (source?.description || ''),
      body:['## 分类概述',source?.description || description,
        '## 原始分类目录（' + original.length + ' 条）',
        ...original.map(row => '- ' + row.file + ' · ' + row.title + ' · ' + row.severity),
        '## Purge 知识索引（' + children.length + ' 条）',
        ...children.map(row => '- ' + row.title + ' · ' + row.id),
        '## 来源状态','保留富江原始分类入口的标题、描述和目录；利用入口列未导入。所有条目仍为未验证知识参考。'].join('\n')})
  })
  return [...rows, ...guides]
}
