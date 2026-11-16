#!/usr/bin/env node
/**
 * 富江知识库导入器 —— 把 dsh 富江 0.20.13 的 plugin/knowledge 元数据并入离线 CVE 目录。
 *
 * 只取 md 的 frontmatter（title / cve / severity / cvss / product / versions / ports /
 * keywords / entry），不复制上游 PoC 正文与利用步骤；每条保留 source_url 指向上游文件。
 *
 *   node scripts/fujiang-kb-import.mjs --kb <knowledge目录> [--repo <仓库根>] [--out <目录>] [--write]
 *
 * 默认 dry-run：把「补完别名 + 新增分类」后的完整目录写到 <out>/catalog；--write 落到 lib/redteam/cve-catalog。
 * 已有的 9 个目录文件不会被删条目，只做两件事：补同链 CVE 号、新增 gray-market.json。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const KB = arg('--kb', join(process.cwd(), 'kb'))
const REPO = arg('--repo', process.cwd())
const OUT = arg('--out', join(process.cwd(), 'out'))
const WRITE = argv.includes('--write')
const SOURCE_BASE = 'https://github.com/FJNB5/fujiang-pojia/blob/HEAD/plugin/knowledge/'

/**
 * 上游正文里同链/同族的 CVE，frontmatter 只留了主号。只按已知产品链补，不做全文猜测：
 * 全文抓号会把「提到 log4shell」的 WebLogic 条目也塞进 CVE-2021-44228，精确查询就会返回两条。
 */
const ALIASES = {
  'CVE-2021-26855': ['CVE-2021-26857', 'CVE-2021-26858', 'CVE-2021-27065'], // ProxyLogon 四洞
  'CVE-2021-34473': ['CVE-2021-34523', 'CVE-2021-31207'],                    // ProxyShell 三洞
  'CVE-2021-34527': ['CVE-2021-1675'],                                       // PrintNightmare 同族
  'CVE-2020-14882': ['CVE-2020-14883'],                                      // WebLogic console 配套
  'CVE-2019-2725': ['CVE-2019-2729'],                                        // wls9_async 补丁绕过
  'CVE-2019-11510': ['CVE-2020-8243'],                                       // Pulse 会话窃取后提权
}

const unquote = (v) => String(v || '').trim().replace(/^["']|["']$/g, '')
function frontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
    if (kv) out[kv[1].toLowerCase()] = unquote(kv[2])
  }
  return out
}
const splitList = (v) => String(v || '').split(/[,，;；、]/).map((x) => x.trim()).filter(Boolean)
const portList = (v) => splitList(v).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 65535)
const cveList = (v, file) => {
  const found = String(v || '').toUpperCase().match(/CVE-\d{4}-\d{4,7}/g) || []
  if (found.length) return [...new Set(found)]
  return [...new Set(file.toUpperCase().match(/CVE-\d{4}-\d{4,7}/g) || [])]
}
const categories = () => readdirSync(KB).filter((n) => {
  try { return statSync(join(KB, n)).isDirectory() } catch { return false }
})

function rows(category) {
  const dir = join(KB, category)
  const list = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'SKILL.md') continue
    const fm = frontmatter(readFileSync(join(dir, name), 'utf8'))
    if (!fm.title) continue
    const row = {
      title: fm.title,
      cve: cveList(fm.cve, name),
      severity: (fm.severity || 'medium').toLowerCase(),
      cvss: Number(fm.cvss) || undefined,
      product: fm.product || '',
      versions: fm.versions || '',
      ports: portList(fm.ports),
      keywords: splitList(fm.keywords),
      entry: fm.entry || undefined,
      verified: false,
      source_url: SOURCE_BASE + category + '/' + name,
      source_version: '0.20.13',
    }
    for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === '') delete row[k]
    list.push(row)
  }
  return list
}

const catalogDir = join(REPO, 'lib', 'redteam', 'cve-catalog')
if (!existsSync(catalogDir)) throw new Error('cve-catalog not found under ' + REPO)
const target = WRITE ? catalogDir : join(OUT, 'catalog')
mkdirSync(target, { recursive: true })

const writeJson = (path, data, sampleText) => {
  const body = JSON.stringify(data, null, 2) + '\n'
  writeFileSync(path, sampleText && sampleText.includes('\r\n') ? body.replace(/\n/g, '\r\n') : body)
}

let aliased = 0
const aliasAdded = []
for (const file of readdirSync(catalogDir).filter((f) => f.endsWith('.json')).sort()) {
  const source = readFileSync(join(catalogDir, file), 'utf8')
  const rowsIn = JSON.parse(source)
  let changed = false
  for (const row of rowsIn) {
    const add = []
    for (const cve of row.cve || []) for (const extra of ALIASES[cve] || []) {
      if (!row.cve.includes(extra) && !add.includes(extra)) add.push(extra)
    }
    if (add.length) { row.cve = [...row.cve, ...add]; aliased++; changed = true; aliasAdded.push({ file, title: row.title, add }) }
  }
  // 只重写真正补了别名的文件；原文件是 CRLF（仓库 core.autocrlf=true），照原样写回。
  if (changed) writeJson(join(target, file), rowsIn, source)
}

const gray = rows('gray-market')
writeJson(join(target, 'gray-market.json'), gray, '\r\n')

const total = readdirSync(target).filter((f) => f.endsWith('.json'))
  .reduce((n, f) => n + JSON.parse(readFileSync(join(target, f), 'utf8')).length, 0)
const md = [
  '# 富江知识库导入结果', '',
  '- 目标目录: ' + target + ' (' + (WRITE ? '已写入仓库' : 'dry-run，未动仓库') + ')',
  '- 既有条目补别名: ' + aliased + ' 条，新增 CVE 号 ' + aliasAdded.reduce((n, x) => n + x.add.length, 0) + ' 个',
  '- 新增分类 gray-market: ' + gray.length + ' 条',
  '- 合并后总条目: ' + total, '',
  '## 补了别名的条目', '', '| 文件 | 标题 | 追加 |', '| --- | --- | --- |',
  ...aliasAdded.map((a) => '| ' + a.file + ' | ' + a.title + ' | ' + a.add.join(', ') + ' |'), '',
  '## gray-market 全量标题', '',
  ...gray.map((g) => '- [' + g.severity + '] ' + g.title + (g.entry ? ' — ' + g.entry : '')),
]
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'REPORT.md'), md.join('\n') + '\n')
console.log(JSON.stringify({ target, write: WRITE, aliasedEntries: aliased, grayMarket: gray.length, total }, null, 2))