import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createPreview } from '../tools/superagent-preview/server.mjs'

function api(base) {
  const post = (path, data, origin = base) => fetch(base + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return { post, get: path => fetch(base + path) }
}

async function listen(dataDir, checkDocument) {
  const app = createPreview({ dataDir, checkDocument })
  app.listen(0, '127.0.0.1')
  await once(app, 'listening')
  const base = 'http://127.0.0.1:' + app.address().port
  const close = async () => { if (app.listening) { const closed = once(app, 'close'); app.close(); await closed } }
  return { ...api(base), close }
}

async function until(server, id, condition) {
  for (let i = 0; i < 200; i++) {
    const task = await (await server.get('/task?id=' + id)).json()
    if (condition(task)) return task
    await delay(25)
  }
  assert.fail('document task did not reach the expected state')
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
    const launched = await server.post('/run', data)
    assert.equal(launched.status, 202)
    const registered = await launched.json()
    assert.equal(registered.item.status, 'running')
    const first = { item: await until(server, registered.item.id, t => t.status === 'ready') }
    assert.ok(first.item.assignment.host_end_at, 'worker actually reached its exit callback')
    assert.match(first.item.assignment.summary, /一级标题：有；附录标题：缺少/)
    const workers = [...first.item.assignment.summary.matchAll(/worker #(\d+)/g)].map(m => m[1])
    assert.equal(workers.length, 2)
    assert.notEqual(workers[0], workers[1], 'checks run in distinct real workers')
    const feedback = { task_id: first.item.id, expected_revision: first.item.revision,
      reason: 'Add the appendix outside the code block', decision: 'changes' }
    const returned = await (await server.post('/review', feedback)).json()
    assert.equal(returned.item.status, 'waiting')
    await server.close()

    server = await listen(dir)
    const resume = await (await server.get('/task?id=' + first.item.id)).json()
    assert.equal(resume.status, 'waiting')
    assert.equal(resume.history[0].review_feedback, feedback.reason)
    const next = await server.post('/run', { task_id: first.item.id, document: '# Guide\n\n## 附录：参考\n\nExample' })
    assert.equal(next.status, 202)
    const second = { item: await until(server, first.item.id, t => t.status === 'ready') }
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

test('summary waits for both fixed checks; a failed prerequisite cannot become ready', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purge-doc-dependency-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const deferred = new Map()
  const server = await listen(dir, id => new Promise((resolve, reject) => deferred.set(id, { resolve, reject })))
  try {
    const start = await server.post('/run', { title: 'Dependency evidence', document: '# Example' })
    assert.equal(start.status, 202)
    const { item: { id, revision } } = await start.json()
    const executing = await until(server, id, t => t.preview_steps?.length === 3)
    assert.deepEqual(executing.preview_steps.map(({ status }) => status), ['running', 'running', 'waiting'])
    assert.equal((await server.post('/run', { title: 'Other document', document: '# Other' })).status, 400)
    assert.equal((await server.post('/review', { task_id: id, expected_revision: revision, decision: 'accept', reason: 'too early' })).status, 400)

    deferred.get('heading').resolve({ found: true, threadId: 1, ms: 1 })
    const partial = await until(server, id, t => t.preview_steps?.[0].status === 'done')
    assert.deepEqual(partial.preview_steps.map(({ status }) => status), ['done', 'running', 'waiting'])
    assert.equal(partial.assignment.finished_at, null)
    assert.equal(partial.assignment.host_end_at, null)
    deferred.get('appendix').reject(new Error('test failure'))
    const failed = await until(server, id, t => t.status === 'failed')
    assert.match(failed.assignment.summary, /未生成验收报告/)
    assert.equal(failed.assignment.host_stop_reason, 'error')
  } finally {
    for (const d of deferred.values()) d.resolve({ found: true, threadId: 1, ms: 1 })
    await server.close()
  }
})


test('interrupted preview runs are recovered only after the owning process exits and the operator acts', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purge-doc-recovery-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const child = fork(fileURLToPath(new URL('./fixtures/superagent-preview-pending.mjs', import.meta.url)), [dir],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const exited = once(child, 'exit')
  let reader
  try {
    const { port } = await Promise.race([
      once(child, 'message').then(([value]) => value),
      exited.then(() => { throw Error('preview owner exited before it could accept a task') }),
    ])
    const owner = api('http://127.0.0.1:' + port)
    const launch = await owner.post('/run', { title: 'Review release notes', document: '# Document' })
    assert.equal(launch.status, 202)
    const { item } = await launch.json()
    const { id, revision, assignment } = item
    const action = { task_id: id, expected_revision: revision, run_id: assignment.run_id,
      reason: 'Preview process stopped before returning a result' }
    const observed = await (await owner.get('/task?id=' + id)).json()
    assert.deepEqual(observed.recovery, { state: 'observed', can_mark: false })
    assert.equal((await owner.post('/interrupt', action)).status, 409)

    reader = await listen(dir)
    const unverified = await (await reader.get('/task?id=' + id)).json()
    assert.deepEqual(unverified.recovery, { state: 'owner-unverified', can_mark: false })
    assert.equal((await reader.post('/interrupt', action)).status, 409)
    assert.equal(child.kill('SIGKILL'), true, 'stop only this test process')
    await exited
    const orphan = await until(reader, id, t => t.recovery?.state === 'owner-exited')
    assert.equal(orphan.status, 'running', 'reading does not change state or dispatch')
    assert.equal(orphan.attempt, 1)
    assert.equal(orphan.assignment.host_end_at, null)
    assert.equal((await reader.post('/interrupt', { ...action, run_id: 'wrong-run' })).status, 409)
    assert.equal((await reader.post('/interrupt', { ...action, expected_revision: revision - 1 })).status, 409)

    const recorded = await (await reader.post('/interrupt', action)).json()
    assert.equal(recorded.recorded, true)
    assert.equal(recorded.item.status, 'interrupted')
    assert.equal(recorded.item.attempt, 1)
    assert.equal(recorded.item.assignment.host_end_at, null, 'manual interruption is not an exact worker end')
    assert.equal((await reader.post('/interrupt', action)).status, 409)

    const retry = await reader.post('/run', { task_id: id, document: '# Document\n## Appendix' })
    assert.equal(retry.status, 202, 'a replacement only starts after a separate explicit submission')
    const completed = await until(reader, id, t => t.status === 'ready')
    assert.deepEqual(completed.history.map(run => run.status), ['ready', 'interrupted'])
    assert.equal(completed.history[1].run_id, assignment.run_id)
    assert.equal(completed.history[1].summary, action.reason)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
    await reader?.close()
  }
})
