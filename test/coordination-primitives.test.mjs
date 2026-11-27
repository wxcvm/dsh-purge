import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { readSettings, settingsPathOf, writeSettings } from '../lib/redteam/settings.js'
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
