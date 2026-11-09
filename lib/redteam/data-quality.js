/**
 * 数据质量体检（`dataQuality` 查询算子）
 *
 * 只回答一个问题：**库里记下来的东西自洽吗？** 所以这里只有计数，没有一行库内容：
 * 不回显标题、证据正文、凭据、截图文件名，只数「缺证据几条、空 HTTP 证据几条、
 * 指向已不存在资产的记录几条」。结论对报告是**旁证**，不是结论：
 * `validatesFindings: false` —— 只有人/复现才能确认漏洞成立。
 *
 * 三条硬纪律（对应用例 test-pending/store-query.mjs）：
 *  1) 只读：用 `{ readOnly: true }` 打开，不跑 DDL/migrate（`db()` 会建表+补列，
 *     那是"读一次就改库"，绝不能出现在体检里），不进 `handles` 缓存、不改 `current` 指针；
 *  2) 读的是**已提交的现场**：readOnly 连接照常读 -wal 里的已提交记录，
 *     且不会 checkpoint（checkpoint 只有写入方或显式 PRAGMA 才会做）；
 *  3) 靶标选择必须是纯文件系统解析：为了让「未选择」也能给出空结果，
 *     这里不调用 store.listEngagements()/activeEngagementId()/stats()（它们都会开库），
 *     也不跟随工作区外的目录（符号链接/目录联接一律拒绝）。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** 体检只用这四张表；缺一张说明库不是完整 schema，此时**不能**就地迁移补齐。 */
const REQUIRED_TABLES = ['asset', 'vuln', 'http_evidence', 'shot']

/** 每个计量项对应一条对外 issue（code 与 counts 的键一一对应）。 */
const ISSUE_LAYOUT = [
  ['missingEvidence', 'high', 'Vulnerabilities with nothing recorded as evidence (no text and no HTTP trace)'],
  ['confirmedMissingEvidence', 'high', 'Confirmed or exploited vulnerabilities with nothing recorded as evidence'],
  ['emptyHttpEvidence', 'medium', 'HTTP evidence rows whose request, response and note are all blank'],
  ['orphanVulnerabilityAssets', 'medium', 'Vulnerabilities pointing at an asset that no longer exists'],
  ['orphanHttpVulnerabilities', 'low', 'HTTP evidence pointing at a vulnerability that no longer exists'],
  ['orphanHttpAssets', 'low', 'HTTP evidence pointing at an asset that no longer exists'],
  ['orphanScreenshotVulnerabilities', 'low', 'Screenshots pointing at a vulnerability that no longer exists'],
  ['orphanScreenshotAssets', 'low', 'Screenshots pointing at an asset that no longer exists'],
]

/**
 * 「空白」的 SQL 判定。SQLite 的 `TRIM` 默认只去掉半角空格，
 * 所以证据里常见的 `' \t\r\n'` 在 `TRIM(x) = ''` 下会被当成"有内容"。
 * 这里显式去掉空格 / Tab / CR / LF 再判长度。
 */
function blankSql(expr) {
  const stripped = [' ', '\t', '\n', '\r']
    .reduce((sql, ch) => `REPLACE(${sql}, '${ch}', '')`, `COALESCE(${expr}, '')`)
  return `LENGTH(${stripped}) = 0`
}

/** 靶标 id 形状校验：必须是工作区里的单层目录名（不接受路径、盘符、`.`/`..`、留白）。 */
function assertEngagementId(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`dataQuality engagement must be an engagement id, not ${typeof value}`)
  }
  const id = value.trim()
  if (id !== value || id === '' || id === '.' || id === '..') {
    throw new TypeError('dataQuality engagement must be a plain engagement id')
  }
  /* eslint-disable-next-line no-control-regex */
  if (isAbsolute(id) || /[\\/:*?"<>|\u0000-\u001f]/.test(id)) {
    throw new TypeError(`dataQuality engagement is not a plain directory name: ${id}`)
  }
  return id
}

/** 取靶标目录的真实路径，并确认它仍在本工作区的 engagements/ 之内（不跟随链接出去）。 */
function engagementDirectory(store, id) {
  const directory = store.dirOf(id)
  let stat
  try {
    stat = statSync(directory)
  } catch {
    throw new Error(`no such engagement: ${id}`)
  }
  if (!stat.isDirectory()) throw new Error(`no such engagement: ${id}`)
  const base = realpathSync(store.engagementsDir)
  let real
  try {
    real = realpathSync(directory)
  } catch {
    throw new Error(`engagement path cannot be resolved: ${id}`)
  }
  const rel = relative(base, real)
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`engagement path is outside the workspace: ${id}`)
  }
  return real
}

/** 指针文件里的靶标 id（读不到/不合法/没有库 → null）。只读，不写指针。 */
function pointedEngagementId(store) {
  let raw = ''
  try {
    raw = readFileSync(store.currentPath(), 'utf8').trim()
  } catch {
    return null
  }
  if (raw === '') return null
  let id
  try {
    id = assertEngagementId(raw)
    if (!existsSync(store.dbPathOf(id))) return null
  } catch {
    return null
  }
  return id
}

/** engagement.yaml 里的 created_at（没有就空串，后面用 mtime 兜底）。 */
function metaCreatedAt(directory) {
  try {
    const text = readFileSync(join(directory, 'engagement.yaml'), 'utf8')
    const match = /^created_at:\s*(.+)$/m.exec(text)
    return match === null ? '' : match[1].trim()
  } catch {
    return ''
  }
}

/** 没有指针时的兜底：按 created_at（其次 mtime、最后名字）取最近的靶标，等价于列表首项。 */
function newestEngagementId(store) {
  let entries = []
  try {
    entries = readdirSync(store.engagementsDir, { withFileTypes: true })
  } catch {
    return null
  }
  const candidates = []
  for (const entry of entries) {
    /* 目录联接/符号链接不是靶标目录：它们是"指向别处"，绝不能当成本地库去读 */
    if (!entry.isDirectory()) continue
    let name
    try {
      name = assertEngagementId(entry.name)
    } catch {
      continue
    }
    const directory = join(store.engagementsDir, name)
    let stat
    try {
      stat = statSync(join(directory, 'assets.db'))
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    candidates.push({ id: name, created: metaCreatedAt(directory), mtime: stat.mtimeMs })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => String(b.created).localeCompare(String(a.created))
    || b.mtime - a.mtime
    || a.id.localeCompare(b.id))
  return candidates[0].id
}

/**
 * 解析本次体检要查哪个靶标。
 * @returns `{ id, explicit }`；未选择任何靶标时返回 `null`（调用方给显式空结果）。
 * @throws 显式给了 engagement 但形状不合法时抛错 —— 绝不回退到"当前靶标"。
 */
export function dataQualitySelection(store, req) {
  const request = req !== null && typeof req === 'object' ? req : {}
  /* 用 hasOwn 而不是真值判断：显式传 null/''/1 是"问一个坏靶标"，必须报错而不是静默退化 */
  if (Object.hasOwn(request, 'engagement')) {
    return { id: assertEngagementId(request.engagement), explicit: true }
  }
  const pointed = pointedEngagementId(store)
  if (pointed !== null) return { id: pointed, explicit: false }
  const newest = newestEngagementId(store)
  return newest === null ? null : { id: newest, explicit: false }
}

function assertCompleteSchema(db) {
  const present = new Set(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => String(row.name)),
  )
  const missing = REQUIRED_TABLES.filter((name) => !present.has(name))
  if (missing.length > 0) {
    throw new Error(`data quality needs a complete engagement schema; missing table(s): ${missing.join(', ')}`)
  }
}

function countOf(db, sql) {
  const row = db.prepare(sql).get()
  const n = Number(row && row.n)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

function readTotals(db) {
  const row = db.prepare(`SELECT
      (SELECT COUNT(*) FROM asset) AS assets,
      (SELECT COUNT(*) FROM vuln) AS vulnerabilities,
      (SELECT COUNT(*) FROM http_evidence) AS httpEvidence,
      (SELECT COUNT(*) FROM shot) AS screenshots`).get() || {}
  return {
    assets: Number(row.assets) || 0,
    vulnerabilities: Number(row.vulnerabilities) || 0,
    httpEvidence: Number(row.httpEvidence) || 0,
    screenshots: Number(row.screenshots) || 0,
  }
}

/** 口径：缺证据 = evidence 列为空 **且** 一条 HTTP 证据都没挂；
 *  HTTP 行记了但内容全空，算 `emptyHttpEvidence`，不与缺证据重复计数。 */
const MISSING_EVIDENCE = `FROM vuln v
  WHERE ${blankSql('v.evidence')}
    AND NOT EXISTS (SELECT 1 FROM http_evidence h WHERE h.vuln_id = v.id)`

function readCounts(db) {
  return {
    missingEvidence: countOf(db, `SELECT COUNT(*) AS n ${MISSING_EVIDENCE}`),
    confirmedMissingEvidence: countOf(db, `SELECT COUNT(*) AS n ${MISSING_EVIDENCE}
      AND v.status IN ('confirmed', 'exploited')`),
    emptyHttpEvidence: countOf(db, `SELECT COUNT(*) AS n FROM http_evidence h
      WHERE ${blankSql('h.request')} AND ${blankSql('h.response')} AND ${blankSql('h.note')}`),
    orphanVulnerabilityAssets: countOf(db, `SELECT COUNT(*) AS n FROM vuln v
      WHERE v.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = v.asset_id)`),
    orphanHttpVulnerabilities: countOf(db, `SELECT COUNT(*) AS n FROM http_evidence h
      WHERE h.vuln_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vuln v WHERE v.id = h.vuln_id)`),
    orphanHttpAssets: countOf(db, `SELECT COUNT(*) AS n FROM http_evidence h
      WHERE h.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = h.asset_id)`),
    orphanScreenshotVulnerabilities: countOf(db, `SELECT COUNT(*) AS n FROM shot s
      WHERE s.vuln_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vuln v WHERE v.id = s.vuln_id)`),
    orphanScreenshotAssets: countOf(db, `SELECT COUNT(*) AS n FROM shot s
      WHERE s.asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = s.asset_id)`),
  }
}

/**
 * 体检一个靶标库：只给计数，不改状态、不回显内容。
 * @param store - RedteamStore（只用 dirOf / engagementsDir / currentPath / dbPathOf）。
 * @param id - 靶标 id。
 * @throws 目录不存在、路径越界、schema 不完整、库打不开时抛错（由 dispatch 转成 ok:false）。
 */
export function dataQualityReport(store, id) {
  const directory = engagementDirectory(store, id)
  const file = join(directory, 'assets.db')
  if (!existsSync(file)) throw new Error(`engagement database is missing: ${id}`)
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    assertCompleteSchema(db)
    const totals = readTotals(db)
    const counts = readCounts(db)
    const issues = ISSUE_LAYOUT
      .filter(([code]) => counts[code] > 0)
      .map(([code, severity, summary]) => ({ code, count: counts[code], severity, summary }))
    return {
      scope: 'stored-record-metadata',
      status: issues.length > 0 ? 'attention' : 'no_issues_detected',
      validatesFindings: false,
      totals,
      counts,
      issues,
    }
  } finally {
    try { db.close() } catch { /* 关闭失败不改变已经算出的结论 */ }
  }
}
