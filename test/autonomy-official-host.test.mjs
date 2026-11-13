import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('official registry runs persistent attempts, failure retrieval, dependencies and lifecycle cleanup together', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires a pinned official host fixture',
}, async t => {
  const req = createRequire(join(process.env.DSH_COMPAT_HOST_ROOT, 'package.json'))
  const load = name => import(pathToFileURL(req.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const nativeTools = await load('@deepseek-ai/dsh-tools')
  const prompt = await load('@deepseek-ai/dsh-system-prompt')
  const root = mkdtempSync(join(tmpdir(), 'purge-official-autonomy-'))
  const oldHome = process.env.DSH_HOME
  const host = new Context()
  const store = new RedteamStore(join(root, 'data'))
  store.failureKnowledgeOptions = { skills: () => [], artexStatus: () => ({ available: false, state: 'missing' }) }
  t.after(async () => {
    await host.fiber.dispose()
    store.close()
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}')
  symlinkSync(dirname(req.resolve('@deepseek-ai/dsh-tools/package.json')), join(root, 'node_modules', '@deepseek-ai', 'dsh-tools'), process.platform === 'win32' ? 'junction' : 'dir')
  process.env.DSH_HOME = root
  await host.plugin(prompt.default)
  await host.plugin(nativeTools.default)
  host.provide('redteam', store)
  const purge = await import('../lib/redteam/tools.js')
  const installed = host.plugin(purge)
  await installed
  const expected = JSON.parse(readFileSync(new URL('./fixtures/tool-surface.json', import.meta.url), 'utf8'))
  for (const name of expected) assert.equal(host.tools.get(name)?.name, name)
  const engagement = store.openEngagement('fixture', ['192.0.2.0/24']).id
  store.db(engagement).exec("INSERT INTO asset(id,segment_cidr,ip) VALUES(1,'192.0.2.0/24','192.0.2.1'),(2,'192.0.2.0/24','192.0.2.2')")
  const agent = { id: 'root', status: 'running', session: { id: 'root', events: [] } }
  const call = async (name, args) => JSON.parse(await host.tools.get(name).execute({ engagement, ...args }, { agent }))
  const dependency = await call('redteam_task_run', { action: 'dependencies', task_key: 'review:asset #2', requires: ['review:asset #1'], reason: 'wait for recorded source' })
  assert.equal(dependency.ok, true)
  assert.equal((await call('redteam_task_run', { action: 'start', task_key: 'review:asset #2' })).ok, false)
  const started = await call('redteam_task_run', { action: 'start', task_key: 'review:asset #1' })
  assert.equal(started.attempt.status, 'running')
  const failed = await call('redteam_task_run', { action: 'fail', attempt_id: started.attempt.id, failure_kind: 'transient', reason: 'ETIMEDOUT synthetic fixture' })
  assert.equal(failed.attempt.status, 'failed')
  assert.equal(failed.failure_knowledge.verification_scope, 'historical-reference')
  const retried = await call('redteam_task_run', { action: 'retry', task_key: 'review:asset #1' })
  assert.notEqual(retried.attempt.id, started.attempt.id)
  assert.equal((await call('redteam_http_evidence_add', { attempt_id: retried.attempt.id, asset_id: 1, request: 'request', response: 'response' })).ok, true)
  await call('redteam_task_run', { action: 'submit', attempt_id: retried.attempt.id })
  assert.equal((await call('redteam_task_run', { action: 'verify', attempt_id: retried.attempt.id })).attempt.status, 'completed')
  const dependent = await call('redteam_task_run', { action: 'start', task_key: 'review:asset #2' })
  assert.equal(dependent.attempt.status, 'running')
  agent.session.events.push({ type: 'turn/end', seq: 4, data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  agent.status = 'idle'
  await host.emit('agent/status', { agent, status: 'idle' })
  assert.equal((await call('redteam_task_run', { action: 'status', attempt_id: dependent.attempt.id })).attempt.status, 'cancelled')
  await installed.dispose()
  for (const name of expected) assert.equal(host.tools.get(name), undefined)
})
