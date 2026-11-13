import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DDL } from '../lib/redteam/schema.js'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { TaskPlanner } from '../lib/redteam/task-planner.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const a = 'record:asset #1', b = 'record:asset #2', c = 'record:asset #3'
function fixture(t) {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  db.exec("INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1'),(2,'192.0.2.0/24','192.0.2.2'),(3,'192.0.2.0/24','192.0.2.3')")
  const store = { db: () => db, addHttpEvidence: RedteamStore.prototype.addHttpEvidence }
  const runs = new TaskRuns(store, 'lab', 'root')
  const planner = new TaskPlanner(runs)
  t.after(() => db.close())
  function complete(key, asset) {
    const id = runs.start(key).attempt.id
    const saved = runs.addEvidence(id, { asset_id: asset, request: 'request', response: 'response' })
    runs.transition(id, 'submit'); runs.transition(id, 'verify')
    return saved.id
  }
  return { db, store, runs, planner, complete }
}

test('dependencies gate starts until current prerequisite delivery is accepted', t => {
  const { runs, planner, complete, db } = fixture(t)
  planner.dependencies(b, [a], 'record source before dependent output')
  assert.equal(planner.inspect(b).recommendation, 'wait-for-dependencies')
  assert.throws(() => runs.start(b), /requires review/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_run WHERE task_key=?').get(b).n, 0)
  complete(a, 1)
  assert.equal(planner.inspect(b).retry_allowed, true)
  assert.equal(runs.start(b).attempt.status, 'running')
})

test('self and transitive cycles reject atomically without erasing the previous graph', t => {
  const { planner, db } = fixture(t)
  planner.dependencies(b, [a], 'first edge')
  planner.dependencies(c, [b], 'second edge')
  assert.throws(() => planner.dependencies(a, [c], 'would cycle'), /cycle/)
  assert.deepEqual(planner.ancestors(c), [a, b])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_dependency').get().n, 2)
  assert.throws(() => planner.dependencies(a, [a], 'self cycle'), /cycle/)
  assert.deepEqual(planner.ancestors(a), [])
})

test('an invalidated ancestor blocks downstream tasks even if the intermediate task was completed', t => {
  const { planner, complete, db, runs } = fixture(t)
  planner.dependencies(b, [a], 'source')
  planner.dependencies(c, [b], 'derived record')
  const evidenceId = complete(a, 1)
  complete(b, 2)
  assert.equal(planner.inspect(c).retry_allowed, true)
  db.prepare('UPDATE http_evidence SET response=? WHERE id=?').run('changed', evidenceId)
  assert.equal(planner.inspect(c).retry_allowed, false)
  assert.throws(() => runs.start(c), /requires review/)
})

test('one explicit transient retry is available; repeated same-condition failures require review', t => {
  const { runs, planner } = fixture(t)
  const first = runs.start(a).attempt.id
  planner.fail(first, 'transient', 'temporary transport issue')
  assert.equal(planner.inspect(a).recommendation, 'explicit-retry-available')
  const second = runs.start(a, true).attempt.id
  planner.fail(second, 'transient', 'same transport issue')
  assert.equal(planner.inspect(a).retry_allowed, false)
  assert.equal(planner.inspect(a).failure.same_condition_failures, 2)
  assert.throws(() => runs.start(a, true), /requires review/)
})

test('method failures require a changed local route; old attempts and accepted unrelated tasks remain intact', t => {
  const { runs, planner, complete } = fixture(t)
  complete(c, 3)
  const id = runs.start(a).attempt.id
  planner.fail(id, 'method', 'method does not fit recorded inputs')
  assert.throws(() => runs.start(a, true), /requires review/)
  assert.throws(() => planner.revise(a, 'default', 'no real change'), /must change/)
  planner.revise(a, 'skill:alternate-record-review', 'use another existing method')
  assert.deepEqual(planner.history(a).items.map(row => row.strategy_ref), ['skill:alternate-record-review', 'default'])
  assert.equal(planner.inspect(a).failure.plan_changed, true)
  assert.notEqual(runs.start(a, true).attempt.id, id)
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'failed')
  assert.equal(runs.status({ task_key: c }).attempt.status, 'completed')
})

test('a recorded target change permits review before retry, not a claim that the environment recovered', t => {
  const { runs, planner, db } = fixture(t)
  const id = runs.start(a).attempt.id
  planner.fail(id, 'environment', 'dependency unavailable')
  assert.equal(planner.inspect(a).recommendation, 'wait-for-recorded-input-change')
  db.prepare('UPDATE asset SET test_notes=? WHERE id=1').run('new recorded diagnostics')
  const plan = planner.inspect(a)
  assert.equal(plan.recommendation, 'inputs-changed-review-before-retry')
  assert.equal(plan.condition_scope, 'recorded-target-and-dependencies')
  assert.equal(plan.retry_allowed, true)
})

test('identical dependency edits do not clear a failure or manufacture a changed plan', t => {
  const { runs, planner } = fixture(t)
  const id = runs.start(a).attempt.id
  planner.fail(id, 'environment', 'same missing input')
  const before = planner.inspect(a)
  planner.dependencies(a, [], 'same graph')
  const after = planner.inspect(a)
  assert.equal(after.revision, before.revision)
  assert.equal(after.retry_allowed, false)
})

test('active and accepted routes cannot be rewritten; invalid failure requests leave state unchanged', t => {
  const { runs, planner } = fixture(t)
  const id = runs.start(a).attempt.id
  assert.throws(() => planner.revise(a, 'alternative', 'change active task'), /active or completed/)
  assert.throws(() => planner.dependencies(a, [b], 'change active graph'), /active or completed/)
  assert.throws(() => planner.fail(id, 'unknown', 'bad category'), /failure kind/)
  assert.throws(() => planner.fail(id, 'method', ''), /reason/)
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'running')
})

test('read-only waiting advice does not create records or execute actions', t => {
  const { db, planner } = fixture(t)
  planner.dependencies(b, [a], 'await initial evidence')
  const changes = db.prepare('SELECT total_changes() n').get().n
  assert.deepEqual(planner.waiting().map(item => item.task_key), [b])
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changes)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_attempt').get().n, 0)
})

test('registered tools skip dependency windows, unblock on acceptance and locally reroute a failed task', async t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-planner-tools-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const mod = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(mod, { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}')
  writeFileSync(join(mod, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(mod, 'index.js'), 'exports.defineTool = spec => spec\n')
  const store = new RedteamStore(join(root, 'data'))
  t.after(() => { store.close(); if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; rmSync(root, { recursive: true, force: true }) })
  const engagement = store.openEngagement('fixture', '192.0.2.0/24').id
  const add = store.db(engagement).prepare("INSERT INTO asset(id,segment_cidr,ip,state,test_status,priority) VALUES(?,'192.0.2.0/24',?,'live','untested','high')")
  for (let id = 1; id <= 40; id++) add.run(id, '192.0.2.' + id)
  const tools = new Map()
  const { apply } = await import('../lib/redteam/tools.js')
  apply({ redteam: store, tools: { register: tool => tools.set(tool.name, tool) }, on: () => () => {},
    effect: fn => { const dispose = fn(); t.after(() => dispose?.()) } })
  const agent = { status: 'running', session: { id: 'root', events: [] } }
  const call = async (name, args = {}) => JSON.parse(await tools.get(name).execute({ engagement, ...args }, { agent }))
  const first = (await call('redteam_next_action')).focus
  assert.equal(first.target, 'asset #1')
  const keyOf = id => first.task_key.replace(/asset #\d+$/, 'asset #' + id)
  for (let id = 1; id < 40; id++) {
    const configured = await call('redteam_task_run', { action: 'dependencies', task_key: keyOf(id), requires: [keyOf(40)], reason: 'use prerequisite recorded output' })
    assert.equal(configured.ok, true)
  }
  const deferred = await call('redteam_next_action')
  assert.equal(deferred.focus.target, 'asset #40', 'dependency filtering happens before the 30-row task window')
  assert.equal(deferred.waiting_plans_total, 39)
  assert.equal(deferred.waiting_plans.length, 30)
  assert.equal((await call('redteam_task_run', { action: 'start', task_key: keyOf(1) })).ok, false)
  const prerequisite = await call('redteam_task_run', { action: 'start', task_key: keyOf(40) })
  const attempt = prerequisite.attempt.id
  await call('redteam_http_evidence_add', { attempt_id: attempt, asset_id: 40, request: 'request', response: 'response' })
  await call('redteam_task_run', { action: 'submit', attempt_id: attempt })
  await call('redteam_task_run', { action: 'verify', attempt_id: attempt })
  const next = (await call('redteam_next_action')).focus
  assert.equal(next.target, 'asset #1')
  const started = await call('redteam_task_run', { action: 'start', task_key: keyOf(1) })
  const failed = await call('redteam_task_run', { action: 'fail', attempt_id: started.attempt.id, failure_kind: 'method', reason: 'recorded method unsuitable' })
  assert.equal(failed.attempt.status, 'failed')
  const switched = await call('redteam_next_action', { previous_task: JSON.stringify({ task_key: next.task_key, before: next.before, outcome: 'done' }) })
  assert.equal(switched.handoff.decision, 'skip')
  assert.equal(switched.focus.target, 'asset #2')
  const revised = await call('redteam_task_run', { action: 'revise', task_key: keyOf(1), strategy_ref: 'skill:alternate-review', reason: 'use another installed method' })
  assert.equal(revised.plan.retry_allowed, true)
  assert.equal((await call('redteam_task_run', { action: 'retry', task_key: keyOf(1) })).ok, true)
})
