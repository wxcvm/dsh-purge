import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { readSettings, settingsPathOf, writeSettings } from '../lib/redteam/settings.js'
import { apply, liveRunningChildren, reservationStatus, summarizeChildActivity } from '../lib/redteam/tools.js'
import { addReservation, associateChildReservation, dropReservation, releaseChildReservation, summarizeReservations } from '../lib/redteam/reservation-state.js'

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

function verified(ids = []) {
  return { available: true, running: ids.length, running_ids: ids, unknown_children: 0, running_labels: ids }
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
  await apply(ctx, { hostPackageFiles: [anchor] })
  const exec = { agent: { session: { id: randomUUID() } } }
  const call = async (name, args, context = exec) => JSON.parse(await definitions.get(name).execute(args, context))
  t.after(async () => {
    const status = reservationStatus(exec.agent.session.id, verified(), 3)
    for (const row of status.reservations) await call('redteam_agent_slot', { action: 'release', key: row.key })
  })
  return { root, store, ctx, definitions, listeners, exec, call }
}

test('atomic settings merge preserves all unrelated JSON values and cleans temporary files', t => {
  const root = temporary(t)
  const original = JSON.parse('{"nested":{"enabled":false,"values":[1,null,"x"]},"__proto__":{"x":1},"maxAgents":3}')
  writeFileSync(settingsPathOf(root), JSON.stringify(original))
  const next = writeSettings(root, { maxAgents: 9 })
  assert.deepEqual(next, { ...original, maxAgents: 9 })
  assert.deepEqual(readSettings(root), next)
  assert.equal(Object.getPrototypeOf(next), Object.prototype)
  assert.deepEqual(readdirSync(root), ['settings.json'])
})

test('writes reject malformed, array, null and scalar existing settings without changing bytes', t => {
  const root = temporary(t)
  for (const raw of ['{broken', '[]', '[{"maxAgents":8}]', 'null', '42', '"string"']) {
    writeFileSync(settingsPathOf(root), raw)
    assert.deepEqual(readSettings(root), {})
    assert.throws(() => writeSettings(root, { maxAgents: 8 }))
    assert.equal(readFileSync(settingsPathOf(root), 'utf8'), raw)
    assert.deepEqual(readdirSync(root), ['settings.json'])
  }
})

test('serialization errors and competing writer lock never clobber settings or lock ownership', t => {
  const root = temporary(t)
  writeSettings(root, { custom: 'keep' })
  const before = readFileSync(settingsPathOf(root), 'utf8')
  assert.throws(() => writeSettings(root, []), /expected an object/)
  assert.throws(() => writeSettings(root, { invalid: 1n }), /BigInt/)
  assert.equal(readFileSync(settingsPathOf(root), 'utf8'), before)
  assert.deepEqual(readdirSync(root), ['settings.json'])
  writeFileSync(settingsPathOf(root) + '.lock', 'another owner')
  assert.throws(() => writeSettings(root, { maxAgents: 10 }), { code: 'EEXIST' })
  assert.equal(readFileSync(settingsPathOf(root) + '.lock', 'utf8'), 'another owner')
  assert.equal(readFileSync(settingsPathOf(root), 'utf8'), before)
})

test('settings refuses a directory as the existing document and cleans its own lock', t => {
  const root = temporary(t)
  mkdirSync(settingsPathOf(root))
  assert.throws(() => writeSettings(root, { maxAgents: 8 }), /regular file/)
  assert.equal(existsSync(settingsPathOf(root) + '.lock'), false)
})

test('keyed reservation acquisition preserves original age and no active owner is evicted', () => {
  const held = new Map()
  const assignments = new Map()
  assert.equal(addReservation(held, 'owner', 'same', 1), true)
  assert.equal(addReservation(held, 'owner', 'same', 1000), false)
  assert.equal(held.get('owner').get('same'), 1)
  for (let i = 0; i < 600; i++) addReservation(held, `owner-${i}`, 'same', i)
  assert.equal(held.size, 601)
  assert.equal(dropReservation(held, assignments, 'owner', 'same'), true)
  assert.equal(dropReservation(held, assignments, 'owner', 'same'), false)
  assert.equal(held.has('owner'), false)
  assert.equal(held.get('owner-599').has('same'), true)
})

test('union accounting includes disjoint live and pending reservations without double counting assigned live children', () => {
  const held = new Map([['root', new Map([['first', 1], ['pending', 2]])]])
  const assignments = new Map()
  associateChildReservation(held, assignments, 'root', { id: 'child', runId: 'run' })
  const status = summarizeReservations(held, assignments, 'root', verified(['child', 'unreserved']), 4, 100)
  assert.equal(status.used, 3)
  assert.equal(status.free, 1)
  assert.equal(status.pending, 1)
  assert.equal(status.assigned, 1)
  assert.equal(status.available, true)
  assert.equal(status.reservation_scope, 'process-local')
  assert.deepEqual(status.reservations[0], { key: 'first', at: 1, age_ms: 99, state: 'assigned', child_id: 'child', run_id: 'run' })
  dropReservation(held, assignments, 'root', 'first')
  assert.equal(assignments.size, 0)
  assert.equal(summarizeReservations(held, assignments, 'root', verified(['child', 'unreserved']), 4).used, 3)
  assert.equal(releaseChildReservation(held, assignments, { id: 'child', runId: 'run' }), false)
})

test('unknown activity and missing identities never advertise verified free capacity', () => {
  const held = new Map([['root', new Map([['pending', 1]])]])
  const status = summarizeReservations(held, new Map(), 'root', { ...verified(['known']), available: false, unknown_children: 2 }, 3)
  assert.equal(status.used, 2)
  assert.equal(status.free, null)
  assert.equal(status.free_upper_bound, 1)
  assert.equal(status.used_is_lower_bound, true)
  assert.equal(status.free_is_upper_bound, true)
  assert.equal(status.unknown_children, 2)
  const noIds = summarizeReservations(held, new Map(), 'root', { available: true, running: 2 }, 3)
  assert.equal(noIds.available, false)
  assert.equal(noIds.free, null)
  for (const cap of [0, -1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => summarizeReservations(held, new Map(), 'root', verified(), cap), /positive safe integer/)
  }
})

test('same child restart reuses its assignment and delayed old end cannot free the new run', () => {
  const held = new Map([['root', new Map([['first', 1], ['next', 2]])], ['other', new Map([['same', 0]])]])
  const assignments = new Map()
  associateChildReservation(held, assignments, 'root', { id: 'child', runId: 'old' })
  associateChildReservation(held, assignments, 'root', { id: 'child', runId: 'new' })
  assert.equal(assignments.get('child').key, 'first')
  assert.equal(associateChildReservation(held, assignments, 'other', { id: 'child', runId: 'new' }), false)
  assert.equal(releaseChildReservation(held, assignments, { id: 'child', runId: 'old' }), false)
  assert.equal(dropReservation(held, assignments, 'root'), true)
  assert.equal(held.get('root').has('first'), true)
  assert.equal(dropReservation(held, assignments, 'root'), false)
  assert.equal(releaseChildReservation(held, assignments, { id: 'child', runId: 'new' }), true)
  assert.equal(held.has('root'), false)
})

test('stale assignment cleanup and delayed run events cannot release a newly reused key', () => {
  const held = new Map()
  const assignments = new Map([['child', { rootId: 'root', key: 'child', runId: 'old' }]])
  assert.equal(dropReservation(held, assignments, 'root', 'child'), false)
  assert.equal(assignments.size, 0)
  addReservation(held, 'root', 'child', 1)
  assert.equal(releaseChildReservation(held, assignments, { id: 'child', runId: 'old' }), false)
  assert.equal(held.get('root').has('child'), true)
})

test('live registry publishes stable ids, deduplicates rows, and supports property fallback', async () => {
  const rows = [{ id: 'child', activity: 'running' }, { id: 'child', activity: 'running' }]
  assert.deepEqual(summarizeChildActivity(rows).running_ids, ['child'])
  assert.equal(summarizeChildActivity(rows).running, 1)
  const malformed = summarizeChildActivity([null, { activity: 'running' }, 'bad-row'])
  assert.equal(malformed.available, false)
  assert.equal(malformed.unknown_children, 3)
  const live = await liveRunningChildren({ get: () => undefined, subagents: { listChildren: async () => rows } }, 'root')
  assert.deepEqual(live.running_ids, ['child'])
  const missing = await liveRunningChildren({}, 'root')
  assert.deepEqual(missing.running_ids, [])
  assert.equal(missing.available, false)
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
  f.listeners.get('subagent/start')({ id: 'child', runId: 'run' }, { session: f.exec.agent.session })
  f.ctx.subagents.listChildren = async () => [{ id: 'child', activity: 'running' }, { id: 'outside', activity: 'running' }]
  const full = await f.call('redteam_agent_slot', { action: 'acquire', key: 'waiting' })
  assert.equal(full.used, 3)
  assert.equal(full.free, 0)
  assert.equal(full.assigned, 1)
  assert.equal(full.pending, 1)
  const released = await f.call('redteam_agent_slot', { action: 'release', key: 'task' })
  assert.equal(released.used, 3)
  assert.equal(released.free, 0)
  f.listeners.get('subagent/end')({ id: 'child', runId: 'run' })
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

test('query wrappers forward requested paging unchanged and return store-applied metadata', async t => {
  const calls = []
  const page = { total: 6000, returned: 0, limit: 1000, offset: 2000, hasMore: true, nextOffset: 3000, items: [] }
  const f = await fixture(t, {
    listAssets: (id, args) => { calls.push({ id, args }); return { ...page, limit: 2000, nextOffset: 4000 } },
    listVulns: (id, args) => { calls.push({ id, args }); if (args.limit < 0) throw new Error('invalid limit'); return page },
    vulnStats: () => ({ total: 6000 }),
  })
  assert.equal(f.definitions.size, 57)
  for (const name of ['redteam_asset_query', 'redteam_vuln_query']) {
    assert.equal(f.definitions.get(name).parameters.offset.type, 'number')
    const result = await f.call(name, { engagement: 'a', limit: 4000, offset: 2000 })
    assert.equal(calls.at(-1).id, 'a')
    assert.equal(calls.at(-1).args.limit, 4000)
    assert.equal(calls.at(-1).args.offset, 2000)
    assert.equal(result.returned, 0)
    assert.equal(result.hasMore, true)
    assert.equal(result.offset, 2000)
    assert.equal(result.limit, name === 'redteam_asset_query' ? 2000 : 1000)
    assert.equal(result.nextOffset, name === 'redteam_asset_query' ? 4000 : 3000)
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
