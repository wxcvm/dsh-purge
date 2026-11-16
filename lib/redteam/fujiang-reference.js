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
const cloudDetailsById = new Map(cloudSourceData.entries.map(item => [item.id, item]))
const archiveFiles = [
  'cloud-container.json', 'edge-device.json', 'exchange-ad.json',
  'gray-market-0.json', 'gray-market-15.json', 'gray-market-30.json', 'gray-market-45.json',
  'java-deser.json', 'java-web-0.json', 'java-web-15.json',
  'linux-priv.json', 'triage.json', 'web-cms-0.json', 'web-cms-15.json',
]
const archiveEntries = archiveFiles.flatMap(file => JSON.parse(readFileSync(new URL('./fujiang-source-archive/' + file, import.meta.url), 'utf8')))
const sourceArticleById = new Map(archiveEntries.map(item => [item.id, item]))
const categoryTitles = new Map(data.categories.map(([key, title]) => [key, title]))
const categoryOf = key => '富江 · ' + categoryTitles.get(key)
const sourcePath = (category, name) => 'plugin/knowledge/' + category + '/' + name + '.md'
const stableId = (category, name) => 'fujiang:' + category + ':' + name
const categoryRows = (category, rows) => rows.filter(row => row.fujiang_category === category)
const originalHeading = '## 原始资料元数据（富江 v0.20.13，verified=false）'

function originalMetadata(article) {
  if (!article) return []
  const m = article.metadata
  return [
    '原始标题：' + m.title,
    '原始组件：' + m.product,
    '原始标识：' + (m.cve || '未记录'),
    '原始严重度：' + m.severity,
    '原始 CVSS：' + (m.source_cvss || '未记录') + '（原包声明，非实测结论）',
    '原始版本声明：' + (m.versions || '未记录'),
    '端口线索：' + (m.ports || '未记录'),
    '原始关键词：' + (m.keywords || '未记录'),
    '来源说明：' + (m.sources || '未记录'),
    '原始 verified：' + (m.verified || 'false'),
  ]
}

function originalSections(article, fixHeading, cloudDetails) {
  if (!article) return []
  const sections = article.source_sections || {}
  return [
    cloudDetails?.fingerprint ? '## 指纹识别线索（历史资料）\n' + cloudDetails.fingerprint : '',
    cloudDetails?.preconditions ? '## 原始前置条件（待核验）\n' + cloudDetails.preconditions : '',
    !cloudDetails?.fingerprint && sections.fingerprint
      ? '## 识别与适用性\n原文包含指纹识别章节；产品、版本、端口和关键词已保留在原始资料元数据中。依据已有资产记录、部署配置和厂商公告核对，不以端口或关键词单独确认漏洞。' : '',
    !cloudDetails?.preconditions && sections.preconditions
      ? '## 前置条件核对\n原文包含前置条件章节；结合上方产品和版本声明、下方防御性归纳以及实际配置核对适用性。具体攻击步骤未纳入参考库。' : '',
    article.remediation_source ? '## ' + fixHeading + '\n' + article.remediation_source : '',
    article.reference_notes ? '## 原始参考资料（历史书目，未全部核验）\n' + article.reference_notes : '',
  ].filter(Boolean)
}

function reference({ category, name, title, tags, body, sourceUrl = '', reviewed = false, cveIds = [] }) {
  const path = sourcePath(category, name)
  return {
    id: stableId(category, name), title, category: categoryOf(category), tags,
    body, source: '富江 v' + data.sourceVersion + ' · ' + path,
    source_ref: path, source_url: sourceUrl, verified: false,
    review_status: reviewed ? 'reference-available-not-fully-reviewed' : 'reference-not-available',
    fujiang_category: category,
    ...(cveIds.length ? { cve_ids: Object.freeze([...cveIds]) } : {}),
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
    const article = sourceArticleById.get(stableId(row.category, name))
    const currentCvss = row.advisory_status === 'vendor-disputed'
      ? '不适用（厂商认定非漏洞）'
      : row.cvss_status === 'not-applicable-configuration-risk'
        ? '不适用（配置类风险，无单一 CVE）'
        : row.cvss !== undefined && row.cvss !== null
          ? (Number.isFinite(Number(row.cvss)) ? Number(row.cvss).toFixed(1) : String(row.cvss)) + '（CVSS ' + (row.cvss_version || '版本未注明') + '）'
          : '尚未独立核验'
    const metadata = [
      '组件：' + row.product,
      '标识：' + identifiers,
      '当前风险等级（候选）：' + (row.severity || '未知'),
      '当前 CVSS：' + currentCvss,
      '当前版本范围：' + (row.versions || '未记录'),
      ...originalMetadata(article),
      '当前检索关键词：' + (row.keywords || []).join('、'),
      ...(row.related_cves?.length ? ['相关但独立的 CVE：' + row.related_cves.join('、')] : []),
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
    rows.push(reference({ category: row.category, name, title: row.title,
      tags: [name, row.product, ...(row.cve || []), ...(row.related_cves || []), ...(row.keywords || []), '修复 缓解 防护'].join(' '),
      sourceUrl: article?.mirror_url || row.source_url, reviewed: !!row.version_reference, cveIds: row.cve || [],
      body: [article ? originalHeading : '## 适用范围与来源状态', metadata,
        ...originalSections(article, originalFixHeading, cloudDetailsById.get(stableId(row.category, name))),
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
    const article = sourceArticleById.get(stableId(category, item.id))
    rows.push(reference({ category, name: item.id, title: item.title,
      tags: [item.id, item.title, item.product, '业务安全 防护 修复'].join(' '),
      sourceUrl: article?.mirror_url || '',
      body: [article ? originalHeading : '## 适用范围与来源状态', ...originalMetadata(article),
        '## 适用范围与来源状态', '场景：' + item.product,
        '原包风险等级：' + item.severity + '（不是当前系统风险结论）',
        '原包版本声明：' + item.versions + '；此类问题取决于实际实现与配置，不以版本断言。',
        ...originalSections(article, '原始修复建议（历史资料，尚未独立核验）'),
        '## 修复与缓解（防御归纳）', item.remediation,
        '## 核对与复测', '审查服务端实现、配置及审计记录；在隔离预发布环境使用合成账户、订单及数据检查预期安全控制、正常功能和状态一致性。原始条目未验证，未导入利用代码或执行步骤。',
        '原包参考资料（书目线索，尚未全部复核）：' + data.reference_notes[item.id],
        '来源：上传归档 ' + sourcePath(category, item.id)].join('\n\n') }))
  }
  for (const item of data.methods) {
    const source = sourceGuideById.get(stableId('triage', item.id))
    const article = sourceArticleById.get(stableId('triage', item.id))
    rows.push(reference({category:'triage',name:item.id,title:item.title,
      tags: item.id + ' ' + item.title + ' 证据 复测 报告',
      sourceUrl: article?.mirror_url || '',
      body:[article ? originalHeading : '## 适用范围与来源状态', ...originalMetadata(article),
        '## 方法归纳（保留原文防御要点）', source?.safe_body || item.body,
        '来源：上传归档 ' + sourcePath('triage', item.id)].join('\n\n') }))
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
