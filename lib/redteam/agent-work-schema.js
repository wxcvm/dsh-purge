// Shared task-ledger schema; this module does not mount a host or register tools.
export const AGENT_WORK_DDL = `
/* Durable SuperAgent work ledger, independent of agent_attention / native Team.
   A stored 'running' assignment does not prove the Harness worker is still active. */
CREATE TABLE IF NOT EXISTS agent_work_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','waiting','ready','blocked','failed','interrupted','done','dropped')),
  attempt INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  last_outcome TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_work_assignment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES agent_work_item(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('running','waiting','ready','blocked','failed','interrupted')),
  summary TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  settlement_basis TEXT,
  host_end_at TEXT,
  host_stop_reason TEXT,
  review_feedback TEXT,
  review_returned_at TEXT,
  UNIQUE(task_id, attempt),
  UNIQUE(session_id, run_id)
);
CREATE INDEX IF NOT EXISTS ix_agent_work_item_status ON agent_work_item(status, updated_at);
CREATE INDEX IF NOT EXISTS ix_agent_work_assignment_task ON agent_work_assignment(task_id, attempt DESC);
`

export function migrateAgentWork(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(agent_work_assignment)').all().map(row => row.name))
  for (const name of ['host_end_at', 'host_stop_reason', 'review_feedback', 'review_returned_at', 'settlement_basis']) {
    if (!existing.has(name)) db.exec('ALTER TABLE agent_work_assignment ADD COLUMN ' + name + ' TEXT')
  }
}
