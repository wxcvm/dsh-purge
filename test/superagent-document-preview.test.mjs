import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createPreview } from '../tools/superagent-preview/server.mjs'
import { AGENT_WORK_DDL, migrateAgentWork } from '../lib/redteam/agent-work-schema.js'
import { createWorkItem } from '../lib/redteam/agent-work-items.js'

function api(base) {
  const post = (path, data, origin = base) => fetch(base + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return { post, get: path => fetch(base + path) }
}

async function listen(dataDir, checkDocument, readEvidence) {
  const app = createPreview({ dataDir, checkDocument, readEvidence })
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

test('document preview pages across persisted tasks without hiding older work', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purge-doc-pages-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const db = new DatabaseSync(join(dir, 'tasks.sqlite'))
  try {
    db.exec(AGENT_WORK_DDL)
    migrateAgentWork(db)
    for (let index = 1; index <= 34; index++) {
      const result = createWorkItem(db, {
        task_key: 'preview-page-' + index, role: 'document-review', objective: 'Document task ' + index,
      })
      assert.equal(result.created, true)
    }
  } finally { db.close() }

  let server = await listen(dir)
  try {
    const first = await (await server.get('/tasks')).json()
    const second = await (await server.get('/tasks?offset=30')).json()
    assert.equal(first.total, 34)
    assert.equal(first.offset, 0)
    assert.equal(first.items.length, 30)
    assert.equal(first.hasMore, true)
    assert.equal(second.total, 34)
    assert.equal(second.offset, 30)
    assert.equal(second.items.length, 4)
    assert.equal(second.hasMore, false)
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 34)
    const oldest = second.items.at(-1)
    const detail = await (await server.get('/task?id=' + oldest.id)).json()
    assert.equal(detail.id, oldest.id)
    assert.equal(detail.objective, oldest.objective)
    for (const offset of ['-1', 'oops', '2.5']) {
      assert.equal((await server.get('/tasks?offset=' + offset)).status, 400)
    }
    const beyond = await (await server.get('/tasks?offset=60')).json()
    assert.equal(beyond.total, 34)
    assert.deepEqual(beyond.items, [])
    await server.close()
    server = await listen(dir)
    const again = await (await server.get('/tasks?offset=30')).json()
    assert.deepEqual(again.items.map(item => item.id), second.items.map(item => item.id),
      'a restart must not lose access to older tasks')
  } finally { await server.close() }
})

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


test('GitHub evidence stays on one attempt, survives reopening and is not added by a stale request', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purge-doc-github-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sha = 'a'.repeat(40)
  const sample = { sha, source: 'github-public-check-runs', state: 'pending', checks: [], marker: 'first' }
  let resolveRequest, signalStarted
  const started = new Promise(resolve => { signalStarted = resolve })
  let reads = 0
  const reader = async request => {
    assert.deepEqual(Object.keys(request), ['pr_url', 'issue_url', 'expected_sha'])
    assert.equal(request.expected_sha, sha)
    if (++reads === 1) return sample
    if (reads === 2) throw Error('simulated GitHub rate limit')
    return new Promise(resolve => { resolveRequest = resolve; signalStarted() })
  }
  let server = await listen(dir, undefined, reader)
  try {
    const created = await (await server.post('/run', { title: 'Review notes', document: '# Example' })).json()
    const id = created.item.id
    const first = await until(server, id, t => t.status === 'ready')
    const action = { task_id: id, expected_revision: first.revision, pr_url: 'https://github.com/owner/repo/pull/7',
      issue_url: 'https://github.com/owner/repo/issues/8', expected_sha: sha }
    assert.equal((await server.post('/github-evidence', { ...action, expected_revision: 0 })).status, 409)
    assert.equal(reads, 0, 'ignore stale requests before contacting GitHub')
    assert.equal((await server.post('/github-evidence', action)).status, 200)
    assert.deepEqual((await (await server.get('/task?id=' + id)).json()).history[0].github_evidence, sample)
    assert.equal((await server.post('/github-evidence', action)).status, 400)
    assert.deepEqual((await (await server.get('/task?id=' + id)).json()).history[0].github_evidence, sample)
    const stale = server.post('/github-evidence', action)
    await started
    assert.equal((await server.post('/review', { ...action, decision: 'changes', reason: 'Please add appendix' })).status, 200)
    resolveRequest({ ...sample, marker: 'should not overwrite' })
    assert.equal((await stale).status, 409)
    await server.close()
    server = await listen(dir)
    const reopened = await (await server.get('/task?id=' + id)).json()
    assert.equal(reopened.status, 'waiting')
    assert.deepEqual(reopened.history[0].github_evidence, sample)
    assert.equal((await server.post('/run', { task_id: id, document: '# Example\n## Appendix' })).status, 202)
    const second = await until(server, id, t => t.status === 'ready')
    assert.equal(second.history[0].github_evidence, undefined)
    assert.deepEqual(second.history[1].github_evidence, sample)
    assert.equal((await server.post('/review', { task_id: id, expected_revision: second.revision, decision: 'accept',
      reason: 'Accepted without requiring external CI' })).status, 200)
  } finally { resolveRequest?.(sample); await server.close() }
})


test('approved work exports one deterministic Markdown handoff and comparisons never write', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'purge-doc-handoff-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const head = 'b'.repeat(40)
  const receipt = { sha: head, source: 'github-public-check-runs', state: 'observed-success', verified_count: 2,
    checked_at: '2026-11-22T06:00:00Z', checks: [{ name: 'Sensitive check name not to export' }],
    pr: { url: 'https://github.com/example/docs/pull/4', number: 4 },
    issue: { url: 'https://github.com/example/docs/issues/7', number: 7 },
    commit_url: 'https://github.com/example/docs/commit/' + head }
  let server = await listen(dir, undefined, async () => receipt)
  try {
    const created = await (await server.post('/run', { title: 'Do not export the internal title', document: '# Raw document not for export\n## Appendix' })).json()
    const id = created.item.id
    const ready = await until(server, id, t => t.status === 'ready')
    assert.equal((await server.get('/handoff?id=' + id)).status, 404)
    assert.equal((await server.post('/github-evidence', { task_id: id, expected_revision: ready.revision })).status, 200)
    assert.equal((await server.post('/review', { task_id: id, expected_revision: ready.revision,
      decision: 'accept', reason: 'Unexported internal approval comment' })).status, 200)
    const downloaded = await server.get('/handoff?id=' + id)
    assert.equal(downloaded.status, 200)
    assert.match(downloaded.headers.get('content-type'), /^text\/markdown/)
    const text = await downloaded.text()
    const hash = createHash('sha256').update(text).digest('hex')
    assert.equal(downloaded.headers.get('x-document-sha256'), hash)
    assert.ok(downloaded.headers.get('content-disposition').includes(hash.slice(0, 16)))
    assert.match(text, /一级标题：有/)
    assert.ok(text.includes(head))
    assert.doesNotMatch(text, /Raw document|internal title|approval comment|Sensitive check name|preview-v1:/)
    await server.close()
    server = await listen(dir)
    const accepted = await (await server.get('/task?id=' + id)).json()
    assert.equal(accepted.document_handoff.sha256, hash)
    assert.equal(await (await server.get('/handoff?id=' + id)).text(), text)
    const verify = markdown => server.post('/handoff/verify', { task_id: id, markdown }).then(r => r.json())
    assert.deepEqual(await verify('\uFEFF' + text.replaceAll('\n', '\r\n')),
      { matches: true, expected: hash, received: hash, writes: false })
    const altered = await verify(text.replace('附录标题：有', '附录标题：缺少'))
    assert.equal(altered.matches, false)
    assert.notEqual(altered.received, hash)
    assert.equal(altered.writes, false)
    assert.equal(await (await server.get('/handoff?id=' + id)).text(), text)
  } finally { await server.close() }
})
