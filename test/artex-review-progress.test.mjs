import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { DDL, RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { migrate } from '../lib/redteam/schema.js'

const methods = {
  db(id) { return this.databases[id] },
  saveArtexReview: RedteamStore.prototype.saveArtexReview,
  listArtexReviews: RedteamStore.prototype.listArtexReviews,
  exportArtexReviews: RedteamStore.prototype.exportArtexReviews,
}

test('ARTEX review state persists, updates evidence version, and stays inside selected DSH engagement', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'artex-review-state-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const file = join(home, 'lab.sqlite')
  let lab = new DatabaseSync(file)
  const other = new DatabaseSync(':memory:')
  const store = { ...methods, databases: { lab, other } }
  try {
    lab.exec(DDL)
    other.exec(DDL)
    const input = { op: 'artexReviewSave', engagement: 'lab',
      finding_id: 24, task_id: 7, evidence_version: 3,
      status: 'in_progress', note: '核查证据来源' }
    const first = dispatch(store, input)
    assert.equal(first.ok, true)
    assert.equal(first.review.evidence_version, 3)
    assert.equal(first.review.status, 'in_progress')
    assert.match(first.review.updated_at, /^\d{4}-\d\d-/)
    assert.deepEqual(dispatch(store, { op: 'artexReviewList', engagement: 'other',
      finding_ids: [24] }).items, [], 'other engagement must not see this review')
    assert.equal(dispatch(store, { op: 'artexReviewList', engagement: 'lab',
      finding_ids: [24, 24, 99] }).items.length, 1)
    lab.close()
    lab = new DatabaseSync(file)
    store.databases.lab = lab
    lab.exec(DDL)
    const previous = dispatch(store, { op: 'artexReviewList', engagement: 'lab',
      finding_ids: [24] }).items[0]
    assert.equal(previous.note, '核查证据来源')
    assert.equal(previous.evidence_version, 3)
    const newer = dispatch(store, { ...input, evidence_version: 4,
      status: 'needs_evidence', note: '新版来源证据待核实' })
    assert.equal(newer.ok, true)
    const after = store.listArtexReviews('lab', [24])
    assert.equal(after.length, 1)
    assert.equal(after[0].status, 'needs_evidence')
    assert.equal(after[0].evidence_version, 4)
    assert.equal(after[0].source_task_id, 7)
    assert.equal(lab.prepare('SELECT COUNT(*) AS n FROM artex_review').get().n, 1)
    assert.equal(lab.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, 0,
      'human review progress must not create a confirmed DSH vulnerability')
  } finally {
    lab.close()
    other.close()
  }
})

test('ARTEX review status validates source IDs and does not create reviews on failed writes', (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(DDL)
  const store = { ...methods, databases: { lab: db } }
  const valid = { op: 'artexReviewSave', engagement: 'lab',
    finding_id: 1, task_id: null, evidence_version: null, status: 'reviewed', note: '' }
  for (const patch of [
    { finding_id: 0 }, { finding_id: '1' }, { task_id: -1 }, { evidence_version: -1 },
    { status: 'confirmed' }, { status: 'exploited' }, { note: 'x'.repeat(1001) },
  ]) {
    const result = dispatch(store, { ...valid, ...patch })
    assert.equal(result.ok, false, JSON.stringify(patch))
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM artex_review').get().n, 0)
  assert.equal(dispatch(store, valid).ok, true)
  assert.equal(store.listArtexReviews('lab', [1])[0].evidence_version, null)
  assert.equal(dispatch(store, { op: 'artexReviewList', engagement: 'lab',
    finding_ids: ['1'] }).ok, false)
})

test('progress summary counts recorded, reviewed and changed evidence without inventing verification', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function artexEvidenceChanged(')
  const end = source.indexOf('    function ArtexTab(props)', start)
  assert.ok(start >= 0 && end > start)
  const summary = runInNewContext(source.slice(start, end) + '\nsummarizeArtexReviewProgress')
  const queue = [
    { finding_id: 1, evidence_version: 3 }, { finding_id: 2, evidence_version: 2 },
    { finding_id: 3, evidence_version: null }, { finding_id: 4, evidence_version: 1 },
  ]
  const s = summary(queue, { items: [
    { source_finding_id: 1, evidence_version: 2, status: 'reviewed' },
    { source_finding_id: 2, evidence_version: 2, status: 'needs_evidence' },
    { source_finding_id: 3, evidence_version: null, status: 'pending' },
  ] })
  assert.equal(s.total, 4)
  assert.equal(s.recorded, 3)
  assert.equal(s.reviewed, 1)
  assert.equal(s.needs_evidence, 1)
  assert.equal(s.changed, 1)
  assert.equal(summary(queue, null).recorded, 0)
})

test('source and embedded ARTEX resource page expose manual review progress controls', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    assert.match(source, /artexReviewList/)
    assert.match(source, /artexReviewSave/)
    assert.match(source, /artexReviewExport/)
    assert.match(source, /导出 DSH 核查回执/)
    assert.match(source, /记录 DSH 人工核查进度/)
    assert.match(source, /证据版本变化/)
    assert.match(source, /progressLabel/)
    assert.match(source, /summarizeArtexReviewProgress/)
    assert.match(source, /筛选 ARTEX 核查任务/)
    assert.match(source, /备注未保存/)
    assert.match(source, /disabled: !activeProgress \|\| reviewSaving !== null/)
    assert.match(source, /证据版本变化/)
  }
})

test('explicit review feedback export preserves source IDs and inspected versions without findings import', (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(DDL)
  const store = { ...methods, databases: { lab: db } }
  store.saveArtexReview('lab', {
    finding_id: 15, task_id: 4, evidence_version: 6,
    status: 'needs_evidence', note: 'Check report freshness before review',
  })
  store.saveArtexReview('lab', {
    finding_id: 16, task_id: null, evidence_version: null,
    status: 'reviewed', note: '',
  })
  const out = dispatch(store, {
    op: 'artexReviewExport', engagement: 'lab', finding_ids: [15, 16, 999],
  })
  assert.equal(out.ok, true)
  assert.equal(out.feedback.schema, 'artex.dsh.review-feedback.v1')
  assert.equal(out.feedback.source, 'dsh-purge')
  assert.equal(out.feedback.engagement, 'lab')
  assert.match(out.feedback.exported_at, /^\d{4}-\d\d-/)
  assert.deepEqual(out.feedback.reviews.map((x) => x.finding_id), [15, 16])
  assert.equal(out.feedback.reviews[0].task_id, 4)
  assert.equal(out.feedback.reviews[0].evidence_version, 6)
  assert.equal(out.feedback.reviews[0].status, 'needs_evidence')
  assert.equal(out.feedback.reviews[1].evidence_version, null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, 0)
})

test('manual review retries are idempotent; concurrent and stale writes preserve the saved note', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(DDL)
  const store = { ...methods, databases: { lab: db } }
  const input = { op: 'artexReviewSave', engagement: 'lab', finding_id: 24,
    task_id: 3, evidence_version: 7, expected_revision: 0, status: 'in_progress', note: 'Initial review' }
  const first = dispatch(store, input)
  assert.equal(first.review.revision, 1)
  assert.deepEqual(dispatch(store, input).review, first.review, 'lost-response retry changes nothing')
  const change = { ...input, note: 'Reviewer A update', expected_revision: 1, evidence_version: 8 }
  const updated = dispatch(store, change)
  assert.equal(updated.review.revision, 2)
  assert.deepEqual(dispatch(store, change).review, updated.review)
  const conflict = dispatch(store, { ...change, note: 'Reviewer B stale draft' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'artex_review_conflict')
  assert.deepEqual(conflict.current, updated.review)
  for (const evidence_version of [7, null]) {
    const stale = dispatch(store, { ...change, evidence_version, expected_revision: 2 })
    assert.equal(stale.ok, false)
    assert.equal(stale.code, 'artex_review_stale_evidence')
    assert.deepEqual(stale.current, updated.review)
  }
  assert.deepEqual(store.listArtexReviews('lab', [24]), [updated.review])
  const deliberate = dispatch(store, { ...change, expected_revision: 2, note: 'Compared then saved' })
  assert.equal(deliberate.review.revision, 3)
  assert.equal(deliberate.review.note, 'Compared then saved')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, 0)
})

test('migration preserves saved legacy review and supplies its first revision', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec("CREATE TABLE artex_review(source_finding_id INTEGER PRIMARY KEY, source_task_id INTEGER, evidence_version INTEGER, status TEXT, note TEXT, updated_at TEXT)")
  db.prepare('INSERT INTO artex_review VALUES (24, 3, 7, ?, ?, ?)').run('reviewed', 'Keep this', '2026-11-21T00:00:00.000Z')
  db.exec(DDL)
  migrate(db)
  migrate(db)
  const store = { ...methods, databases: { lab: db } }
  const row = store.listArtexReviews('lab', [24])[0]
  assert.equal(row.note, 'Keep this')
  assert.equal(row.status, 'reviewed')
  assert.equal(row.revision, 1)
})

test('manual comparison applies only the matching report and saved row; draft input is independent', () => {
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function applyArtexReviewSnapshot(')
  const end = source.indexOf('    function ArtexTab(props)', start)
  assert.ok(start >= 0 && end > start)
  const apply = runInNewContext(source.slice(start, end) + '\napplyArtexReviewSnapshot')
  const report = {}
  const previous = { _report: report, engagement: 'lab', items: [
    { source_finding_id: 24, revision: 1 }, { source_finding_id: 25, revision: 1 },
  ] }
  const row = { source_finding_id: 24, revision: 2, note: 'saved elsewhere' }
  assert.equal(apply(previous, {}, 'lab', 24, row), previous)
  assert.equal(apply(previous, report, 'other', 24, row), previous)
  const snapshot = apply(previous, report, 'lab', 24, row)
  assert.equal(snapshot.items.filter(item => item.source_finding_id === 25).length, 1)
  assert.equal(snapshot.items.find(item => item.source_finding_id === 24).revision, 2)
  const compare = source.slice(source.indexOf('const useSavedReviewForComparison'), source.indexOf('const saveReview ='))
  assert.match(compare, /setReviewProgress/)
  assert.doesNotMatch(compare, /setReviewNotes|api\(/)
  assert.match(source, /expected_revision: progressByFinding/)
  assert.match(source, /用已保存版本比对（保留草稿）/)
})
