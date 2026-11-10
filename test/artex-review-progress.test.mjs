import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DDL, RedteamStore, dispatch } from '../lib/redteam/store-core.js'

const methods = {
  db(id) { return this.databases[id] },
  saveArtexReview: RedteamStore.prototype.saveArtexReview,
  listArtexReviews: RedteamStore.prototype.listArtexReviews,
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

test('source and embedded ARTEX resource page expose manual review progress controls', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    assert.match(source, /artexReviewList/)
    assert.match(source, /artexReviewSave/)
    assert.match(source, /记录 DSH 人工核查进度/)
    assert.match(source, /证据版本变化/)
    assert.match(source, /progressLabel/)
  }
})
