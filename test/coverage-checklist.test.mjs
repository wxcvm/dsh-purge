import test from 'node:test'
import assert from 'node:assert/strict'
import { COVERAGE_FIELDS, coverageView, planCoverageUpdate, validateCoverageClose } from '../lib/redteam/coverage-checklist.js'

test('external and internal checklists remain separate, incomplete by default', () => {
  assert.deepEqual(COVERAGE_FIELDS.external, ['surface', 'web', 'auth', 'cve', 'app'])
  assert.deepEqual(COVERAGE_FIELDS.internal, ['files', 'privesc', 'web', 'db', 'lateral'])
  const first = coverageView('external')
  assert.equal(first.status, 'open')
  assert.equal(first.complete, false)
  assert.equal(first.ready_to_close, false)
  assert.deepEqual(first.missing, COVERAGE_FIELDS.external)
  assert.deepEqual(coverageView('internal').missing, COVERAGE_FIELDS.internal)
})

test('manual coverage update only accepts known fields, states and no duplicates', () => {
  const patch = planCoverageUpdate('external', null, [
    { field: 'surface', state: 'done' }, { field: 'web', state: 'partial' },
  ], 'Manually verified')
  assert.deepEqual(JSON.parse(patch.checks_json), { surface: 'done', web: 'partial',
    auth: 'untested', cve: 'untested', app: 'untested' })
  assert.equal(patch.note, 'Manually verified')
  const updated = coverageView('external', { checks_json: patch.checks_json })
  assert.deepEqual(updated.missing, ['web', 'auth', 'cve', 'app'])
  assert.throws(() => validateCoverageClose('external', { checks_json: patch.checks_json }, 'closed'),
    /checklist incomplete/)
  assert.throws(() => planCoverageUpdate('external', null, [
    { field: 'files', state: 'done' }
  ]), /unknown coverage field/)
  assert.throws(() => planCoverageUpdate('external', null, [
    { field: 'web', state: 'done' }, { field: 'web', state: 'partial' }
  ]), /duplicate coverage field/)
  assert.throws(() => planCoverageUpdate('external', null, [
    { field: 'web', state: 'unknown' }
  ]), /unknown coverage field/)
  assert.throws(() => planCoverageUpdate('external', null, [], undefined), /updates must/)
})

test('blocked requires a reason; completed means explicitly checked all five fields', () => {
  assert.throws(() => validateCoverageClose('internal', null, 'blocked', ''), /requires a reason/)
  const all = Object.fromEntries(COVERAGE_FIELDS.internal.map(k => [k, 'not_applicable']))
  all.files = 'done'
  const previous = { checks_json: JSON.stringify(all), status: 'open' }
  assert.equal(coverageView('internal', previous).ready_to_close, true)
  assert.deepEqual(validateCoverageClose('internal', previous, 'closed'),
    { status: 'closed', blocked_reason: null })
  assert.deepEqual(validateCoverageClose('internal', null, 'blocked', 'No access'),
    { status: 'blocked', blocked_reason: 'No access' })
  assert.equal(coverageView('internal', { checks_json: '{garbled', status: 'closed' }).complete, false)
  assert.equal(coverageView('internal', { checks_json: JSON.stringify(all), status: 'blocked' }).complete, false)
})
