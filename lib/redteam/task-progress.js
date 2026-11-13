/** Task-local record fingerprints. Read-only; a change is not proof of task success. */
import { createHash } from 'node:crypto'

export function taskProgressTarget(taskKey) {
  const match = /^(?:[^:\r\n]{1,100}:)?(asset|vuln) #([1-9]\d*)$/.exec(String(taskKey || ''))
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null
  return { kind: match[1], id: Number(match[2]) }
}

const metadata = new Set(['first_seen', 'last_seen', 'discovered_at', 'found_at',
  'test_updated_at', 'assessed_at', 'recorded_at', 'captured_at', 'created_at', 'updated_at',
  'found_by_agent', 'recorded_by', 'captured_by', 'assessed_by', 'test_updated_by'])

function recordText(row) {
  return JSON.stringify(Object.fromEntries(Object.keys(row).sort()
    .filter(key => !metadata.has(key)).map(key => [key, row[key]])))
}

export function taskProgressSnapshot(store, engagement, taskKey) {
  const target = taskProgressTarget(taskKey)
  if (!target) return null
  const db = store.db(engagement)
  const hash = createHash('sha256')
  const counts = {}
  // One coherent SQLite view, including when called inside an existing transaction.
  db.exec('SAVEPOINT purge_task_progress')
  try {
    const entity = db.prepare(`SELECT * FROM ${target.kind} WHERE id = ?`).get(target.id)
    hash.update(recordText({ engagement: String(engagement), task_key: taskKey }))
    function collect(label, sql, args) {
      hash.update('\n' + label + '\n')
      counts[label] = 0
      for (const row of db.prepare(sql).iterate(...args)) {
        hash.update(recordText(row) + '\n')
        counts[label]++
      }
    }
    if (entity) {
      hash.update(recordText(entity))
      if (target.kind === 'asset') {
        collect('ports', 'SELECT * FROM port WHERE asset_id = ? ORDER BY id', [target.id])
        collect('services', 'SELECT s.* FROM service s JOIN port p ON p.id = s.port_id WHERE p.asset_id = ? ORDER BY s.id', [target.id])
        collect('fingerprints', 'SELECT * FROM fingerprint WHERE asset_id = ? ORDER BY id', [target.id])
        collect('findings', 'SELECT * FROM vuln WHERE asset_id = ? ORDER BY id', [target.id])
        collect('evidence', 'SELECT * FROM http_evidence WHERE asset_id = ? OR vuln_id IN (SELECT id FROM vuln WHERE asset_id = ?) ORDER BY id', [target.id, target.id])
      } else {
        collect('evidence', 'SELECT * FROM http_evidence WHERE vuln_id = ? ORDER BY id', [target.id])
      }
    }
    db.exec('RELEASE purge_task_progress')
    return { version: 1, engagement_id: String(engagement), task_key: taskKey,
      target: target.kind + ' #' + target.id, exists: !!entity,
      digest: hash.digest('hex'), counts }
  } catch (error) {
    db.exec('ROLLBACK TO purge_task_progress; RELEASE purge_task_progress')
    throw error
  }
}

export function compareTaskProgress(before, after) {
  for (const snapshot of [before, after]) {
    const target = taskProgressTarget(snapshot?.task_key)
    if (!snapshot || snapshot.version !== 1 || typeof snapshot.exists !== 'boolean'
      || typeof snapshot.engagement_id !== 'string' || !snapshot.engagement_id
      || typeof snapshot.task_key !== 'string' || !target
      || snapshot.target !== target.kind + ' #' + target.id
      || !/^[a-f0-9]{64}$/.test(snapshot.digest) || !snapshot.counts || Array.isArray(snapshot.counts)
      || !Object.values(snapshot.counts).every(n => Number.isSafeInteger(n) && n >= 0)) {
      throw new TypeError('invalid task progress snapshot')
    }
  }
  if (before.engagement_id !== after.engagement_id || before.task_key !== after.task_key
    || before.target !== after.target) throw new TypeError('task progress snapshot scope mismatch')
  const removed = Object.keys(before.counts).some(key => (after.counts[key] || 0) < before.counts[key])
  return { status: !after.exists ? 'missing' : removed ? 'records-removed'
    : before.digest === after.digest ? 'no-change' : 'records-changed',
  verification: 'not-performed',
  note: '仅核对当前目标及关联记录变化；不是任务完成、漏洞有效或本次执行者贡献的证明。' }
}
