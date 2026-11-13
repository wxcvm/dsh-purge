/** Observe the explicitly bound executor session, never infer task success or replay work. */
import { randomUUID } from 'node:crypto'

function lastEnd(agent) {
  const session = agent?.session
  const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : session?.events
  if (!Array.isArray(events)) return null
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'turn/end' && Number.isSafeInteger(events[i].seq)) return events[i]
  }
  return null
}

function userStop(event) {
  const reason = event?.data?.reason
  const cause = reason?.reason
  return reason?.kind === 'aborted' && ['user', 'cancel'].includes(typeof cause === 'string' ? cause : cause?.kind)
}

export class TaskRuntime {
  constructor(store) {
    this.store = store
    this.token = randomUUID()
    this.bindings = new Map()
  }

  row(engagement, id) {
    return this.store.db(engagement).prepare('SELECT * FROM task_attempt_runtime WHERE attempt_id=?').get(id)
  }

  describe(engagement, id) {
    const saved = this.row(engagement, id)
    if (!saved) return { runtime_activity: 'not-observed', recovery_required: false }
    const binding = this.bindings.get(id)
    const current = binding && binding.engagement === engagement && saved.binding_token === binding.token
    const status = this.store.db(engagement).prepare('SELECT status FROM task_attempt WHERE id=?').get(id)?.status
    const active = status === 'running' || status === 'verifying'
    const end = current && !binding.disposed ? lastEnd(binding.agent) : null
    const unprocessedEnd = end && end.seq > saved.last_end_seq
    let activity = 'not-observed'
    if (current && !binding.disposed) {
      if (binding.agent.status === 'running') activity = 'session-running'
      else if (binding.agent.status === 'idle') activity = 'session-idle'
    }
    return { runtime_activity: activity, runtime_scope: 'executor-session',
      executor_session_id: saved.executor_session_id,
      recovery_required: active && !!(!current || binding.disposed || saved.recovery_state !== 'bound' || activity !== 'session-running' || unprocessedEnd),
      recovery_reason: !current ? 'binding-not-live' : unprocessedEnd ? 'unprocessed-turn-end' : saved.reason || null }
  }

  assertWritable(engagement, id, executor) {
    const binding = this.bindings.get(id)
    if (executor && binding?.agent !== executor) throw new Error('executor binding mismatch; runtime reconciliation required')
    if (binding) this.observe(binding.agent, binding.agent.status)
    const status = this.store.db(engagement).prepare('SELECT status FROM task_attempt WHERE id=?').get(id)?.status
    if (!['running', 'verifying'].includes(status)) throw new Error('attempt stopped by host')
    if (this.describe(engagement, id).recovery_required) throw new Error('runtime reconciliation required; do not replay unknown work')
  }

  bind(runs, id, agent, reconcile = false) {
    const sessionId = agent?.session?.id
    if (sessionId == null || !['running', 'idle'].includes(agent.status)) throw new Error('live executor session unavailable')
    return runs.transaction(() => {
      const attempt = runs.attempt(id, true, true)
      if (!['running', 'verifying'].includes(attempt.status)) return runs.status({ attempt_id: id })
      const saved = this.row(runs.engagement, id)
      if (saved && saved.executor_session_id !== String(sessionId)) throw new Error('reconcile requires the same executor session')
      if (saved && !reconcile) return runs.status({ attempt_id: id })
      const end = lastEnd(agent)
      // A user stop is terminal for this attempt, including one missed while unloaded.
      if (saved && end && end.seq > saved.last_end_seq && userStop(end)) {
        this.stop(runs.engagement, id, end.seq, saved.binding_token)
        return runs.status({ attempt_id: id })
      }
      const token = this.token + ':' + randomUUID()
      this.store.db(runs.engagement).prepare(`INSERT INTO task_attempt_runtime
        (attempt_id,executor_session_id,binding_token,recovery_state,last_end_seq,reason,updated_at)
        VALUES(?,?,?,'bound',?,NULL,?) ON CONFLICT(attempt_id) DO UPDATE SET
        binding_token=excluded.binding_token,recovery_state='bound',last_end_seq=excluded.last_end_seq,
        reason=NULL,updated_at=excluded.updated_at`).run(id, String(sessionId), token, end?.seq ?? -1, new Date().toISOString())
      this.bindings.set(id, { engagement: runs.engagement, token, agent, disposed: false })
      return runs.status({ attempt_id: id })
    })
  }

  stop(engagement, id, seq, token) {
    const db = this.store.db(engagement)
    db.exec('SAVEPOINT purge_runtime_stop')
    try {
      if (this.row(engagement, id)?.binding_token !== token) { db.exec('RELEASE purge_runtime_stop'); return }
      db.prepare("UPDATE task_attempt SET status='cancelled',finished_at=? WHERE id=? AND status IN ('running','verifying')")
        .run(new Date().toISOString(), id)
      db.prepare("UPDATE task_attempt_runtime SET recovery_state='stopped',reason='user-stop',last_end_seq=?,updated_at=? WHERE attempt_id=?")
        .run(seq, new Date().toISOString(), id)
      db.exec('RELEASE purge_runtime_stop')
    } catch (error) {
      db.exec('ROLLBACK TO purge_runtime_stop; RELEASE purge_runtime_stop')
      throw error
    }
  }

  observe(agent, status, disposed = false) {
    for (const [id, binding] of this.bindings) {
      if (binding.agent !== agent) continue // Late events from an old Agent cannot change a rebound attempt.
      const db = this.store.db(binding.engagement)
      const saved = this.row(binding.engagement, id)
      if (!saved || saved.binding_token !== binding.token) continue
      const attempt = db.prepare('SELECT status FROM task_attempt WHERE id=?').get(id)
      if (!attempt || !['running', 'verifying'].includes(attempt.status)) { this.bindings.delete(id); continue }
      const end = lastEnd(agent)
      if (end && end.seq > saved.last_end_seq && userStop(end)) this.stop(binding.engagement, id, end.seq, binding.token)
      else if (disposed || status === 'idle' || (end && end.seq > saved.last_end_seq)) {
        db.prepare("UPDATE task_attempt_runtime SET recovery_state='needs-review',reason=?,last_end_seq=?,updated_at=? WHERE attempt_id=? AND binding_token=?")
          .run(disposed ? 'executor-disposed' : 'turn-ended-result-unverified', end?.seq ?? saved.last_end_seq, new Date().toISOString(), id, binding.token)
      }
      if (disposed) binding.disposed = true
    }
  }
}

const runtimes = new WeakMap()
export function bindTaskRuntime(ctx, store) {
  let shared = runtimes.get(store)
  if (!shared) { shared = { runtime: new TaskRuntime(store), refs: 0 }; runtimes.set(store, shared) }
  ctx.effect(() => {
    const disposers = []
    shared.refs++
    if (typeof ctx.on === 'function') {
      const listen = (name, fn) => {
        const guarded = payload => {
          try { fn(payload) } catch (error) { ctx.logger?.warn?.('task-runtime: observation failed: %s', error?.message || 'unknown') }
        }
        try { disposers.push(ctx.on(name, guarded, { global: true })) } catch { /* Unavailable means unobserved, not idle. */ }
      }
      listen('agent/status', ({ agent, status }) => shared.runtime.observe(agent, status))
      listen('agent/disposed', ({ agent }) => shared.runtime.observe(agent, null, true))
    }
    return () => {
      for (const dispose of disposers) if (typeof dispose === 'function') dispose()
      if (--shared.refs === 0) {
        shared.runtime.bindings.clear()
        runtimes.delete(store)
      }
    }
  })
  return shared.runtime
}
