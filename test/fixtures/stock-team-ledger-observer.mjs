// Optional observer used only by the stock Harness's ordinary, keyless Team
// fixture. It never loads the Purge plugin or registers any tools.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { AGENT_WORK_DDL } from '../../lib/redteam/agent-work-schema.js'
import { createWorkItem, assignWorkItem, observeWorkItemEnd } from '../../lib/redteam/agent-work-items.js'
import { captureAgentEndReport } from '../../lib/redteam/agent-attention.js'
import { createReservations } from '../../lib/redteam/agent-reservations.js'
import { bindSession } from '../../lib/redteam/session-bindings.js'

export const name = 'purge-stock-team-evidence-fixture'

export function apply(ctx) {
  const db = new DatabaseSync(process.env.PURGE_STOCK_TEAM_LEDGER)
  db.exec(AGENT_WORK_DDL)
  const engagement = 'fixture-document-work'
  const reservations = createReservations()
  const store = {
    observeWorkItemEnd(id, event) {
      assert.equal(id, engagement)
      return observeWorkItemEnd(db, event)
    },
    recordAgentReport() {
      assert.fail('the ordinary upstream fixture must not synthesize an attention report')
    },
  }
  let root
  let index = 0
  ctx.effect(() => () => db.close())
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== undefined) return
    root = String(agent.session.id)
    bindSession(store, { agent }, engagement)
  }, { global: true })
  ctx.on('subagent/start', event => {
    if (String(event.parentSessionId) !== root) return
    assert.ok(event.id && event.runId, 'official start must provide the exact child and activation IDs')
    reservations.start(event)
    const session_id = String(event.id)
    const run_id = String(event.runId)
    // Fixture only: stand in for a human binding an already observed run.
    // The negative control has the same session but a different run.
    for (const [kind, id] of [['observed', run_id], ['other-run', 'unrelated-' + index]]) {
      const { item } = createWorkItem(db, { task_key: kind + '-' + index,
        role: 'review', objective: 'Ordinary stock Team fixture' })
      assignWorkItem(db, { task_id: item.id, session_id, run_id: id })
    }
    index++
  }, { global: true })
  ctx.on('subagent/end', event => {
    // Exercise the production observer, not a local copy of its logic.
    captureAgentEndReport(store, reservations, event, error => { throw error })
  }, { global: true })
}