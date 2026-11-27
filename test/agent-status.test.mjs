import test from 'node:test'
import assert from 'node:assert/strict'
import { bindAgentStatus, collectAgentStatus } from '../lib/redteam/agent-status.js'

const session = (id) => ({ id, header: {} })
const context = (rows, children, agents) => ({
  get(name) {
    if (name === 'sessions') return { list: async () => rows }
    if (name === 'subagents') return { listChildren: async (id) => children(id) }
    if (name === 'agents') return { get: async (id) => agents?.[id] }
  },
})

test('legacy child activity returns accurate usage and free slots for one session', async () => {
  const result = await collectAgentStatus(context([session('root')], () => [
    { id: 'one', kind: 'child', activity: 'running' },
    { id: 'two', kind: 'child', activity: 'idle' },
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(result.used, 1)
  assert.equal(result.free, 2)
  assert.equal(result.per_root[0].owner, 'root')
})

test('modern Agent.status fallback is used rather than assuming idle', async () => {
  const result = await collectAgentStatus(context([session('root')], () => [
    { id: 'a' }, { id: 'b' },
  ], { a: { status: 'running' }, b: { status: 'idle' } }))
  assert.equal(result.available, true)
  assert.equal(result.used, 1)
  assert.equal(result.free, 2)
})

test('unknown child and failed root leave free slots unknown', async () => {
  const unknown = await collectAgentStatus(context([session('root')], () => [
    { id: 'a', activity: 'running' }, { id: 'b' },
  ]))
  assert.equal(unknown.used, 1)
  assert.equal(unknown.free, null)
  assert.equal(unknown.available, false)
  assert.equal(unknown.used_is_lower_bound, true)
  const failed = await collectAgentStatus(context([session('a'), session('b')], (id) => {
    if (id === 'b') throw Error('registry unavailable')
    return [{ id: 'only', activity: 'running' }]
  }))
  assert.equal(failed.used, 1)
  assert.equal(failed.free, null)
  assert.equal(failed.available, false)
  assert.match(failed.per_root[1].error, /registry unavailable/)
})

test('multiple roots report per-root free but not fake global capacity', async () => {
  const result = await collectAgentStatus(context([session('a'), session('b')], (id) =>
    [{ id: id + '1', activity: 'running' }, { id: id + '2', activity: 'running' }]))
  assert.equal(result.used, 4)
  assert.equal(result.available, true)
  assert.equal(result.free, null)
  assert.deepEqual(result.per_root.map(x => x.free), [1, 1])
})

test('missing registries and malformed lists never report zero as confirmed free capacity', async () => {
  const absent = await collectAgentStatus({ get() { throw Error('missing') } })
  assert.equal(absent.ok, false)
  assert.equal(absent.free, null)
  const empty = await collectAgentStatus(context([], () => []))
  assert.equal(empty.available, false)
  assert.equal(empty.free, null)
  const malformed = await collectAgentStatus(context([{ id: 'bad' }], () => []))
  assert.equal(malformed.available, false)
  const fallback = await collectAgentStatus({
    get: () => undefined,
    sessions: { list: () => [session('fallback')] },
    subagents: { listChildren: () => [] },
  })
  assert.equal(fallback.available, true)
  assert.equal(fallback.free, 3)
})

test('modern catalog uses live Agent status, not historical child presence, and releases observation', async () => {
  let disposed = 0
  const queried = []
  const rows = [
    { id: 'running', mode: 'continuable', label: 'running child' },
    { id: 'idle', mode: 'continuable' },
    { id: 'cold', mode: 'one-shot' },
  ]
  const ctx = {
    sessions: { list: () => [
      session('root'),
      { id: 'running', header: { origin: 'subagent', parentSession: 'root' } },
    ] },
    subagents: {},
    sessionQuery: { async observeSession(id) {
      queried.push(id)
      return { projections: { values: { subagentCatalog: rows } },
        [Symbol.dispose]() { disposed++ } }
    } },
    agents: { get(id) { return id === 'cold' ? undefined : { status: id } } },
  }
  const result = await collectAgentStatus(ctx)
  assert.equal(result.available, false)
  assert.equal(result.used, 1)
  assert.equal(result.free, null)
  assert.equal(result.unknown_children, 1)
  assert.equal(result.used_is_lower_bound, true)
  assert.equal(result.total_children, 3)
  assert.deepEqual(queried, ['root'])
  assert.equal(disposed, 1)
})

test('modern catalog lookup gaps and failures never create fictional free slots', async () => {
  for (const lookup of [() => undefined, () => null, () => { throw Error('registry lag') }]) {
    let released = 0
    const result = await collectAgentStatus({
      sessions: { list: () => [session('root')] },
      sessionQuery: { observeSession: () => ({
        projections: { values: { subagentCatalog: [{ id: 'child', mode: 'one-shot' }] } },
        [Symbol.dispose]() { released++ },
      }) },
      agents: { get: lookup },
    })
    assert.equal(result.ok, true)
    assert.equal(result.available, false)
    assert.equal(result.used, 0)
    assert.equal(result.free, null)
    assert.equal(result.unknown_children, 1)
    assert.equal(result.used_is_lower_bound, true)
    assert.equal(result.per_root[0].free, null)
    assert.equal(released, 1)
  }
})

test('modern missing projection is unknown and releases its observation', async () => {
  let disposed = 0
  const result = await collectAgentStatus({
    sessions: { list: () => [session('root')] },
    sessionQuery: { observeSession: () => ({ projections: { values: {} },
      [Symbol.dispose]() { disposed++ } }) },
    agents: { get: () => undefined },
  })
  assert.equal(result.available, false)
  assert.equal(result.free, null)
  assert.match(result.per_root[0].error, /subagentCatalog projection unavailable/)
  assert.equal(disposed, 1)
})

test('modern external, unknown and missing Agent registry never imply free slots', async () => {
  const rows = [{ id: 'x', mode: 'external' }, { id: 'y', mode: 'unknown' },
    { id: 'z', mode: 'continuable' }]
  const result = await collectAgentStatus({
    sessions: { list: () => [session('root')] },
    sessionQuery: { observeSession: () => ({ projections: { values: { subagentCatalog: rows } },
      [Symbol.dispose]() {} }) },
  })
  assert.equal(result.available, false)
  assert.equal(result.free, null)
  assert.equal(result.unknown_children, 3)
})

test('optional Cordis bindings attach after UI initialization and clear on disposal', async () => {
  const callbacks = new Map()
  const cleanups = new Map()
  const ctx = {
    get() { return undefined },
    inject([name], fn) { callbacks.set(name, fn) },
  }
  const read = bindAgentStatus(ctx)
  assert.equal((await read()).available, false)
  const install = (name, value) => callbacks.get(name)({
    get: key => key === name ? value : undefined,
    effect: fn => cleanups.set(name, fn()),
  })
  install('sessions', { list: () => [session('root')] })
  install('sessionQuery', { observeSession: () => ({
    projections: { values: { subagentCatalog: [] } }, [Symbol.dispose]() {},
  }) })
  assert.equal((await read()).free, 3)
  cleanups.get('sessionQuery')()
  assert.equal((await read()).available, false)
})

test('scoped read checks only the requested root and needs no global session registry', async () => {
  const queried = []
  let released = 0
  const read = bindAgentStatus({
    sessionQuery: { observeSession(id) {
      queried.push(id)
      return { projections: { values: { subagentCatalog: [
        { id: 'child', mode: 'continuable', label: 'worker' },
      ] } }, [Symbol.dispose]() { released++ } }
    } },
    agents: { get: () => ({ status: 'running' }) },
  })
  const result = await read({ rootSessionId: 'owner' })
  assert.equal(result.available, true)
  assert.equal(result.used, 1)
  assert.equal(result.free, 2)
  assert.equal(result.running[0].parent, 'owner')
  assert.deepEqual(queried, ['owner'])
  assert.equal(released, 1)
})

test('scoped legacy read retains known running activity on a partial registry', async () => {
  const result = await collectAgentStatus({
    subagents: { listChildren: id => {
      assert.equal(id, 'owner')
      return [{ id: 'known', kind: 'child', activity: 'running' },
        { id: 'unknown', kind: 'child' }]
    } },
  }, { rootSessionId: 'owner' })
  assert.equal(result.used, 1)
  assert.equal(result.available, false)
  assert.equal(result.free, null)
  assert.equal(result.used_is_lower_bound, true)
})

test('legacy malformed child rows remain unknown without hiding valid activity', async () => {
  const result = await collectAgentStatus(context([session('root')], () => [
    { id: 'known', kind: 'child', activity: 'running' },
    null, 'bad-row', [],
    { id: 'not-a-child', kind: 'external', activity: 'running' },
  ]))
  assert.equal(result.ok, true)
  assert.equal(result.used, 1)
  assert.equal(result.total_children, 4)
  assert.equal(result.unknown_children, 3)
  assert.equal(result.available, false)
  assert.equal(result.free, null)
  assert.equal(result.used_is_lower_bound, true)
  assert.equal(result.per_root[0].free, null)
})
