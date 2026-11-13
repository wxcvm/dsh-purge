/** Persistent task/attempt tracking; no tool execution or runtime liveness inference. */
import { createHash, randomUUID } from 'node:crypto'
import { taskProgressTarget } from './task-progress.js'

const CRITERION = 'http-evidence-recorded'
const now = () => new Date().toISOString()
const evidenceDigest = row => createHash('sha256').update(JSON.stringify([
  row.id, row.asset_id, row.vuln_id, row.method, row.url, row.status,
  row.request, row.response, row.note, row.label,
])).digest('hex')

export class TaskRuns {
  constructor(store, engagement, owner = null) {
    this.store = store
    this.engagement = String(engagement)
    this.db = store.db(engagement)
    this.owner = owner
  }

  transaction(fn) {
    this.db.exec('SAVEPOINT purge_task_run')
    try {
      const result = fn()
      this.db.exec('RELEASE purge_task_run')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK TO purge_task_run; RELEASE purge_task_run')
      throw error
    }
  }

  requireOwner() {
    if (typeof this.owner !== 'string' || !this.owner.trim()) throw new Error('task attempt requires a host root session')
  }

  task(taskKey) {
    return this.db.prepare('SELECT * FROM task_run WHERE task_key = ?').get(taskKey)
  }

  attempt(attemptId, writable = false) {
    if (typeof attemptId !== 'string' || !attemptId) throw new TypeError('attempt_id is required')
    const row = this.db.prepare(`SELECT a.*, t.task_key, t.criterion, t.current_attempt_id
      FROM task_attempt a JOIN task_run t ON t.id = a.task_id WHERE a.id = ?`).get(attemptId)
    if (!row) throw new Error('attempt not found in this engagement')
    if (writable) {
      this.requireOwner()
      if (row.owner !== this.owner) throw new Error('attempt belongs to a different root session')
      if (row.id !== row.current_attempt_id) throw new Error('attempt is no longer current')
    }
    return row
  }

  belongs(row, taskKey) {
    const target = taskProgressTarget(taskKey)
    if (!target) return false
    const vuln = row.vuln_id == null ? null : this.db.prepare('SELECT asset_id FROM vuln WHERE id = ?').get(row.vuln_id)
    if (row.vuln_id != null && !vuln) return false
    if (row.asset_id != null && (!this.db.prepare('SELECT id FROM asset WHERE id = ?').get(row.asset_id)
      || (vuln && vuln.asset_id !== row.asset_id))) return false
    if (target.kind === 'vuln') return row.vuln_id === target.id
    if (row.asset_id === target.id) return true
    return vuln?.asset_id === target.id
  }

  inspect(row) {
    const links = this.db.prepare('SELECT evidence_id, digest FROM task_attempt_evidence WHERE attempt_id = ? ORDER BY evidence_id').all(row.id)
    const issues = []
    if (!links.length) issues.push('no-attributed-evidence')
    const target = taskProgressTarget(row.task_key)
    if (!this.db.prepare(`SELECT id FROM ${target.kind} WHERE id = ?`).get(target.id)) issues.push('target-missing')
    for (const link of links) {
      const evidence = this.db.prepare('SELECT * FROM http_evidence WHERE id = ?').get(link.evidence_id)
      if (!evidence) issues.push('evidence-missing:' + link.evidence_id)
      else if (!this.belongs(evidence, row.task_key)) issues.push('evidence-target-mismatch:' + link.evidence_id)
      else if (evidenceDigest(evidence) !== link.digest) issues.push('evidence-changed:' + link.evidence_id)
      else if (!String(evidence.request || '').trim() || !String(evidence.response || '').trim()) issues.push('evidence-body-missing:' + link.evidence_id)
    }
    return { passed: issues.length === 0, scope: 'record-integrity', criterion: row.criterion,
      evidence_ids: links.map(link => link.evidence_id), issues,
      note: '仅验证本次尝试写入的报文记录归属、完整性及内容未变；不证明流量真实、漏洞有效或已计分。' }
  }

  status({ task_key: taskKey, attempt_id: attemptId } = {}) {
    return this.transaction(() => this.readStatus(taskKey, attemptId))
  }

  readStatus(taskKey, attemptId) {
    if (!attemptId && !taskKey) throw new TypeError('task_key or attempt_id is required')
    const task = !attemptId && this.task(taskKey)
    if (!attemptId && !task) return { task: null, runtime_activity: 'not-observed' }
    const row = this.attempt(attemptId || task.current_attempt_id)
    if (taskKey && row.task_key !== taskKey) throw new Error('task_key does not match attempt')
    return { task: { id: row.task_id, task_key: row.task_key, criterion: row.criterion },
      attempt: { id: row.id, status: row.status, owner: row.owner,
        current: row.id === row.current_attempt_id, started_at: row.started_at,
        finished_at: row.finished_at },
      assessment: this.inspect(row), runtime_activity: 'not-observed' }
  }

  start(taskKey, retry = false) {
    this.requireOwner()
    const target = taskProgressTarget(taskKey)
    if (!target) throw new TypeError('task_key must identify an asset or vuln task')
    return this.transaction(() => {
      if (!this.db.prepare(`SELECT id FROM ${target.kind} WHERE id = ?`).get(target.id)) throw new Error('task target not found')
      let task = this.task(taskKey)
      if (task) {
        const previous = this.attempt(task.current_attempt_id)
        if (!retry) {
          if (previous.owner !== this.owner) throw new Error('task belongs to a different root session')
          return this.status({ task_key: taskKey })
        }
        if (!['failed', 'cancelled'].includes(previous.status)) throw new Error('retry requires a failed or cancelled attempt')
        // A new root session may explicitly take over a terminated attempt, never a running one.
      } else {
        task = { id: randomUUID() }
        this.db.prepare('INSERT INTO task_run(id,task_key,criterion,created_at) VALUES(?,?,?,?)')
          .run(task.id, taskKey, CRITERION, now())
      }
      const id = randomUUID()
      this.db.prepare('INSERT INTO task_attempt(id,task_id,owner,status,started_at) VALUES(?,?,?,?,?)')
        .run(id, task.id, this.owner, 'running', now())
      this.db.prepare('UPDATE task_run SET current_attempt_id = ? WHERE id = ?').run(id, task.id)
      return this.status({ attempt_id: id })
    })
  }

  addEvidence(attemptId, args) {
    return this.transaction(() => {
      const attempt = this.attempt(attemptId, true)
      if (attempt.status !== 'running') throw new Error('only a running attempt accepts evidence')
      if (!this.belongs(args, attempt.task_key)) throw new Error('evidence does not belong to the attempt target')
      if (!String(args.request || '').trim() || !String(args.response || '').trim()) throw new Error('attempt evidence requires request and response')
      const result = this.store.addHttpEvidence(this.engagement, args)
      const row = this.db.prepare('SELECT * FROM http_evidence WHERE id = ?').get(result.id)
      this.db.prepare('INSERT INTO task_attempt_evidence(attempt_id,evidence_id,digest) VALUES(?,?,?)')
        .run(attemptId, result.id, evidenceDigest(row))
      return { ...result, attempt_id: attemptId }
    })
  }

  transition(attemptId, action) {
    if (!['submit', 'verify', 'cancel'].includes(action)) throw new TypeError('invalid task attempt action')
    return this.transaction(() => {
      const row = this.attempt(attemptId, true)
      if (action === 'cancel') {
        if (row.status === 'cancelled') return this.status({ attempt_id: attemptId })
        if (!['running', 'verifying'].includes(row.status)) throw new Error('only an active attempt can be cancelled')
        this.db.prepare("UPDATE task_attempt SET status='cancelled',finished_at=? WHERE id=?").run(now(), attemptId)
      } else if (action === 'submit') {
        if (row.status === 'verifying') return this.status({ attempt_id: attemptId })
        if (row.status !== 'running') throw new Error('only a running attempt can be submitted')
        this.db.prepare("UPDATE task_attempt SET status='verifying' WHERE id=?").run(attemptId)
      } else {
        if (row.status === 'completed' || row.status === 'failed') return this.status({ attempt_id: attemptId })
        if (row.status !== 'verifying') throw new Error('verify requires a submitted attempt')
        const assessment = this.inspect(row)
        this.db.prepare('UPDATE task_attempt SET status=?,finished_at=?,verification=? WHERE id=?')
          .run(assessment.passed ? 'completed' : 'failed', now(), JSON.stringify(assessment), attemptId)
      }
      return this.status({ attempt_id: attemptId })
    })
  }
}
