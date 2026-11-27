import test from 'node:test'
import assert from 'node:assert/strict'
import { queryPage, pageMetadata } from '../lib/redteam/query-options.js'

test('pagination defaults, trims integer strings, and retains configured caps', () => {
  assert.deepEqual(queryPage(), { limit: 200, offset: 0 })
  assert.deepEqual(queryPage({ limit: ' 31 ', offset: ' 53 ' }), { limit: 31, offset: 53 })
  assert.deepEqual(queryPage({ limit: 2001 }, 2000), { limit: 2000, offset: 0 })
  assert.deepEqual(queryPage({ limit: 2000 }, 1000), { limit: 1000, offset: 0 })
})

test('pagination rejects malformed limits and offsets', () => {
  const invalid = [-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1,
    null, '', ' ', 'NaN', '-1', '1.5', '1e3', true, false, [], {}, 1n]
  for (const value of [...invalid, 0]) {
    assert.throws(() => queryPage({ limit: value }), /limit: must be a safe integer/)
  }
  for (const value of invalid) {
    assert.throws(() => queryPage({ offset: value }), /offset: must be a safe integer/)
  }
  assert.deepEqual(queryPage({ limit: 1, offset: Number.MAX_SAFE_INTEGER }), {
    limit: 1, offset: Number.MAX_SAFE_INTEGER,
  })
})

test('page metadata advances by returned rows and stops at the end or an empty page', () => {
  assert.deepEqual(pageMetadata(257, 31, { limit: 31, offset: 0 }), {
    limit: 31, offset: 0, returned: 31, hasMore: true, nextOffset: 31,
  })
  assert.deepEqual(pageMetadata(257, 9, { limit: 31, offset: 248 }), {
    limit: 31, offset: 248, returned: 9, hasMore: false, nextOffset: null,
  })
  assert.deepEqual(pageMetadata(257, 0, { limit: 31, offset: 300 }), {
    limit: 31, offset: 300, returned: 0, hasMore: false, nextOffset: null,
  })
  assert.equal(pageMetadata(257, 0, { limit: 31, offset: 0 }).nextOffset, null)
})
