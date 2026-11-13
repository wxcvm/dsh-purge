/** Local plan edits and evidence-based retry advice, never command execution. */
import { createHash } from 'node:crypto'
import { taskProgressSnapshot, taskProgressTarget } from './task-progress.js'

export class TaskPlanner {
  constructor(runs) { this.runs = runs; this.db = runs.db }

  validateKey(key) {
    const target = taskProgressTarget(key)
    if (!target || !this.db.prepare(`SELECT id FROM ${target.kind} WHERE id=?`).get(target.id)) throw new Error('plan requires an existing asset/vuln task target')
  }

  editable(key) {
    this.runs.requireOwner()
    this.validateKey(key)
    const task = this.runs.task(key)
    if (task) {
      const attempt = this.runs.attempt(task.current_attempt_id)
      if (['running', 'verifying', 'completed'].includes(attempt.status)) throw new Error('cannot revise an active or completed task')
    }
  }

  reason(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('plan reason must contain 1..1000 characters')
    return text.trim()
  }

  dependencies(key, keys, reason) {
    return this.runs.transaction(() => {
      this.editable(key)
      reason = this.reason(reason)
      if (!Array.isArray(keys) || keys.length > 100 || !keys.every(k => typeof k === 'string')) throw new Error('requires must be an array of at most 100 task keys')
      for (const dependency of keys) this.validateKey(dependency)
      const before = this.db.prepare('SELECT requires_task_key k FROM task_dependency WHERE task_key=? ORDER BY requires_task_key').all(key).map(row => row.k)
      if (JSON.stringify(before) === JSON.stringify([...new Set(keys)].sort())) return this.inspect(key)
      this.db.prepare('DELETE FROM task_dependency WHERE task_key=?').run(key)
      const add = this.db.prepare('INSERT INTO task_dependency(task_key,requires_task_key) VALUES(?,?)')
      for (const dependency of new Set(keys)) add.run(key, dependency)
      if (this.ancestors(key).includes(key)) throw new Error('task dependency cycle')
      this.db.prepare(`INSERT INTO task_plan(task_key,strategy_ref,revision,reason,updated_at)
        VALUES(?,'default',1,?,?) ON CONFLICT(task_key) DO UPDATE SET
        reason=excluded.reason,revision=revision+1,updated_at=excluded.updated_at`)
        .run(key, reason, new Date().toISOString())
      this.recordRevision(key)
      return this.inspect(key)
    })
  }

  revise(key, strategy, reason) {
    return this.runs.transaction(() => {
      this.editable(key)
      reason = this.reason(reason)
      if (typeof strategy !== 'string' || !strategy.trim() || strategy.length > 200) throw new Error('strategy_ref must contain 1..200 characters')
      strategy = strategy.trim()
      if ((this.db.prepare('SELECT strategy_ref FROM task_plan WHERE task_key=?').get(key)?.strategy_ref || 'default') === strategy) throw new Error('strategy_ref must change; renaming the same plan is not progress')
      this.db.prepare(`INSERT INTO task_plan(task_key,strategy_ref,revision,reason,updated_at) VALUES(?,?,1,?,?)
        ON CONFLICT(task_key) DO UPDATE SET strategy_ref=excluded.strategy_ref,
        revision=revision+1,reason=excluded.reason,updated_at=excluded.updated_at`)
        .run(key, strategy, reason, new Date().toISOString())
      this.recordRevision(key)
      return this.inspect(key)
    })
  }

  ancestors(key) {
    return this.db.prepare(`WITH RECURSIVE required(k) AS (
      SELECT requires_task_key FROM task_dependency WHERE task_key=? UNION
      SELECT d.requires_task_key FROM task_dependency d JOIN required r ON d.task_key=r.k
    ) SELECT k FROM required ORDER BY k`).all(key).map(row => row.k)
  }

  recordRevision(key) {
    const route = this.db.prepare('SELECT * FROM task_plan WHERE task_key=?').get(key)
      || { revision: 0, strategy_ref: 'default', reason: 'initial default route', updated_at: new Date().toISOString() }
    const requires = this.db.prepare('SELECT requires_task_key k FROM task_dependency WHERE task_key=? ORDER BY requires_task_key').all(key).map(row => row.k)
    this.db.prepare('INSERT OR IGNORE INTO task_plan_history VALUES(?,?,?,?,?,?)')
      .run(key, route.revision, route.strategy_ref, JSON.stringify(requires), route.reason, route.updated_at)
  }

  history(key) {
    const total = this.db.prepare('SELECT COUNT(*) n FROM task_plan_history WHERE task_key=?').get(key).n
    const items = this.db.prepare('SELECT * FROM task_plan_history WHERE task_key=? ORDER BY revision DESC LIMIT 20').all(key)
    return { total, returned: items.length, hasMore: total > items.length, items }
  }

  inspect(key) {
    if (typeof key !== 'string' || !key.trim()) throw new Error('task_key is required')
    return this.runs.transaction(() => {
      const route = this.db.prepare('SELECT * FROM task_plan WHERE task_key=?').get(key)
        || { strategy_ref: 'default', revision: 0 }
      const dependencies = this.ancestors(key).map(dependency => {
        const run = this.runs.status({ task_key: dependency })
        return { task_key: dependency, attempt_id: run.attempt?.id || null,
          satisfied: !!(run.attempt?.current && run.attempt.status === 'completed' && run.assessment.passed && !run.recovery_required) }
      })
      const target = taskProgressSnapshot(this.runs.store, this.runs.engagement, key)
      const digest = createHash('sha256').update(JSON.stringify([target?.digest || null, dependencies])).digest('hex')
      const current = this.runs.task(key)
      const attempt = current?.current_attempt_id ? this.runs.attempt(current.current_attempt_id) : null
      const failure = attempt && this.db.prepare('SELECT * FROM task_failure WHERE attempt_id=?').get(attempt.id)
      const changed = !!failure && (failure.condition_digest !== digest || failure.strategy_revision !== route.revision)
      const repeated = failure ? this.db.prepare('SELECT COUNT(*) n FROM task_failure WHERE task_key=? AND condition_digest=? AND strategy_revision=?')
        .get(key, digest, route.revision).n : 0
      let recommendation = 'ready'
      if (dependencies.some(d => !d.satisfied)) recommendation = 'wait-for-dependencies'
      else if (failure && !changed) recommendation = failure.kind === 'transient' && repeated < 2
        ? 'explicit-retry-available' : failure.kind === 'environment' ? 'wait-for-recorded-input-change' : 'revise-or-review'
      else if (failure && changed) recommendation = 'inputs-changed-review-before-retry'
      return { task_key: key, strategy_ref: route.strategy_ref, revision: route.revision,
        dependencies, condition_digest: digest, recommendation,
        retry_allowed: !dependencies.some(d => !d.satisfied) && (!failure || changed || (failure.kind === 'transient' && repeated < 2)),
        failure: failure ? { kind: failure.kind, reason: failure.reason, attempt_id: failure.attempt_id,
          conditions_changed: failure.condition_digest !== digest, plan_changed: failure.strategy_revision !== route.revision,
          same_condition_failures: repeated } : null,
        condition_scope: 'recorded-target-and-dependencies',
        note: '只建议与约束本地任务路线；不证明环境恢复，不执行方法或自动重试。' }
    })
  }

  assertReady(key) {
    const plan = this.inspect(key)
    if (!plan.retry_allowed) throw new Error('task plan requires review: ' + plan.recommendation)
  }

  waiting() {
    const keys = this.db.prepare(`SELECT task_key FROM task_plan UNION
      SELECT f.task_key FROM task_failure f JOIN task_run t ON t.current_attempt_id=f.attempt_id`).all()
    return keys.map(({ task_key }) => this.inspect(task_key)).filter(plan => !plan.retry_allowed)
  }

  fail(id, kind, reason) {
    if (!['transient', 'environment', 'method', 'evidence'].includes(kind)) throw new Error('invalid failure kind')
    reason = this.reason(reason)
    return this.runs.transaction(() => {
      const attempt = this.runs.attempt(id, true)
      if (!['running', 'verifying'].includes(attempt.status)) throw new Error('only an active attempt can fail')
      const plan = this.inspect(attempt.task_key)
      this.recordRevision(attempt.task_key)
      this.db.prepare('INSERT INTO task_failure VALUES(?,?,?,?,?,?,?)')
        .run(id, attempt.task_key, kind, reason, plan.condition_digest, plan.revision, new Date().toISOString())
      this.db.prepare("UPDATE task_attempt SET status='failed',finished_at=? WHERE id=?").run(new Date().toISOString(), id)
      return { ...this.runs.status({ attempt_id: id }), plan: this.inspect(attempt.task_key) }
    })
  }
}
