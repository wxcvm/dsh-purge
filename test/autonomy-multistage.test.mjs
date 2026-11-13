import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { TaskRuntime } from '../lib/redteam/task-runtime.js'
import { TaskPlanner } from '../lib/redteam/task-planner.js'
import { judgeMultistage, multistagePassed } from '../scripts/benchmark-autonomy-multistage.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-multistage-'))
  mkdirSync(join(root, 'data'))
  const store = new RedteamStore(join(root, 'data'))
  const engagement = store.openEngagement('fixture', ['192.0.2.0/24']).id
  const db = store.db(engagement)
  for (let n = 1; n <= 3; n++) db.prepare('INSERT INTO asset(id,segment_cidr,ip) VALUES(?,?,?)').run(n, '192.0.2.0/24', '192.0.2.' + n)
  writeFileSync(join(root, 'data', 'fixture.json'), JSON.stringify({ engagement, dbPath: store.dbPathOf(engagement) }))
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const runtime = new TaskRuntime(store), agent = { status: 'running', session: { id: 'fixture', events: [] } }
  const runs = new TaskRuns(store, engagement, 'root', runtime, agent)
  const payload = n => ({ asset_id: n, request: 'GET /fixture/' + n + ' HTTP/1.1', response: 'HTTP/1.1 200 OK' })
  const complete = n => {
    const id = runs.start('record:asset #' + n).attempt.id
    runtime.bind(runs, id, agent)
    runs.addEvidence(id, { ...payload(n), operation_key: 'record-' + n })
    runs.transition(id, 'submit'); runs.transition(id, 'verify')
  }
  return { root, db, runs, runtime, agent, planner: new TaskPlanner(runs), payload, complete, store, engagement }
}

test('baseline uses a common exact artifact judge without requiring candidate-only capabilities', t => {
  const f = fixture(t)
  f.store.addHttpEvidence(f.engagement, f.payload(1))
  assert.equal(judgeMultistage(f.root, 'pause', false).passed, true)
  assert.equal(judgeMultistage(f.root, 'resume', false).passed, false)
  for (const n of [2, 3]) f.store.addHttpEvidence(f.engagement, f.payload(n))
  assert.equal(judgeMultistage(f.root, 'resume', false).passed, true)
  assert.equal(judgeMultistage(f.root, 'pause', false).passed, false, 'overrunning the pause is not a pass')
  f.store.addHttpEvidence(f.engagement, f.payload(1))
  assert.equal(judgeMultistage(f.root, 'resume', false).passed, false, 'duplicate delivery is not a pass')
})

test('candidate must preserve dependencies, pause an unfinished bound attempt, then accept all deliveries', t => {
  const f = fixture(t)
  f.planner.dependencies('record:asset #2', ['record:asset #1'], 'fixture')
  f.planner.dependencies('record:asset #3', ['record:asset #2'], 'fixture')
  f.complete(1)
  const id = f.runs.start('record:asset #2').attempt.id
  f.runtime.bind(f.runs, id, f.agent)
  assert.equal(judgeMultistage(f.root, 'pause', true).passed, true)
  f.complete(2); f.complete(3)
  assert.equal(judgeMultistage(f.root, 'resume', true).passed, true)
  f.db.exec('DELETE FROM task_dependency')
  assert.equal(judgeMultistage(f.root, 'resume', true).passed, false)
})

test('changed evidence fails the external candidate assessment even with completed stored statuses', t => {
  const f = fixture(t)
  for (const n of [1, 2, 3]) f.complete(n)
  f.db.exec("UPDATE http_evidence SET response='PRIVATE_MODIFIED' WHERE asset_id=1")
  const result = judgeMultistage(f.root, 'resume', true)
  assert.equal(result.passed, false)
  assert.equal(result.accepted[0], false)
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'))
})

test('native adoption, complete pairs, isolation, trace alignment and outcomes are independent pass requirements', () => {
  const phase = { valid: true, exit: 0, timeout: false, dispatchTraceAligned: true, judgement: { passed: true } }
  const pair = { nativeSessionAdopted: true, phases: [phase, phase] }
  assert.equal(multistagePassed({ runtimeStable: true, pairs: [pair, pair] }, 2), true)
  assert.equal(multistagePassed({ runtimeStable: true, pairs: [pair] }, 2), false)
  assert.equal(multistagePassed({ runtimeStable: false, pairs: [pair] }, 1), false)
  assert.equal(multistagePassed({ runtimeStable: true, pairs: [{ ...pair, nativeSessionAdopted: false }] }, 1), false)
  assert.equal(multistagePassed({ runtimeStable: true, pairs: [{ ...pair, phases: [phase] }] }, 1), false)
  assert.equal(multistagePassed({ runtimeStable: true, pairs: [{ ...pair, phases: [phase, { ...phase, dispatchTraceAligned: false }] }] }, 1), false)
})
