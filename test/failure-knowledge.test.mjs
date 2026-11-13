import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DDL } from '../lib/redteam/schema.js'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { TaskPlanner } from '../lib/redteam/task-planner.js'
import { knowledgeRequest } from '../lib/redteam/knowledge-center.js'
import { failureQueries, rankFailureReferences, failureKnowledge, recordKnowledgeFeedback } from '../lib/redteam/failure-knowledge.js'
import { evaluateFailureRetrieval } from '../scripts/evaluate-failure-retrieval.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-failure-knowledge-'))
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  db.exec("INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1')")
  const store = { root, db: () => db, getAsset: () => ({ ports: [{ product: 'SQLite' }] }) }
  const runs = new TaskRuns(store, 'lab', 'root')
  const planner = new TaskPlanner(runs)
  const key = 'review:asset #1', id = runs.start(key).attempt.id
  const options = { skills: () => [], artexStatus: () => ({ available: false, state: 'missing' }) }
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, db, store, runs, planner, key, id, options }
}

test('queries emit only controlled categories, known error codes and recognized products', () => {
  const queries = failureQueries({ kind: 'environment', reason: 'Bearer SECRET_VALUE at https://private.test/path EACCES' }, 'SQLite https://private.test/?token=SECRET_VALUE')
  assert.equal(queries.length, 3)
  assert.deepEqual(queries.map(row => row.term), ['EACCES', '依赖', 'SQLite'])
  assert.ok(!JSON.stringify(queries).includes('SECRET_VALUE'))
  assert.deepEqual(failureQueries({ kind: 'unknown' }), [])
})

test('no failure means no retrieval and does not create a personal knowledge database', t => {
  const { store, key, root } = fixture(t)
  const result = failureKnowledge(store, 'lab', key, { search: () => { throw Error('must not search') } })
  assert.equal(result.status, 'not-requested')
  assert.equal(existsSync(join(root, 'knowledge', 'personal.db')), false)
})

test('failure retrieval returns local references without bodies, writes or automatic recovery', t => {
  const { store, planner, id, key, root, db, options } = fixture(t)
  const saved = knowledgeRequest(root, { op: 'knowledgeSave', title: 'SQLite ETIMEDOUT 超时排查', body: 'UNTRUSTED_DOCUMENT_BODY' }).item
  planner.fail(id, 'transient', 'ETIMEDOUT at private endpoint')
  const changes = db.prepare('SELECT total_changes() n').get().n
  const result = failureKnowledge(store, 'lab', key, options)
  assert.equal(result.status, 'references-found')
  assert.deepEqual(result.items[0].reference, { source: 'personal', id: String(saved.id) })
  assert.equal(result.verification_scope, 'historical-reference')
  assert.ok(!JSON.stringify(result).includes('UNTRUSTED_DOCUMENT_BODY'))
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changes)
  assert.equal(db.prepare('SELECT status FROM task_attempt WHERE id=?').get(id).status, 'failed')
})

test('missing and failed sources remain explicit while usable references survive', t => {
  const { store, planner, id, key, root } = fixture(t)
  planner.fail(id, 'environment', 'ENOENT')
  let reads = 0
  const result = failureKnowledge(store, 'lab', key, {
    skills: () => { reads++; return [{ source: 'redteam', key: 'redteam:dependency', title: 'ENOENT 依赖诊断' }] },
    artexStatus: () => { throw Error('private filesystem path') },
  })
  assert.equal(reads, 1)
  assert.equal(result.items[0].reference.source, 'redteam')
  assert.ok(result.coverage.some(row => row.source === 'personal' && row.status === 'missing'))
  assert.ok(result.coverage.some(row => row.source === 'artex' && row.status === 'unavailable'))
  assert.ok(!JSON.stringify(result).includes('private filesystem path'))
  assert.equal(existsSync(join(root, 'knowledge', 'personal.db')), false)
})

test('ranking deduplicates sources, excludes unavailable rows and masks credential-like titles', () => {
  const group = { source: 'personal', available: true, items: [{ id: '1', title: 'Authorization: Bearer FAKE_SECRET_VALUE' }] }
  const result = rankFailureReferences([
    { query: { term: 'timeout', weight: 5 }, groups: [group, group] },
    { query: { term: 'SQLite', weight: 1 }, groups: [group, { ...group, available: false, items: [{ id: '2' }] }] },
  ])
  assert.equal(result.length, 1)
  assert.equal(result[0].score, 6)
  assert.ok(!JSON.stringify(result).includes('FAKE_SECRET_VALUE'))
})

test('feedback is bound to an owned failure and current reference, never task completion', t => {
  const { store, runs, planner, id, key, root, db, options } = fixture(t)
  const doc = knowledgeRequest(root, { op: 'knowledgeSave', title: 'SQLite 适用条件', body: 'reference' }).item
  planner.fail(id, 'method', 'unsuitable method')
  const args = { attempt_id: id, reference_source: 'personal', reference_id: String(doc.id), feedback: 'adopted' }
  const recorded = recordKnowledgeFeedback(runs, args, options)
  assert.equal(recorded.verification_scope, 'self-reported-usefulness')
  recordKnowledgeFeedback(runs, { ...args, feedback: 'not-helpful' }, options)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_knowledge_feedback').get().n, 1)
  assert.equal(runs.status({ task_key: key }).attempt.status, 'failed')
  assert.equal(new TaskPlanner(runs).inspect(key).retry_allowed, false)
  assert.throws(() => recordKnowledgeFeedback(new TaskRuns(store, 'lab', 'other'), args, options), /different root/)
  assert.throws(() => recordKnowledgeFeedback(runs, { ...args, reference_id: '999' }, options), /not in current failure/)
  knowledgeRequest(root, { op: 'knowledgeDelete', id: doc.id })
  assert.throws(() => recordKnowledgeFeedback(runs, args, options), /not in current failure/)
})

test('synthetic product-only versus failure-aware comparison is deterministic and makes no model claims', () => {
  const result = evaluateFailureRetrieval()
  assert.equal(result.cases.length, 8)
  assert.equal(result.baseline_recall_at_3, 0)
  assert.equal(result.guided_recall_at_3, 1)
  assert.equal(result.model_calls, 0)
  assert.equal(result.task_success_rate, null)
  assert.deepEqual(evaluateFailureRetrieval(), result)
})
