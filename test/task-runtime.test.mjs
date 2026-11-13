import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DDL } from '../lib/redteam/schema.js'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { TaskRuntime, bindTaskRuntime } from '../lib/redteam/task-runtime.js'

const evidence = { asset_id: 1, request: 'request', response: 'response' }
function fixture(t) {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  db.exec("INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1')")
  const store = { db: () => db, addHttpEvidence: RedteamStore.prototype.addHttpEvidence }
  const runtime = new TaskRuntime(store)
  const runs = new TaskRuns(store, 'lab', 'root', runtime)
  const agent = { status: 'running', session: { id: 'executor', events: [] } }
  const id = runs.start('review:asset #1').attempt.id
  runtime.bind(runs, id, agent)
  t.after(() => db.close())
  return { db, store, runtime, runs, agent, id }
}
const end = (agent, seq, reason) => agent.session.events.push({ type: 'turn/end', seq, data: { reason } })

test('persisted attempt status and actual executor-session observation remain separate', t => {
  const { runs, agent, id } = fixture(t)
  const running = runs.status({ attempt_id: id })
  assert.equal(running.runtime_activity, 'session-running')
  assert.equal(running.runtime_scope, 'executor-session')
  agent.status = 'idle'
  const idle = runs.status({ attempt_id: id })
  assert.equal(idle.attempt.status, 'running')
  assert.equal(idle.runtime_activity, 'session-idle')
  assert.equal(idle.recovery_required, true)
})

test('user stop cancels only attempts bound to that exact executor', t => {
  const { runs, runtime, agent, id } = fixture(t)
  const sibling = { status: 'running', session: { id: 'sibling', events: [] } }
  const other = runs.start('other:asset #1').attempt.id
  runtime.bind(runs, other, sibling)
  end(agent, 4, { kind: 'aborted', reason: { kind: 'user' } })
  agent.status = 'idle'
  runtime.observe(agent, 'idle')
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'cancelled')
  assert.equal(runs.status({ attempt_id: other }).attempt.status, 'running')
  assert.throws(() => runs.addEvidence(id, evidence), /running/)
  assert.equal(runs.start('review:asset #1').attempt.id, id)
})

test('normal turn end is not task completion and requires explicit reconciliation', t => {
  const { db, runs, runtime, agent, id } = fixture(t)
  end(agent, 2, { kind: 'completed' })
  agent.status = 'idle'
  runtime.observe(agent, 'idle')
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'running')
  assert.throws(() => runs.addEvidence(id, evidence), /reconciliation/)
  agent.status = 'running'
  runtime.observe(agent, 'running')
  assert.equal(runs.status({ attempt_id: id }).recovery_required, true, 'new running event must not silently clear unknown effects')
  runtime.bind(runs, id, agent, true)
  assert.equal(runs.status({ attempt_id: id }).recovery_required, false)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM http_evidence').get().n, 0, 'reconcile never replays an operation')
  runs.addEvidence(id, evidence)
})

test('a missed idle event cannot let a later running turn silently reuse an unresolved attempt', t => {
  const { runtime, runs, agent, id } = fixture(t)
  end(agent, 8, { kind: 'completed' })
  assert.equal(runs.status({ attempt_id: id }).recovery_required, true)
  assert.throws(() => runs.addEvidence(id, evidence), /reconciliation/)
  runtime.bind(runs, id, agent, true)
  assert.equal(runs.status({ attempt_id: id }).recovery_required, false)
})

test('unload or missing turn-end information stays unknown instead of declaring success', t => {
  const { runs, runtime, agent, id } = fixture(t)
  runtime.observe(agent, 'idle')
  assert.equal(runs.status({ attempt_id: id }).recovery_required, true)
  runtime.observe(agent, null, true)
  const read = runs.status({ attempt_id: id })
  assert.equal(read.runtime_activity, 'not-observed')
  assert.equal(read.attempt.status, 'running')
  assert.equal(read.recovery_reason, 'executor-disposed')
})

test('fresh runtime cannot reuse a persisted binding; same-session reconciliation is explicit', t => {
  const { store, runs, agent, id } = fixture(t)
  const resumedRuntime = new TaskRuntime(store)
  const resumed = new TaskRuns(store, 'lab', 'root', resumedRuntime)
  assert.equal(resumed.status({ attempt_id: id }).runtime_activity, 'not-observed')
  assert.throws(() => resumed.addEvidence(id, evidence), /reconciliation/)
  assert.throws(() => new TaskRuns(store, 'lab', 'root').addEvidence(id, evidence), /reconciliation/)
  assert.throws(() => resumedRuntime.bind(resumed, id, { ...agent, session: { id: 'wrong' } }, true), /same executor/)
  resumedRuntime.bind(resumed, id, agent, true)
  assert.equal(resumed.status({ attempt_id: id }).recovery_required, false)
  assert.throws(() => runs.addEvidence(id, evidence), /reconciliation/, 'old generation cannot write after rebind')
})

test('late old-agent events cannot stop a newly rebound live agent', t => {
  const { runtime, runs, agent, id } = fixture(t)
  const replacement = { status: 'running', session: { id: 'executor', events: [] } }
  runtime.bind(runs, id, replacement, true)
  end(agent, 99, { kind: 'aborted', reason: 'user' })
  runtime.observe(agent, 'idle')
  runtime.observe(agent, null, true)
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'running')
  assert.equal(runs.status({ attempt_id: id }).recovery_required, false)
})

test('reconcile sees a user stop missed during unload and never restarts the attempt', t => {
  const { store, agent, id } = fixture(t)
  end(agent, 7, { kind: 'aborted', reason: 'cancel' })
  const resumedRuntime = new TaskRuntime(store)
  const resumed = new TaskRuns(store, 'lab', 'root', resumedRuntime)
  const result = resumedRuntime.bind(resumed, id, agent, true)
  assert.equal(result.attempt.status, 'cancelled')
  assert.equal(resumed.start('review:asset #1').attempt.id, id)
})

test('a stop already in history cannot cancel a newly started attempt', t => {
  const { runs, runtime, agent } = fixture(t)
  end(agent, 3, { kind: 'aborted', reason: 'user' })
  const id = runs.start('new:asset #1').attempt.id
  runtime.bind(runs, id, agent)
  runtime.observe(agent, 'idle')
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'running')
})

test('accepted record delivery survives executor disposal without requiring execution again', t => {
  const { runs, runtime, agent, id, store } = fixture(t)
  runs.addEvidence(id, evidence)
  runs.transition(id, 'submit')
  runs.transition(id, 'verify')
  runtime.observe(agent, null, true)
  const read = new TaskRuns(store, 'lab', 'root', new TaskRuntime(store)).status({ attempt_id: id })
  assert.equal(read.attempt.status, 'completed')
  assert.equal(read.assessment.passed, true)
  assert.equal(read.recovery_required, false)
})

test('event subscriptions belong to each plugin scope and all unload cleanly', t => {
  const { store, runs, agent, id } = fixture(t)
  function scope() {
    const handlers = new Map(), cleanups = []
    return { handlers, cleanups, ctx: {
      on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
      effect(fn) { cleanups.push(fn()) },
    } }
  }
  const first = scope(), second = scope()
  const a = bindTaskRuntime(first.ctx, store), b = bindTaskRuntime(second.ctx, store)
  assert.equal(a, b)
  const observedRuns = new TaskRuns(store, 'lab', 'root', a)
  a.bind(observedRuns, id, agent, true)
  first.cleanups.forEach(fn => fn())
  assert.equal(first.handlers.size, 0)
  end(agent, 5, { kind: 'aborted', reason: 'user' })
  second.handlers.get('agent/status')({ agent, status: 'idle' })
  assert.equal(runs.status({ attempt_id: id }).attempt.status, 'cancelled')
  second.cleanups.forEach(fn => fn())
  assert.equal(second.handlers.size, 0)
  assert.equal(a.bindings.size, 0)
})
