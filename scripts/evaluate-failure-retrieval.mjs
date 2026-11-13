/** Deterministic synthetic retrieval comparison, not a model/agent benchmark. */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DDL } from '../lib/redteam/schema.js'
import { TaskRuns } from '../lib/redteam/task-runs.js'
import { TaskPlanner } from '../lib/redteam/task-planner.js'
import { failureKnowledge, searchFailureQueries } from '../lib/redteam/failure-knowledge.js'

export function evaluateFailureRetrieval() {
  const cases = []
  const kinds = { transient: ['ETIMEDOUT', '超时'], environment: ['ENOENT', '依赖'],
    method: ['method', '适用条件'], evidence: ['evidence', '证据'] }
  for (const product of ['SQLite', 'Docker']) for (const [kind, [code, term]] of Object.entries(kinds)) {
    const root = mkdtempSync(join(tmpdir(), 'purge-retrieval-eval-'))
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(DDL)
      db.exec("INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1')")
      const store = { root, db: () => db, getAsset: () => ({ ports: [{ product }] }) }
      const runs = new TaskRuns(store, 'fixture', 'fixture-root')
      const key = 'review:asset #1', id = runs.start(key).attempt.id
      new TaskPlanner(runs).fail(id, kind, code)
      const expected = 'redteam:99'
      const rows = Array.from({ length: 12 }, (_, i) => ({
        source: 'redteam', key: 'redteam:' + i, title: product + ' reference ' + i,
      })).concat([{ source: 'redteam', key: expected, title: [product, code, term, 'diagnostic reference'].join(' ') }])
      const options = { skills: () => rows, artexStatus: () => ({ available: false, state: 'missing' }) }
      const baseline = searchFailureQueries(root, [{ term: product, weight: 1, basis: 'product-only-baseline' }], options)
      const guided = failureKnowledge(store, 'fixture', key, options)
      cases.push({ id: product + ':' + kind,
        baseline_hit_at_3: baseline.items.some(row => row.reference.id === expected),
        guided_hit_at_3: guided.items.some(row => row.reference.id === expected),
        baseline_queries: 1, guided_queries: guided.queries.length })
    } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
  }
  return { scope: 'synthetic-retrieval-fixtures', fixture_version: 1, cases,
    baseline_recall_at_3: cases.filter(row => row.baseline_hit_at_3).length / cases.length,
    guided_recall_at_3: cases.filter(row => row.guided_hit_at_3).length / cases.length,
    model_calls: 0, task_success_rate: null,
    note: 'Purpose-built fixtures test query selection and ranking with distractors. Not evidence of real-world recall, model task success, latency or cost improvements.' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(evaluateFailureRetrieval(), null, 2) + '\n')
}
