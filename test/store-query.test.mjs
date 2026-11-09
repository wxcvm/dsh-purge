import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'

const scratch = fileURLToPath(new URL('../.scratch/tests/', import.meta.url))

function fixture(t, { assets = 0, vulns = 0, create = true } = {}) {
  fs.mkdirSync(scratch, { recursive: true })
  const root = fs.mkdtempSync(path.join(scratch, 'store-query-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }) })
  if (!create) return { root, store }
  const { id } = store.openEngagement('query-fixture', [], { bindCurrent: false })
  const db = store.db(id)
  const asset = db.prepare(`INSERT INTO asset(segment_cidr,ip,ip_int,state,primary_name,priority,test_status,discovered_at)
    VALUES(?,?,NULL,?,?,?,?,?)`)
  const port = db.prepare("INSERT INTO port(asset_id,proto,port,state) VALUES(?,'tcp',443,'open')")
  const vuln = db.prepare(`INSERT INTO vuln(asset_id,title,severity,status,evidence,target,cve)
    VALUES(?,?,?,?,?,'https://fixture.invalid',?)`)
  db.exec('BEGIN')
  for (let n = 1; n <= assets; n++) {
    asset.run(n % 2 ? '2001:db8::/64' : '2001:db8:1::/64', `2001:db8::${n.toString(16)}`,
      n % 2 ? 'up' : 'down', `fixture-${n}.invalid`, n % 5 ? 'medium' : 'high',
      n % 3 ? 'untested' : 'tested', '2026-01-01T00:00:00Z')
    if (n % 3 === 0) port.run(n)
  }
  for (let n = 1; n <= vulns; n++) {
    vuln.run(assets ? (n % assets) + 1 : null, `fixture-vulnerability-${n}`,
      ['critical', 'high', 'medium', 'low', 'info'][n % 5],
      ['confirmed', 'candidate', 'exploited'][n % 3], `synthetic evidence ${n}`, `FIXTURE-${n % 7}`)
  }
  db.exec('COMMIT')
  return { root, store, id, db }
}

function traverse(getPage, options = {}) {
  const ids = []
  let offset = 0
  do {
    const page = getPage({ ...options, offset })
    assert.equal(page.offset, offset)
    assert.equal(page.returned, page.items.length)
    assert.equal(page.hasMore, page.returned > 0 && offset + page.returned < page.total)
    assert.equal(page.nextOffset, page.hasMore ? offset + page.returned : null)
    ids.push(...page.items.map((item) => item.id))
    offset = page.nextOffset
  } while (offset !== null)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate records across pages')
  return ids
}

test('asset pagination is complete above 200 rows, deterministic for ties, and keeps filters', (t) => {
  const { store, id } = fixture(t, { assets: 257 })
  const list = (f) => store.listAssets(id, f)
  assert.equal(list({}).returned, 200)
  assert.equal(list({}).nextOffset, 200)
  for (const sort of ['ip', 'priority', 'ports', 'todo', 'discovered']) {
    const expected = list({ sort, limit: 2000 }).items.map((item) => item.id)
    assert.equal(expected.length, 257)
    assert.deepEqual(traverse(list, { sort, limit: 31 }), expected)
    assert.deepEqual(traverse(list, { sort, limit: 53 }), expected)
  }
  const filters = { state: 'down', cidr: '2001:db8:1::/64', port: 443, test_status: 'tested', sort: 'ip' }
  const filtered = traverse(list, { ...filters, limit: 9 })
  assert.deepEqual(filtered, Array.from({ length: 42 }, (_, n) => (n + 1) * 6))
  assert.equal(list({ ...filters }).total, 42)
  assert.equal(list({ q: 'fixture-257.invalid' }).items[0].primary_name, 'fixture-257.invalid')
  assert.equal(list({ limit: 2001 }).limit, 2000)
  assert.deepEqual(list({ limit: 7, offset: 300 }).items, [])
  assert.equal(list({ limit: 7, offset: 300 }).hasMore, false)
  assert.equal(list({ state: 'no-match' }).total, 0)
})

test('vulnerability pages honor offset, severity order, filtering and per-page cap', (t) => {
  const { store, id, db } = fixture(t, { assets: 7, vulns: 1005 })
  const list = (f) => store.listVulns(id, f)
  assert.equal(list({}).returned, 200)
  const expected = db.prepare(`SELECT id FROM vuln ORDER BY CASE severity
    WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,id DESC`)
    .all().map((row) => row.id)
  assert.deepEqual(traverse(list, { limit: 113 }), expected)
  const capped = list({ limit: 2000 })
  assert.equal(capped.limit, 1000)
  assert.equal(capped.returned, 1000)
  assert.equal(capped.nextOffset, 1000)
  assert.equal(list({ limit: 1000, offset: 1000 }).returned, 5)
  const filters = { severity: 'high', status: 'candidate', asset_id: 1, cve: 'FIXTURE-0', q: 'fixture-vulnerability' }
  const filtered = db.prepare("SELECT id FROM vuln WHERE severity='high' AND status='candidate' AND asset_id=1 AND cve='FIXTURE-0' ORDER BY id DESC")
    .all().map((row) => row.id)
  assert.ok(filtered.length > 0)
  assert.deepEqual(traverse(list, { ...filters, limit: 2 }), filtered)
  assert.equal(list(filters).total, filtered.length)
  const beyond = list({ limit: 5, offset: 2000 })
  assert.equal(beyond.total, 1005)
  assert.equal(beyond.returned, 0)
  assert.equal(beyond.nextOffset, null)
  const selected = list({ limit: ' 5 ', offset: '5' })
  assert.deepEqual(selected.items.map((v) => v.id), expected.slice(5, 10))
})

test('pagination rejects invalid numeric inputs rather than disabling SQLite limits', (t) => {
  const { store, id } = fixture(t)
  const invalidLimits = [-1, 0, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1,
    null, '', ' ', 'NaN', '-1', '1.5', '1e3', true, false, [], {}, 1n]
  const invalidOffsets = [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1,
    null, '', '-1', '0.5', true, [], {}, 1n]
  for (const op of ['assets', 'vulns']) {
    const list = (f) => op === 'assets' ? store.listAssets(id, f) : store.listVulns(id, f)
    for (const limit of invalidLimits) {
      assert.throws(() => list({ limit }), /limit must be a safe integer/)
      assert.equal(dispatch(store, { op, engagement: id, limit }).ok, false)
    }
    for (const offset of invalidOffsets) {
      assert.throws(() => list({ offset }), /offset must be a safe integer/)
      assert.equal(dispatch(store, { op, engagement: id, offset }).ok, false)
    }
    assert.equal(list({ limit: 1, offset: 0 }).limit, 1)
    assert.equal(list({ offset: Number.MAX_SAFE_INTEGER }).returned, 0)
  }
})

test('both legacy report loaders consume all pages without changing report eligibility', (t) => {
  const { store, id, db } = fixture(t, { assets: 1, vulns: 1005 })
  const eligible = db.prepare("SELECT COUNT(*) AS n FROM vuln WHERE status IN ('confirmed','exploited') AND severity IN ('critical','high','medium')").get().n
  const targetsAll = store.reportTargets(id, { all: true })
  assert.equal(targetsAll.totals.vulns, 1005)
  assert.equal(targetsAll.totals.filteredOut, 0)
  assert.equal(store.report(id, { all: true }).stats.results, 1005)
  assert.equal(store.reportTargets(id).totals.vulns, eligible)
  assert.equal(store.report(id).stats.results, eligible)
  assert.equal(store.report(id).stats.filteredOut, 1005 - eligible)
})

test('data quality reports only counts and never changes status or discloses stored content', (t) => {
  const { store, id, db } = fixture(t, { assets: 1 })
  db.exec(`INSERT INTO vuln(id,asset_id,title,status,evidence) VALUES
    (1,1,'private title','candidate',NULL),
    (2,1,'private title','confirmed',' \t\r\n'),
    (3,1,'private title','exploited',''),
    (4,1,'private title','candidate','private textual evidence'),
    (5,1,'private title','candidate',NULL),
    (6,1,'private title','candidate',NULL),
    (7,999,'private title','candidate',NULL);
    INSERT INTO http_evidence(vuln_id,asset_id,request,response) VALUES
    (5,1,'private request',NULL),(1,1,' \t',NULL),(999,999,NULL,NULL);
    INSERT INTO shot(vuln_id,asset_id,file) VALUES(6,1,'private screenshot.png'),(999,999,'orphan.png');
    INSERT INTO credential(host,username,secret_type,secret_value) VALUES
    ('fixture.invalid','private username','password','PRIVATE_CREDENTIAL_SENTINEL');`)
  const before = db.prepare('SELECT * FROM vuln ORDER BY id').all()
  const changes = db.prepare('SELECT total_changes() AS n').get().n
  const result = dispatch(store, { op: 'dataQuality', engagement: id })
  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(result.scope, 'stored-record-metadata')
  assert.equal(result.status, 'attention')
  assert.equal(result.validatesFindings, false)
  assert.deepEqual(result.totals, { assets: 1, vulnerabilities: 7, httpEvidence: 3, screenshots: 2 })
  assert.deepEqual(result.counts, {
    missingEvidence: 4, confirmedMissingEvidence: 2, emptyHttpEvidence: 2,
    orphanVulnerabilityAssets: 1, orphanHttpVulnerabilities: 1, orphanHttpAssets: 1,
    orphanScreenshotVulnerabilities: 1, orphanScreenshotAssets: 1,
  })
  assert.equal(result.issues.length, 8)
  for (const issue of result.issues) assert.equal(issue.count, result.counts[issue.code])
  assert.doesNotMatch(JSON.stringify(result), /private|PRIVATE_CREDENTIAL|fixture\.invalid|orphan\.png/)
  assert.deepEqual(db.prepare('SELECT * FROM vuln ORDER BY id').all(), before)
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes)
})

test('data quality preserves database bytes and schema on first access; SQLite may create WAL sidecars', (t) => {
  const { store, id } = fixture(t, { assets: 1, vulns: 2 })
  store.close()
  const file = store.dbPathOf(id)
  const bytes = fs.readFileSync(file)
  const filesBefore = fs.readdirSync(store.dirOf(id)).sort()
  const currentBefore = fs.existsSync(store.currentPath())
  store.db = () => { throw new Error('must not open a migrating handle') }
  store.activeEngagementId = () => { throw new Error('must not open databases to resolve selection') }
  store.listEngagements = () => { throw new Error('must not compute migrating stats') }
  const result = dispatch(store, { op: 'dataQuality' })
  assert.equal(result.ok, true)
  assert.equal(result.engagement, id)
  assert.equal(result.status, 'no_issues_detected')
  assert.deepEqual(result.issues, [])
  assert.equal(result.validatesFindings, false)
  assert.equal(store.handles.size, 0)
  assert.deepEqual(fs.readFileSync(file), bytes)
  // SQLite readOnly can create its own WAL/SHM sidecars. Do not remove shared sidecars.
  const addedFiles = fs.readdirSync(store.dirOf(id)).filter((name) => !filesBefore.includes(name))
  assert.ok(addedFiles.every((name) => ['assets.db-wal', 'assets.db-shm'].includes(name)))
  assert.equal(fs.existsSync(store.currentPath()), currentBefore)
})

test('data quality sees committed WAL records and does not checkpoint or change schema', (t) => {
  const { store, id, db } = fixture(t, { assets: 1 })
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const bytes = fs.readFileSync(store.dbPathOf(id))
  db.exec("INSERT INTO vuln(title,status,evidence) VALUES('in WAL','candidate','synthetic evidence')")
  assert.deepEqual(fs.readFileSync(store.dbPathOf(id)), bytes, 'new record is not in the main database yet')
  const schema = db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()
  const wal = fs.readFileSync(`${store.dbPathOf(id)}-wal`)
  const result = store.dataQuality(id)
  assert.equal(result.totals.vulnerabilities, 1, 'must read the live committed WAL, not immutable main-file data')
  assert.equal(result.counts.missingEvidence, 0)
  assert.deepEqual(fs.readFileSync(store.dbPathOf(id)), bytes)
  assert.deepEqual(fs.readFileSync(`${store.dbPathOf(id)}-wal`), wal)
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema)
})

test('data quality has an explicit no-selection result and rejects malformed or missing selections', (t) => {
  const { store } = fixture(t, { create: false })
  const none = dispatch(store, { op: 'dataQuality' })
  assert.equal(none.ok, true)
  assert.equal(none.available, false)
  assert.equal(none.engagement, null)
  assert.equal(none.totals, null)
  assert.equal(none.counts, null)
  assert.deepEqual(none.issues, [])
  const { id } = store.openEngagement('active-fixture')
  assert.equal(dispatch(store, { op: 'dataQuality' }).engagement, id)
  for (const engagement of [undefined, null, '', ' ', 1, {}, [], '../active-fixture', '..\\active-fixture', '.', '..', 'C:\\outside', 'absent']) {
    const result = dispatch(store, { op: 'dataQuality', engagement })
    assert.equal(result.ok, false, `explicit ${String(engagement)} must not fall back to active`)
    assert.equal(result.totals, undefined)
  }
  assert.equal(fs.existsSync(store.dirOf('absent')), false)
})

test('data quality cannot migrate an incomplete schema or follow a directory outside the workspace', (t) => {
  const { root, store } = fixture(t, { create: false })
  const directory = store.dirOf('legacy')
  fs.mkdirSync(directory)
  const legacyFile = store.dbPathOf('legacy')
  const legacy = new DatabaseSync(legacyFile)
  legacy.exec('CREATE TABLE asset(id INTEGER PRIMARY KEY)')
  legacy.close()
  const bytes = fs.readFileSync(legacyFile)
  assert.equal(dispatch(store, { op: 'dataQuality', engagement: 'legacy' }).ok, false)
  assert.deepEqual(fs.readFileSync(legacyFile), bytes)
  const outside = path.join(root, 'outside')
  fs.mkdirSync(outside)
  fs.copyFileSync(legacyFile, path.join(outside, 'assets.db'))
  const link = store.dirOf('linked')
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    const result = dispatch(store, { op: 'dataQuality', engagement: 'linked' })
    assert.equal(result.ok, false)
    assert.match(result.error, /path|路径|outside|超出/i)
  } finally { fs.unlinkSync(link) }
  assert.deepEqual(fs.readFileSync(path.join(outside, 'assets.db')), bytes)
})
