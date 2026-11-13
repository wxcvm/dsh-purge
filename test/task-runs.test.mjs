import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DDL } from '../lib/redteam/schema.js'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { decideTaskHandoff } from '../lib/redteam/score-triage.js'

const key = 'review:vuln #1'
const evidence = { vuln_id: 1, request: 'GET / HTTP/1.1', response: 'HTTP/1.1 200 OK' }
function fixture(t, path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec(DDL)
  db.exec(`INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1'),(2,'192.0.2.0/24','192.0.2.2');
    INSERT INTO vuln(id,asset_id,title) VALUES(1,1,'one'),(2,2,'two')`)
  const store = { db: () => db, addHttpEvidence: RedteamStore.prototype.addHttpEvidence }
  const runs = new TaskRuns(store, 'lab', 'root-one')
  let closed = false
  const close = () => { if (!closed) { db.close(); closed = true } }
  t.after(close)
  return { db, store, runs, close }
}
const begin = runs => runs.start(key).attempt.id

test('start is idempotent and claim of completion cannot bypass submit/verify', t => {
  const { db, runs } = fixture(t)
  const id = begin(runs)
  assert.equal(begin(runs), id)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_attempt').get().n, 1)
  assert.throws(() => runs.transition(id, 'verify'), /submitted/)
  assert.equal(decideTaskHandoff({ status: 'scored', task_run: runs.status({ task_key: key }) }, 'done').decision, 'hold')
})

test('attributed write, submit and record-integrity verification complete only the declared criterion', t => {
  const { runs } = fixture(t)
  const id = begin(runs)
  const saved = runs.addEvidence(id, evidence)
  assert.equal(saved.attempt_id, id)
  runs.transition(id, 'submit')
  const result = runs.transition(id, 'verify')
  assert.equal(result.attempt.status, 'completed')
  assert.deepEqual(result.assessment.evidence_ids, [saved.id])
  assert.equal(result.assessment.scope, 'record-integrity')
  assert.equal(result.runtime_activity, 'not-observed')
  assert.ok(!JSON.stringify(result).includes(evidence.request))
  assert.equal(decideTaskHandoff({ status: 'no-change', task_run: result }, 'done').decision, 'continue')
})

test('unattributed evidence on the very same target cannot complete this attempt', t => {
  const { store, runs } = fixture(t)
  const id = begin(runs)
  store.addHttpEvidence('lab', evidence)
  runs.transition(id, 'submit')
  const result = runs.transition(id, 'verify')
  assert.equal(result.attempt.status, 'failed')
  assert.deepEqual(result.assessment.issues, ['no-attributed-evidence'])
})

test('different root sessions cannot start, write, submit, cancel or verify the active attempt', t => {
  const { store, runs, db } = fixture(t)
  const id = begin(runs)
  const other = new TaskRuns(store, 'lab', 'root-two')
  assert.throws(() => other.start(key), /different root/)
  assert.throws(() => other.addEvidence(id, evidence), /different root/)
  for (const action of ['submit', 'cancel', 'verify']) assert.throws(() => other.transition(id, action), /different root/)
  assert.throws(() => new TaskRuns(store, 'lab').start(key), /host root/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM http_evidence').get().n, 0)
})

test('wrong targets, conflicting associations and empty bodies do not leave orphan evidence', t => {
  const { runs, db } = fixture(t)
  const id = begin(runs)
  for (const args of [{ ...evidence, vuln_id: 2 }, { ...evidence, asset_id: 2 },
    { ...evidence, response: ' ' }, { ...evidence, vuln_id: 999 }]) {
    assert.throws(() => runs.addEvidence(id, args))
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM http_evidence').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_attempt_evidence').get().n, 0)
})

test('capture rollback also undoes an evidence insertion if a later operation fails', t => {
  const { runs, store, db } = fixture(t)
  const id = begin(runs)
  const add = store.addHttpEvidence
  store.addHttpEvidence = function (...args) { add.apply(this, args); throw new Error('simulated storage failure') }
  assert.throws(() => runs.addEvidence(id, evidence), /simulated/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM http_evidence').get().n, 0)
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'running')
})

test('retry is explicit, creates a new attempt and cannot reuse or mutate old ownership', t => {
  const { runs } = fixture(t)
  const old = begin(runs)
  assert.throws(() => runs.start(key, true), /failed or cancelled/)
  runs.transition(old, 'submit')
  runs.transition(old, 'verify')
  const current = runs.start(key, true).attempt.id
  assert.notEqual(current, old)
  assert.equal(runs.status({ attempt_id: old }).attempt.current, false)
  assert.throws(() => runs.addEvidence(old, evidence), /no longer current/)
  assert.throws(() => runs.transition(old, 'cancel'), /no longer current/)
  assert.deepEqual(runs.status({ attempt_id: current }).assessment.evidence_ids, [])
})

test('cancelled attempts do not silently restart; submission freezes evidence writes', t => {
  const { runs } = fixture(t)
  const id = begin(runs)
  runs.transition(id, 'cancel')
  assert.equal(runs.start(key).attempt.status, 'cancelled')
  assert.throws(() => runs.addEvidence(id, evidence), /running/)
  const next = runs.start(key, true).attempt.id
  runs.addEvidence(next, evidence)
  runs.transition(next, 'submit')
  assert.throws(() => runs.addEvidence(next, evidence), /running/)
})

test('changed or deleted evidence invalidates even a stored completed attempt', t => {
  const { runs, db } = fixture(t)
  const id = begin(runs)
  const saved = runs.addEvidence(id, evidence)
  runs.transition(id, 'submit')
  runs.transition(id, 'verify')
  db.prepare('UPDATE http_evidence SET response=? WHERE id=?').run('CHANGED', saved.id)
  const changed = runs.status({ attempt_id: id })
  assert.equal(changed.attempt.status, 'completed', 'stored status is retained, not silently rewritten')
  assert.equal(changed.assessment.passed, false)
  assert.equal(decideTaskHandoff({ status: 'scored', task_run: changed }, 'done').decision, 'hold')
  db.prepare('DELETE FROM http_evidence WHERE id=?').run(saved.id)
  assert.match(runs.status({ attempt_id: id }).assessment.issues[0], /evidence-missing/)
})

test('asset attempts accept indirectly linked evidence but cannot cross target boundaries', t => {
  const { runs } = fixture(t)
  const id = runs.start('review:asset #1').attempt.id
  runs.addEvidence(id, evidence)
  assert.throws(() => runs.addEvidence(id, { ...evidence, vuln_id: 2 }), /target/)
  runs.transition(id, 'submit')
  assert.equal(runs.transition(id, 'verify').assessment.passed, true)
})

test('attempts survive SQLite reopen and DDL is additive without claiming live activity', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-attempt-reopen-'))
  const { runs, db, close } = fixture(t, join(root, 'one.db'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const id = begin(runs)
  runs.addEvidence(id, evidence)
  close()
  const reopened = new DatabaseSync(join(root, 'one.db'))
  try {
    reopened.exec(DDL)
    const read = new TaskRuns({ db: () => reopened }, 'lab').status({ attempt_id: id })
    assert.equal(read.attempt.status, 'running')
    assert.equal(read.runtime_activity, 'not-observed')
    assert.equal(read.assessment.evidence_ids.length, 1)
    assert.equal(reopened.prepare('SELECT COUNT(*) n FROM asset').get().n, 2)
    const other = new DatabaseSync(':memory:')
    try {
      other.exec(DDL)
      assert.throws(() => new TaskRuns({ db: () => other }, 'other').status({ attempt_id: id }), /not found/)
    } finally { other.close() }
  } finally { reopened.close() }
})

test('registered tools enforce attempt handoff and same-root ownership end to end', async t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-task-tools-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const mod = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(mod, { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}')
  writeFileSync(join(mod, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(mod, 'index.js'), 'exports.defineTool = spec => spec\n')
  const store = new RedteamStore(join(root, 'data'))
  t.after(() => { store.close(); if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; rmSync(root, { recursive: true, force: true }) })
  const engagement = store.openEngagement('fixture', '192.0.2.0/24').id
  store.db(engagement).exec("INSERT INTO asset(id,segment_cidr,ip,state,test_status,priority) VALUES(1,'192.0.2.0/24','192.0.2.1','live','untested','high')")
  const tools = new Map()
  const { apply } = await import('../lib/redteam/tools.js')
  apply({ redteam: store, tools: { register: tool => tools.set(tool.name, tool) }, on: () => () => {},
    effect: fn => { const dispose = fn(); t.after(() => dispose?.()) } })
  const agents = new Map()
  const call = async (name, args, session = 'root') => {
    if (!agents.has(session)) agents.set(session, { status: 'running', session: { id: session,
      ...(session === 'child' ? { header: { parentSession: 'root' } } : {}) } })
    return JSON.parse(await tools.get(name).execute({ engagement, ...args }, { agent: agents.get(session) }))
  }
  const card = (await call('redteam_next_action', {})).focus
  const started = await call('redteam_task_run', { action: 'start', task_key: card.task_key })
  assert.equal(started.ok, true)
  const id = started.attempt.id
  const resumed = await call('redteam_next_action', {})
  assert.equal(resumed.focus.task_run.attempt.id, id)
  assert.equal(resumed.focus.task_run.runtime_activity, 'session-running')
  assert.match(resumed.focus.first_tool, /redteam_task_run/)
  const args = { attempt_id: id, asset_id: 1, request: 'request', response: 'response' }
  assert.equal((await call('redteam_http_evidence_add', args, 'other-root')).ok, false)
  assert.equal((await call('redteam_http_evidence_add', args, 'child')).ok, false, 'a sibling executor under the same root cannot write to a live-bound attempt')
  assert.equal((await call('redteam_http_evidence_add', args)).ok, true)
  const previous = { task_key: card.task_key, before: card.before, outcome: 'done' }
  const held = await call('redteam_next_action', { previous_task: JSON.stringify(previous) })
  assert.equal(held.handoff.decision, 'hold', 'omitting attempt ID cannot bypass tracked task verification')
  await call('redteam_task_run', { action: 'submit', attempt_id: id })
  const verified = await call('redteam_task_run', { action: 'verify', attempt_id: id })
  assert.equal(verified.attempt.status, 'completed')
  const progress = await call('redteam_progress_check', { before: JSON.stringify(card.before), attempt_id: id })
  assert.equal(progress.task_run.assessment.passed, true)
  const done = await call('redteam_next_action', { previous_task: JSON.stringify(previous) })
  assert.equal(done.handoff.decision, 'continue')
  store.db(engagement).exec("UPDATE http_evidence SET response='changed after acceptance'")
  const invalidated = await call('redteam_next_action', { previous_task: JSON.stringify(previous) })
  assert.equal(invalidated.handoff.decision, 'hold')
})
