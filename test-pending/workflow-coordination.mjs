import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { writeSettings } from '../lib/redteam/settings.js'
import { collectAgentStatus } from '../lib/redteam/agent-status.js'

function temporary(t) {
  const parent = resolve(tmpdir())
  const root = mkdtempSync(join(parent, 'dsh-workflow-'))
  t.after(() => {
    const child = relative(parent, resolve(root))
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child))
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

async function fixture(t, overrides = {}) {
  const root = temporary(t)
  const anchor = join(root, 'package.json')
  writeFileSync(anchor, '{}')
  const pkg = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', exports: './index.js' }))
  writeFileSync(join(pkg, 'index.js'), 'export const defineTool = spec => spec\n')
  const definitions = new Map()
  const listeners = new Map()
  const cleanup = []
  const store = { root, listEngagements: () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], ...overrides }
  const ctx = {
    redteam: store,
    subagents: { listChildren: async () => [] },
    tools: { register: tool => definitions.set(tool.name, tool) },
    get(name) { return this[name] },
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name) },
    effect(fn) { cleanup.push(fn()) },
  }
  t.after(() => { for (const dispose of cleanup) dispose?.() })
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  let apply
  try { ({ apply } = await import('../lib/redteam/tools.js')) } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  await apply(ctx)
  const exec = { agent: { session: { id: randomUUID() } } }
  const call = async (name, args, context = exec) => JSON.parse(await definitions.get(name).execute(args, context))
  t.after(async () => {
    const status = await call('redteam_agent_slot', { action: 'status' })
    for (const row of status.reservations) await call('redteam_agent_slot', { action: 'release', key: row.key })
  })
  return { root, store, ctx, definitions, listeners, exec, call }
}

test('live registry publishes stable ids, deduplicates rows, and supports property fallback', async () => {
  const rows = [{ id: 'child', activity: 'running' }, { id: 'child', activity: 'running' }]
  const read = rows => collectAgentStatus({ get: () => undefined, subagents: { listChildren: async () => rows } }, { rootSessionId: 'root' })
  const live = await read(rows)
  assert.deepEqual(live.per_root[0].running_ids, ['child'])
  assert.equal(live.used, 1)
  const malformed = await read([null, { activity: 'running' }, 'bad-row'])
  assert.equal(malformed.available, false)
  assert.equal(malformed.unknown_children, 3)
  const missing = await collectAgentStatus({}, { rootSessionId: 'root' })
  assert.equal(missing.available, false)
  assert.equal(missing.free, null)
})

test('slot tool retries at capacity are idempotent and failed dispatch can be exactly released', async t => {
  const f = await fixture(t)
  writeSettings(f.root, { maxAgents: 1 })
  const first = await f.call('redteam_agent_slot', { action: 'acquire', key: 'task' })
  const repeat = await f.call('redteam_agent_slot', { action: 'acquire', key: 'task' })
  assert.equal(first.ok, true)
  assert.equal(first.reused, false)
  assert.equal(repeat.ok, true)
  assert.equal(repeat.reused, true)
  assert.equal(repeat.used, 1)
  assert.equal(repeat.reservations[0].at, first.reservations[0].at)
  assert.equal((await f.call('redteam_agent_slot', { action: 'acquire', key: 'second' })).ok, false)
  const dropped = await f.call('redteam_agent_slot', { action: 'release', key: 'task' })
  assert.equal(dropped.used, 0)
  assert.equal(dropped.free, 1)
  assert.equal(dropped.released, true)
  assert.deepEqual(dropped.reservations, [])
  assert.equal((await f.call('redteam_agent_slot', { action: 'release', key: 'task' })).released, false)
  assert.equal((await f.call('redteam_agent_slot', { action: 'typo' })).ok, false)
  assert.equal((await f.call('redteam_agent_slot', { action: 'acquire', key: ' ' })).ok, false)
})

test('concurrent keyed retries do not duplicate reservations or exceed the configured cap', async t => {
  const f = await fixture(t)
  const repeated = await Promise.all(Array.from({ length: 12 }, () => f.call('redteam_agent_slot', { action: 'acquire', key: 'retry' })))
  assert.equal(repeated.filter(row => row.ok).length, 12)
  assert.equal(repeated.filter(row => !row.reused).length, 1)
  const distinct = await Promise.all(Array.from({ length: 12 }, (_, i) => f.call('redteam_agent_slot', { action: 'acquire', key: `distinct-${i}` })))
  assert.equal(distinct.filter(row => row.ok).length, 2)
  const status = await f.call('redteam_agent_slot', { action: 'status' })
  assert.equal(status.used, 3)
  assert.equal(status.free, 0)
})

test('slot metadata updates after lifecycle events, and release does not invent capacity for running children', async t => {
  const f = await fixture(t)
  await f.call('redteam_agent_slot', { action: 'acquire', key: 'task' })
  f.listeners.get('subagent/start')({ id: 'child', runId: 'run', parentSessionId: f.exec.agent.session.id })
  f.ctx.subagents.listChildren = async () => [{ id: 'child', activity: 'running' }, { id: 'outside', activity: 'running' }]
  const full = await f.call('redteam_agent_slot', { action: 'acquire', key: 'waiting' })
  assert.equal(full.used, 3)
  assert.equal(full.free, 0)
  assert.equal(full.assigned, 1)
  assert.equal(full.pending, 1)
  const released = await f.call('redteam_agent_slot', { action: 'release', key: 'task' })
  assert.equal(released.used, 3)
  assert.equal(released.free, 0)
  f.listeners.get('subagent/end')({ id: 'child', runId: 'run', parentSessionId: f.exec.agent.session.id })
  const after = await f.call('redteam_agent_slot', { action: 'status' })
  assert.deepEqual(after.reservations.map(row => row.key), ['waiting'])
})

test('degraded-registry admission is explicitly unverified, not reported as known free', async t => {
  const f = await fixture(t)
  f.ctx.subagents = undefined
  const result = await f.call('redteam_agent_slot', { action: 'acquire', key: 'pending' })
  assert.equal(result.ok, true)
  assert.equal(result.free, null)
  assert.equal(result.capacity_verified, false)
  assert.equal(result.admission_basis, 'observed-lower-bound-and-reservations')
  assert.equal(result.free_upper_bound, 2)
})

test('query wrappers preserve offset and report the existing bounded page contract', async t => {
  const calls = []
  const page = { total: 6000, returned: 0, limit: 1000, offset: 2000, hasMore: true, nextOffset: 3000, items: [] }
  const f = await fixture(t, {
    listAssets: (id, args) => { calls.push({ id, args }); return { ...page, limit: 2000, nextOffset: 4000 } },
    listVulns: (id, args) => { calls.push({ id, args }); if (args.limit < 0) throw new Error('invalid limit'); return page },
    vulnStats: () => ({ total: 6000 }),
  })
  const reviewed = JSON.parse(readFileSync(new URL('../test/fixtures/tool-surface.json', import.meta.url), 'utf8'))
  assert.deepEqual([...f.definitions.keys()].sort(), reviewed)
  for (const name of ['redteam_asset_query', 'redteam_vuln_query']) {
    assert.equal(f.definitions.get(name).parameters.offset.type, 'number')
    const result = await f.call(name, { engagement: 'a', limit: 4000, offset: 2000 })
    assert.equal(calls.at(-1).id, 'a')
    assert.equal(calls.at(-1).args.limit, 200)
    assert.equal(calls.at(-1).args.offset, 2000)
    assert.equal(result.returned, 0)
    assert.equal(result.hasMore, false)
    assert.equal(result.offset, 2000)
    assert.equal(result.limit, 200)
    assert.equal(result.nextOffset, null)
  }
  await f.call('redteam_asset_query', { engagement: 'b' })
  assert.equal(calls.at(-1).args.limit, 50)
  const invalid = await f.call('redteam_vuln_query', { engagement: 'a', limit: -1 })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error_kind, 'bad_input')
})

test('read-only quality tool preserves explicit and parent-session engagement resolution', async t => {
  const seen = []
  const f = await fixture(t, { dataQuality: id => { seen.push(id); return { missing_evidence: 2 } } })
  const explicit = await f.call('redteam_data_quality', { engagement: 'b' })
  assert.deepEqual(explicit, { ok: true, engagement: 'b', quality: { missing_evidence: 2 } })
  await f.call('redteam_session_bind', { engagement: 'a' })
  const parent = f.exec.agent.session
  const child = { agent: { session: { id: randomUUID(), header: { parentSession: parent.id }, store: { get: () => parent } } } }
  const inherited = await f.call('redteam_data_quality', {}, child)
  assert.equal(inherited.engagement, 'a')
  const unbound = await f.call('redteam_data_quality', {}, { agent: { session: { id: randomUUID() } } })
  assert.equal(unbound.ok, false)
  assert.deepEqual(seen, ['b', 'a'])
})
