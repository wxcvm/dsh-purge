import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createPreview } from '../tools/superagent-preview/server.mjs'

async function listen(dataDir) {
  const app = createPreview({ dataDir })
  app.listen(0, '127.0.0.1')
  await once(app, 'listening')
  const base = 'http://127.0.0.1:' + app.address().port
  const post = (path, data, origin = base) => fetch(base + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  const get = path => fetch(base + path)
  const close = async () => { if (app.listening) { const closed = once(app, 'close'); app.close(); await closed } }
  return { post, get, close }
}

test('local document worker produces a real two-attempt review whose decisions survive restarting', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purge-doc-preview-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let server = await listen(dir)
  try {
    const data = { title: 'Review instructions', document: '# Guide\n\nA private sample paragraph 9182\n\n~~~markdown\n## Appendix\n~~~' }
    assert.equal((await server.post('/run', data, 'http://example.test')).status, 403)
    assert.equal((await server.post('/run', { ...data, document: '' })).status, 400)
    assert.equal((await (await server.get('/tasks')).json()).total, 0)
    const first = await (await server.post('/run', data)).json()
    assert.equal(first.item.status, 'ready')
    assert.ok(first.item.assignment.host_end_at, 'worker actually reached its exit callback')
    assert.match(first.item.assignment.summary, /一级标题：有；附录标题：缺少/)
    const feedback = { task_id: first.item.id, expected_revision: first.item.revision,
      reason: 'Add the appendix outside the code block', decision: 'changes' }
    const returned = await (await server.post('/review', feedback)).json()
    assert.equal(returned.item.status, 'waiting')
    await server.close()

    server = await listen(dir)
    const resume = await (await server.get('/task?id=' + first.item.id)).json()
    assert.equal(resume.status, 'waiting')
    assert.equal(resume.history[0].review_feedback, feedback.reason)
    const second = await (await server.post('/run', { task_id: first.item.id, document: '# Guide\n\n## 附录：参考\n\nExample' })).json()
    assert.equal(second.item.attempt, 2)
    assert.match(second.item.assignment.summary, /一级标题：有；附录标题：有/)
    assert.equal((await server.post('/review', feedback)).status, 409)
    assert.equal((await server.post('/review', { ...feedback, decision: 'accept', expected_revision: second.item.revision })).status, 200)
    await server.close()
    const db = new DatabaseSync(join(dir, 'tasks.sqlite'), { readOnly: true })
    try {
      assert.equal(db.prepare('SELECT status FROM agent_work_item WHERE id=?').get(first.item.id).status, 'done')
      assert.ok(db.prepare('SELECT summary FROM agent_work_assignment').all()
        .every(row => !row.summary.includes('A private sample paragraph 9182')))
    } finally { db.close() }
    server = await listen(dir)
    assert.equal((await (await server.get('/task?id=' + first.item.id)).json()).history.length, 2)
    assert.equal((await server.get('/../../package.json')).status, 404)
  } finally { await server.close() }
})