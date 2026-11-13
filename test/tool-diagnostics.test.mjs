import test from 'node:test'
import assert from 'node:assert/strict'
import { structuredToolFailure } from '../lib/redteam/tool-diagnostics.js'

test('structured errors preserve legacy kind and distinguish missing objects, permissions, timeout and storage', () => {
  const cases = [
    [new Error('asset not found'), 'bad_input', 'not_found'],
    [new TypeError('invalid id'), 'bad_input', 'bad_input'],
    [Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }), 'failed', 'storage_busy'],
    [Object.assign(new Error('read failed'), { code: 'EACCES' }), 'failed', 'permission_denied'],
    [Object.assign(new Error('operation stopped'), { code: 'ETIMEDOUT' }), 'failed', 'timeout'],
    [new Error('redteam store unavailable'), 'failed', 'unavailable'],
    [new Error('unexpected error'), 'failed', 'failed'],
  ]
  for (const [error,kind,code] of cases) {
    const result = structuredToolFailure(error)
    assert.equal(result.ok,false)
    assert.equal(result.error_kind,kind)
    assert.equal(result.error_code,code)
    assert.equal(result.error,error.message)
    assert.ok(result.hint)
  }
})

test('diagnostics mask credentials before clipping and preserve the original error object', () => {
  const error = new Error('x'.repeat(900)+' password="PRIVATE_FIXTURE '+ 'y'.repeat(500)+'"')
  const result = structuredToolFailure(error)
  assert.equal(result.error.includes('PRIVATE_FIXTURE'),false)
  assert.ok(result.error.includes('[REDACTED_SECRET]'))
  assert.ok(result.error.length<=1000)
  assert.ok(error.message.includes('PRIVATE_FIXTURE'))
  assert.equal(structuredToolFailure('plain failure').error,'plain failure')
})
