// Deterministic subprocess fixture. No model calls, host control or external traffic.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RedteamStore } from '../../lib/redteam/store-core.js'
import { TaskRuns } from '../../lib/redteam/task-runs.js'
import { TaskRuntime } from '../../lib/redteam/task-runtime.js'
import { TaskPlanner } from '../../lib/redteam/task-planner.js'

const [root, phase] = process.argv.slice(2)
const store = new RedteamStore(join(root, 'data'))
const stateFile = join(root, 'fixture.json')
const setup = ['setup', 'rollback-setup'].includes(phase)
const engagement = setup ? store.openEngagement('restart-fixture', ['192.0.2.0/24']).id
  : JSON.parse(readFileSync(stateFile, 'utf8')).engagement
if (setup) writeFileSync(stateFile, JSON.stringify({ engagement }))
const db = store.db(engagement)
const runtime = new TaskRuntime(store)
const agent = { status: 'running', session: { id: 'fixture-executor', events: [] } }
const runs = new TaskRuns(store, engagement, 'fixture-root', runtime, agent)
const planner = new TaskPlanner(runs)
const key = n => 'review:asset #' + n
const payload = n => ({ asset_id: n, operation_key: 'capture-' + n,
  request: 'GET /fixture/' + n + ' HTTP/1.1', response: 'HTTP/1.1 200 OK' })
const current = n => runs.status({ task_key: key(n) }).attempt.id
const complete = n => {
  const id = runs.start(key(n)).attempt.id
  runtime.bind(runs, id, agent)
  const written = runs.addEvidence(id, payload(n))
  assert.equal(runs.addEvidence(id, payload(n)).id, written.id)
  runs.transition(id, 'submit')
  assert.equal(runs.transition(id, 'verify').assessment.passed, true)
}
const counts = () => Object.fromEntries(['http_evidence', 'task_attempt_evidence', 'task_evidence_operation', 'task_attempt']
  .map(table => [table, db.prepare('SELECT COUNT(*) n FROM ' + table).get().n]))

switch (phase) {
  case 'setup': {
    for (let n = 1; n <= 24; n++) {
      db.prepare('INSERT INTO asset(id,segment_cidr,ip) VALUES(?,?,?)').run(n, '192.0.2.0/24', '192.0.2.' + n)
      if (n > 1) planner.dependencies(key(n), [key(n - 1)], 'synthetic sequential record review')
    }
    assert.throws(() => runs.start(key(24)), /wait-for-dependencies/)
    for (let n = 1; n <= 8; n++) complete(n)
    const id = runs.start(key(9)).attempt.id
    runtime.bind(runs, id, agent)
    planner.fail(id, 'method', 'synthetic method lacks the required record')
    assert.throws(() => runs.start(key(9), true), /revise-or-review/)
    break
  }
  case 'lost-write-ack': {
    assert.equal(planner.inspect(key(9)).retry_allowed, false)
    planner.revise(key(9), 'synthetic-record-v2', 'recorded failure requires a different fixture method')
    const id = runs.start(key(9), true).attempt.id
    runtime.bind(runs, id, agent)
    runs.addEvidence(id, payload(9))
    // Abrupt exit after the committed write, before sending any acknowledgement.
    process.exit(86)
  }
  case 'lost-submit-ack': {
    const id = current(9)
    assert.equal(runs.status({ attempt_id: id }).recovery_required, true)
    const before = counts()
    assert.equal(runs.start(key(9)).attempt.id, id, 'start must not replace unknown persisted work')
    const receipt = runs.addEvidence(id, payload(9))
    assert.equal(receipt.replayed, true)
    assert.deepEqual(counts(), before)
    assert.equal(runs.status({ attempt_id: id }).recovery_required, true, 'lookup never rebinds')
    assert.throws(() => runs.addEvidence(id, { ...payload(9), response: 'different' }), /payload conflict/)
    assert.throws(() => runs.addEvidence(id, { ...payload(9), operation_key: 'new-write' }), /reconciliation/)
    runtime.bind(runs, id, agent, true)
    runs.transition(id, 'submit')
    process.exit(87)
  }
  case 'finish': {
    const id = current(9)
    assert.equal(runs.status({ attempt_id: id }).attempt.status, 'verifying')
    assert.throws(() => runs.start(key(10)), /wait-for-dependencies/)
    assert.throws(() => runs.transition(id, 'verify'), /reconciliation/)
    runtime.bind(runs, id, agent, true)
    assert.equal(runs.transition(id, 'verify').attempt.status, 'completed')
    for (let n = 10; n <= 24; n++) complete(n)
    break
  }
  case 'audit': {
    for (let n = 1; n <= 24; n++) {
      const read = runs.status({ task_key: key(n) })
      assert.equal(read.attempt.status, 'completed')
      assert.equal(read.recovery_required, false)
      assert.equal(read.assessment.passed, true)
      assert.equal(runs.addEvidence(read.attempt.id, payload(n)).replayed, true)
      assert.equal(runs.transition(read.attempt.id, 'verify').attempt.status, 'completed')
    }
    assert.equal(planner.inspect(key(9)).strategy_ref, 'synthetic-record-v2')
    assert.ok(planner.history(key(9)).total >= 2)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM task_failure').get().n, 1)
    assert.deepEqual(counts(), { http_evidence: 24, task_attempt_evidence: 24, task_evidence_operation: 24, task_attempt: 25 })
    break
  }
  case 'rollback-setup': {
    db.exec("INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1')")
    runtime.bind(runs, runs.start(key(1)).attempt.id, agent)
    break
  }
  case 'rollback-write': {
    const id = current(1)
    runtime.bind(runs, id, agent, true)
    db.exec('BEGIN IMMEDIATE')
    runs.addEvidence(id, payload(1))
    assert.equal(counts().http_evidence, 1)
    // Connection is deliberately not closed; SQLite must discard the outer transaction.
    process.exit(88)
  }
  case 'rollback-audit': {
    assert.equal(counts().http_evidence, 0)
    assert.equal(counts().task_attempt_evidence, 0)
    assert.equal(counts().task_evidence_operation, 0)
    const id = current(1)
    assert.throws(() => runs.addEvidence(id, payload(1)), /reconciliation/)
    runtime.bind(runs, id, agent, true)
    assert.equal(runs.addEvidence(id, payload(1)).replayed, false)
    assert.equal(runs.addEvidence(id, payload(1)).replayed, true)
    runs.transition(id, 'submit')
    assert.equal(runs.transition(id, 'verify').assessment.passed, true)
    assert.equal(counts().http_evidence, 1)
    break
  }
  default: throw new Error('unknown fixture phase')
}
console.log(JSON.stringify({ phase, pid: process.pid, counts: counts() }))
store.close()
