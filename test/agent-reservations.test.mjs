import test from 'node:test'
import assert from 'node:assert/strict'
import { createReservations, reservedUsage, withReservationUsage } from '../lib/redteam/agent-reservations.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

test('run ids are scoped to their direct parent; endings never release another parent task', () => {
  const r = createReservations()
  const a = r.acquire('root-a', 'parent-a', 'same-task', 1, 'task-a')
  const b = r.acquire('root-b', 'parent-b', 'same-task', 2, 'task-b')
  assert.equal(r.start(event('local-run-1', 'parent-a')), true)
  assert.equal(r.start(event('local-run-1', 'parent-b')), true)
  assert.equal(r.start(event('local-run-1', 'parent-b')), false)
  assert.deepEqual(r.list('root-a').map(row => row.key), [a])
  assert.deepEqual(r.list('root-b').map(row => row.key), [b])
  assert.equal(r.end(event('local-run-1', 'parent-a')), true)
  assert.deepEqual(r.list('root-a'), [])
  assert.deepEqual(r.list('root-b').map(row => row.key), [b])
  assert.equal(r.end(event('local-run-1', 'parent-a')), false)
  assert.equal(r.end(event('local-run-1', 'parent-b')), true)
  assert.deepEqual(r.list('root-b'), [])
})

test('one idle parent cannot reclaim sibling pending or running child reservations', () => {
  const r = createReservations()
  r.acquire('root', 'parent-1', 'active', 1, 'active')
  r.acquire('root', 'parent-1', 'queued', 2, 'queued')
  r.acquire('root', 'parent-2', 'queued', 3, 'other-queued')
  assert.equal(r.start({ ...event('active-run', 'parent-1'), id: 'child-1' }), true)
  assert.equal(r.clearPending('parent-1'), 1)
  assert.deepEqual(r.list('root').map(row => row.key), ['active', 'other-queued'])
  assert.equal(r.clearPending('parent-1'), 0)
  assert.equal(r.end(event('active-run', 'parent-2')), false)
  assert.equal(r.end(event('active-run', 'parent-1')), true)
  assert.deepEqual(r.list('root').map(row => row.key), ['other-queued'])
})

test('completed child handoff survives slot release without fabricating task success', () => {
  const r = createReservations()
  r.acquire('root-a', 'parent-a', 'task', 1, 'TASK-1')
  assert.equal(r.start({ ...event('run-a', 'parent-a'), id: 'child-a' }), true)
  assert.equal(r.end({ ...event('run-a', 'parent-a'), stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'PRIVATE RESULT' }] }), true)
  assert.deepEqual(r.list('root-a'), [])
  assert.deepEqual(r.handoffs('root-a'), [{ key: 'TASK-1', stopReason: 'completed', finalMessage: 'present' }])
  assert.deepEqual(r.handoffs('root-b'), [])
  assert.equal(r.end(event('run-a', 'parent-a')), false)
  assert.equal(r.handoffs('root-a').length, 1)
  assert.doesNotMatch(JSON.stringify(r.handoffs('root-a')), /PRIVATE|child-a|run-a/)
  r.acquire('root-a', 'parent-a', 'retry', 2, 'TASK-1')
  assert.deepEqual(r.handoffs('root-a'), [])
})

test('handoff evidence reflects abnormal stop and is not created by manual release', () => {
  const r = createReservations()
  r.acquire('root', 'parent', 'task', 1, 'task-1')
  assert.equal(r.release('root', 'task-1'), true)
  assert.deepEqual(r.handoffs('root'), [])
  r.acquire('root', 'parent', 'retry', 2, 'task-1')
  r.start(event('run', 'parent'))
  r.end({ ...event('run', 'parent'), stopReason: 'error', lastAssistantMessage: [] })
  assert.deepEqual(r.handoffs('root'), [{ key: 'task-1', stopReason: 'error', finalMessage: 'empty' }])
  r.acquire('other', 'other-parent', 'other', 3, 'task-1')
  assert.equal(r.handoffs('other').length, 0)
})

test('local handoff journal restores completed delegation across fresh reservation books', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-handoff-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = createReservations()
  first.useHandoffDirectory('owner-a', root)
  first.acquire('owner-a', 'parent-a', 'Task', 1, 'task-1')
  first.start({ runId: 'run-1', parentSessionId: 'parent-a' })
  first.end({ runId: 'run-1', parentSessionId: 'parent-a', stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'PRIVATE RESULT' }] })
  const json = readFileSync(join(root, 'agent-handoffs.json'), 'utf8')
  assert.doesNotMatch(json, /PRIVATE RESULT|run-1|parent-a/)
  assert.match(json, /"task-1"/)
  const restored = createReservations()
  restored.useHandoffDirectory('owner-a', root)
  assert.deepEqual(restored.handoffs('owner-a'), [
    { key: 'task-1', stopReason: 'completed', finalMessage: 'present' },
  ])
  assert.deepEqual(restored.list('owner-a'), [])
  assert.equal(restored.handoffStorage('owner-a'), 'ready')
  restored.acquire('owner-a', 'parent-a', 'Retry', 2, 'task-1')
  const afterRetry = createReservations()
  afterRetry.useHandoffDirectory('owner-a', root)
  assert.deepEqual(afterRetry.handoffs('owner-a'), [])
  restored.release('owner-a', 'task-1')
})

test('malformed handoff journal remains unchanged and never breaks in-memory reservations', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-handoff-bad-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'agent-handoffs.json')
  writeFileSync(file, '{incomplete', 'utf8')
  const r = createReservations()
  r.useHandoffDirectory('owner', root)
  assert.equal(r.handoffStorage('owner'), 'read-failed')
  r.acquire('owner', 'parent', 'Task', 1, 'task')
  r.start({ runId: 'r', parentSessionId: 'parent' })
  r.end({ runId: 'r', parentSessionId: 'parent', stopReason: 'error' })
  assert.deepEqual(r.handoffs('owner'), [
    { key: 'task', stopReason: 'error', finalMessage: 'not-observed' },
  ])
  assert.equal(readFileSync(file, 'utf8'), '{incomplete')
})

test('agent page status projects task handoffs by root without confusing reserved and finished', () => {
  const book = createReservations()
  book.acquire('root-a', 'parent-a', 'first', 1, 'active-task')
  book.acquire('root-a', 'parent-a', 'second', 2, 'waiting-task')
  book.start({ ...event('run-1', 'parent-a'), id: 'child-1' })
  book.acquire('root-a', 'parent-a', 'third', 3, 'finished-task')
  book.start({ ...event('run-2', 'parent-a'), id: 'child-2' })
  book.end({ ...event('run-2', 'parent-a'), stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'SECRET RESULT' }] })
  book.acquire('root-b', 'parent-b', 'elsewhere', 4, 'foreign-task')
  const state = withReservationUsage({
    available: true, max: 4, used: 2,
    per_root: [
      { owner: 'root-a', available: true, used: 1, running_ids: ['child-1'] },
      { owner: 'root-b', available: true, used: 0, running_ids: [] },
    ],
  }, book)
  const a = state.per_root[0], b = state.per_root[1]
  assert.deepEqual(a.delegations, [
    { key: 'active-task', state: 'delegated' }, { key: 'waiting-task', state: 'reserved' },
  ])
  assert.deepEqual(a.handoffs, [{ key: 'finished-task', stopReason: 'completed', finalMessage: 'present' }])
  assert.deepEqual(b.delegations, [{ key: 'foreign-task', state: 'reserved' }])
  assert.deepEqual(b.handoffs, [])
  assert.equal(a.handoff_storage, 'not-configured')
  assert.doesNotMatch(JSON.stringify(state), /SECRET RESULT|child-2|run-2/)
})

test('loading a journal projects only four supported fields, never replaying extra document contents', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-handoff-allowlist-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'agent-handoffs.json')
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    handoffs: [{
      owner: 'session-a', key: 'record-1', stopReason: 'completed', finalMessage: 'present',
      privateContent: 'PRIVATE CHAT BODY', diagnostic: { raw: 'RAW TOKEN' },
    }],
  }), 'utf8')
  const book = createReservations()
  book.useHandoffDirectory('session-a', root)
  const rows = book.handoffs('session-a')
  assert.deepEqual(rows, [{ key: 'record-1', stopReason: 'completed', finalMessage: 'present' }])
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE CHAT BODY|RAW TOKEN|privateContent|diagnostic/)
  book.acquire('session-a', 'session-a', 'followup', 2, 'other-task')
  book.start({ runId: 'next-run', parentSessionId: 'session-a' })
  book.end({ runId: 'next-run', parentSessionId: 'session-a', stopReason: 'error' })
  const saved = readFileSync(path, 'utf8')
  assert.doesNotMatch(saved, /PRIVATE CHAT BODY|RAW TOKEN|privateContent|diagnostic/)
})
