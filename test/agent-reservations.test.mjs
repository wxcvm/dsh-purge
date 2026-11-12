import test from 'node:test'
import assert from 'node:assert/strict'
import { createReservations } from '../lib/redteam/agent-reservations.js'

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
