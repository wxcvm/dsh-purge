import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DDL } from '../lib/redteam/schema.js'
import { taskProgressSnapshot, compareTaskProgress, taskProgressTarget } from '../lib/redteam/task-progress.js'
import { compareProgress, decideTaskHandoff } from '../lib/redteam/score-triage.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  db.exec(`INSERT INTO asset(id,segment_cidr,ip,state) VALUES(1,'192.0.2.0/24','192.0.2.1','live'),(2,'192.0.2.0/24','192.0.2.2','live');
    INSERT INTO vuln(id,asset_id,title,status,evidence) VALUES(1,1,'first','candidate','initial'),(2,2,'other','candidate','other');
    INSERT INTO http_evidence(id,vuln_id,response) VALUES(1,1,'AAAA'),(2,2,'OTHER');`)
  const store = { db: () => db }
  const snapshot = (key = 'review:vuln #1', engagement = 'lab') => taskProgressSnapshot(store, engagement, key)
  return { db, snapshot }
}

const globalBefore = { engagement_id: 'lab', score_points: 0, counted_hits: 0,
  recorded_hits: 0, assets: 2, confirmed: 0, evidence_items: 2 }

test('same-length evidence correction is visible without global count growth; raw text is not exposed', () => {
  const { db, snapshot } = fixture()
  try {
    const before = { ...globalBefore, task_scope: snapshot() }
    db.exec("UPDATE http_evidence SET response = 'BBBB' WHERE id = 1")
    const after = { ...globalBefore, task_scope: snapshot() }
    const progress = compareProgress(before, after)
    assert.equal(progress.status, 'no-change')
    assert.equal(progress.task_progress.status, 'records-changed')
    assert.equal(progress.task_progress.verification, 'not-performed')
    assert.equal(decideTaskHandoff(progress, 'done').decision, 'continue')
    assert.ok(!JSON.stringify(after.task_scope).includes('BBBB'))
  } finally { db.close() }
})

test('unrelated evidence and global score growth cannot advance an unchanged task', () => {
  const { db, snapshot } = fixture()
  try {
    const before = { ...globalBefore, task_scope: snapshot() }
    db.exec("INSERT INTO http_evidence(vuln_id,response) VALUES(2,'unrelated')")
    const progress = compareProgress(before, { ...globalBefore, score_points: 10, evidence_items: 3, task_scope: snapshot() })
    assert.equal(progress.status, 'scored')
    assert.equal(progress.task_progress.status, 'no-change')
    assert.equal(decideTaskHandoff(progress, 'done').decision, 'hold')
  } finally { db.close() }
})

test('asset scope includes indirect evidence and streams all rows, including changes after the first 100', () => {
  const { db, snapshot } = fixture()
  try {
    const add = db.prepare('INSERT INTO http_evidence(id,vuln_id,response) VALUES(?,1,?)')
    for (let id = 3; id < 130; id++) add.run(id, 'payload')
    const before = snapshot('review:asset #1')
    assert.equal(before.counts.evidence, 128)
    db.exec("UPDATE http_evidence SET response = 'changed' WHERE id = 129")
    assert.equal(compareTaskProgress(before, snapshot('review:asset #1')).status, 'records-changed')
  } finally { db.close() }
})

test('timestamp-only refreshes are ignored; deletions and missing targets require review', () => {
  const { db, snapshot } = fixture()
  try {
    const before = snapshot()
    db.exec("UPDATE http_evidence SET captured_at = 'later' WHERE id = 1")
    assert.equal(compareTaskProgress(before, snapshot()).status, 'no-change')
    db.exec('DELETE FROM http_evidence WHERE id = 1')
    const after = snapshot()
    assert.equal(compareTaskProgress(before, after).status, 'records-removed')
    assert.equal(decideTaskHandoff({ status: 'records-added', task_progress: compareTaskProgress(before, after) }, 'done').decision, 'hold')
    db.exec('DELETE FROM vuln WHERE id = 1')
    assert.equal(compareTaskProgress(before, snapshot()).status, 'missing')
  } finally { db.close() }
})

test('scope mismatch and incomplete baselines reject instead of silently using global progress', () => {
  const { db, snapshot } = fixture()
  try {
    const before = snapshot()
    assert.throws(() => compareTaskProgress(before, snapshot('review:vuln #2')), /scope mismatch/)
    assert.throws(() => compareTaskProgress(before, snapshot('review:vuln #1', 'other')), /scope mismatch/)
    assert.throws(() => compareProgress({ ...globalBefore, task_scope: before }, globalBefore), /mismatch/)
    assert.throws(() => compareTaskProgress(before, { ...before, digest: 'invalid' }), /invalid/)
    assert.equal(snapshot('report:all'), null)
    assert.equal(taskProgressTarget('review:vuln #9007199254740992'), null)
    // Savepoints remain nestable and do not commit an outer transaction.
    db.exec('BEGIN')
    snapshot()
    db.exec('ROLLBACK')
  } finally { db.close() }
})

test('legacy callers keep their original aggregate handoff behavior', () => {
  const progress = compareProgress(globalBefore, { ...globalBefore, evidence_items: 3 })
  assert.equal(progress.task_progress, undefined)
  assert.equal(decideTaskHandoff(progress, 'done').decision, 'continue')
})

test('registered next_action and progress_check preserve and enforce task scope end to end', async t => {
  const home = mkdtempSync(join(tmpdir(), 'purge-task-progress-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const mod = join(home, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(mod, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{}')
  writeFileSync(join(mod, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(mod, 'index.js'), 'exports.defineTool = spec => spec\n')
  const { RedteamStore } = await import('../lib/redteam/store-core.js')
  const { apply } = await import('../lib/redteam/tools.js')
  const store = new RedteamStore(join(home, 'redteam'))
  t.after(() => {
    store.close()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })
  const engagement = store.openEngagement('fixture', '192.0.2.0/24').id
  store.db(engagement).exec(`INSERT INTO asset(id,segment_cidr,ip,state,test_status,priority) VALUES(1,'192.0.2.0/24','192.0.2.1','live','untested','high')`)
  const registered = new Map()
  apply({ redteam: store, tools: { register: tool => registered.set(tool.name, tool) },
    on: () => () => {}, effect: fn => { const dispose = fn(); t.after(() => dispose?.()) } })
  const call = async (name, args) => JSON.parse(await registered.get(name).execute({ engagement, ...args }, {}))
  const card = await call('redteam_next_action', {})
  assert.equal(card.ok, true)
  assert.equal(card.focus.before.task_scope.target, 'asset #1')
  const before = JSON.stringify(card.focus.before)
  const unchanged = await call('redteam_progress_check', { before })
  assert.equal(unchanged.task_progress.status, 'no-change')
  store.db(engagement).exec("UPDATE asset SET test_notes = 'checked existing evidence' WHERE id = 1")
  const checked = await call('redteam_progress_check', { before })
  assert.equal(checked.task_progress.status, 'records-changed')
  const mismatch = await call('redteam_progress_check', { before, task_key: 'other:asset #1' })
  assert.equal(mismatch.ok, false)
  const handed = await call('redteam_next_action', { previous_task: JSON.stringify({
    task_key: card.focus.task_key, before: card.focus.before, outcome: 'done',
  }) })
  assert.equal(handed.handoff.progress.task_progress.status, 'records-changed')
  assert.equal(handed.handoff.decision, 'continue')
})
