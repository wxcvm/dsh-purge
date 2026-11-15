import test from 'node:test'
import assert from 'node:assert/strict'
import { createReservations, reservedUsage, withReservationUsage } from '../lib/redteam/agent-reservations.js'

const event = (runId, parentSessionId) => ({ runId, parentSessionId })

test('out-of-order finishes release only the matching reservation', () => {
  const r = createReservations()
  const first = r.acquire('root', 'root', 'first', 1)
  const second = r.acquire('root', 'root', 'second', 2)
  assert.equal(r.start(event('run-a', 'root')), true)
  assert.equal(r.start(event('run-a', 'root')), false)
  assert.equal(r.start(event('run-b', 'root')), true)
  assert.equal(r.end(event('run-b', 'root')), true)
  assert.deepEqual(r.list('root').map(x => x.key), [first])
  assert.equal(r.end(event('run-b', 'root')), false)
  assert.equal(r.end(event('run-a', 'other')), false)
  assert.equal(r.end(event('run-a', 'root')), true)
  assert.deepEqual(r.list('root'), [])
  assert.notEqual(first, second)
})

test('unmatched, malformed and foreign events cannot release pending slots', () => {
  const r = createReservations()
  const key = r.acquire('root', 'root', 'task')
  assert.equal(r.end(event('unrelated', 'root')), false)
  assert.equal(r.start(event('unrelated', 'other')), false)
  assert.equal(r.end({ id: 'child' }), false)
  assert.equal(r.list('root')[0].key, key)
  assert.equal(r.release('root', key), true)
  assert.equal(r.release('root', key), false)
})

test('nested parents and roots are isolated and failed starts can be released', () => {
  const r = createReservations()
  const a = r.acquire('root-a', 'nested-a', 'same', 1)
  const b = r.acquire('root-b', 'root-b', 'same', 1)
  const c = r.acquire('root-a', 'nested-a', 'same', 1)
  assert.notEqual(a, c)
  assert.equal(r.start(event('run-b', 'root-b')), true)
  assert.equal(r.start(event('run-a', 'nested-a')), true)
  assert.equal(r.end(event('run-a', 'nested-a')), true)
  assert.deepEqual(r.list('root-a').map(x => x.key), [c])
  assert.deepEqual(r.list('root-b').map(x => x.key), [b])
  assert.equal(r.release('root-a', c), true)
  assert.equal(r.end(event('run-b', 'root-b')), true)
})

test('manual release without a key removes one reservation, not the whole root', () => {
  const r = createReservations()
  r.acquire('root', 'root', 'first')
  const second = r.acquire('root', 'root', 'second')
  assert.equal(r.release('root'), true)
  assert.deepEqual(r.list('root').map(x => x.key), [second])
})

test('usage counts the union of observed running children and outstanding reservations', () => {
  const r = createReservations()
  r.acquire('root', 'root', 'observed')
  r.acquire('root', 'root', 'pending')
  r.start({ ...event('run-a', 'root'), id: 'child-a' })
  assert.equal(reservedUsage({ running: 2, running_ids: ['child-a', 'unreserved'] }, r.list('root')), 3)
  assert.equal(reservedUsage({ running: 1, running_ids: ['unreserved'] }, r.list('root')), 3)
  assert.equal(reservedUsage({ running: 0, running_ids: [] }, r.list('root')), 2)
  r.end(event('run-a', 'root'))
  assert.equal(reservedUsage({ running: 1, running_ids: ['unreserved'] }, r.list('root')), 2)
})

test('idle or disposed parent reclaims only its unbound reservations', () => {
  const r = createReservations()
  const active = r.acquire('root', 'root', 'active', 1)
  r.acquire('root', 'root', 'failed start', 2)
  const nested = r.acquire('root', 'nested', 'nested pending', 3)
  r.start({ ...event('run-a', 'root'), id: 'child-a' })
  assert.equal(r.clearPending('root'), 1)
  assert.deepEqual(r.list('root').map(x => x.key), [active, nested])
  assert.equal(r.clearPending('root'), 0)
  assert.equal(r.clearPending('nested'), 1)
  assert.equal(r.end(event('run-a', 'root')), true)
  assert.deepEqual(r.list('root'), [])
})

test('UI and tool use the same occupied capacity while preserving unknown free slots', () => {
  const r = createReservations()
  r.acquire('root', 'root', 'pending')
  const live = { max: 3, used: 1, available: true, free: 2,
    per_root: [{ owner: 'root', used: 1, available: true, running_ids: ['child'] }] }
  const view = withReservationUsage(live, r)
  assert.equal(view.used, 1)
  assert.equal(view.free, 1)
  assert.equal(view.per_root[0].occupied, 2)
  assert.equal(view.per_root[0].reserved_unobserved, 1)
  assert.equal(live.free, 2)
  const unknown = withReservationUsage({ ...live, available: false,
    per_root: [{ ...live.per_root[0], available: false }] }, r)
  assert.equal(unknown.free, null)
  assert.equal(unknown.per_root[0].free, null)
})


test('stable keys preserve age and child restart cannot release the replacement run', () => {
  const r = createReservations()
  assert.equal(r.acquire('root', 'root', 'first', 1, 'task'), 'task')
  assert.equal(r.acquire('root', 'root', 'retry', 100, 'task'), 'task')
  assert.equal(r.list('root')[0].at, 1)
  r.acquire('root', 'root', 'next', 2, 'next')
  assert.equal(r.start({ ...event('old', 'root'), id: 'child' }), true)
  assert.equal(r.start({ ...event('new', 'root'), id: 'child' }), true)
  assert.equal(r.end(event('old', 'root')), false)
  assert.equal(r.list('root')[0].runId, 'new')
  assert.equal(r.end(event('new', 'root')), true)
  assert.deepEqual(r.list('root').map(x => x.key), ['next'])
})
