import test from 'node:test'
import assert from 'node:assert/strict'
import { probeEnvironmentNetwork } from '../lib/redteam/environment-network.js'

test('DNS returns counts without exposing addresses, accepts either family', async () => {
  const result = await probeEnvironmentNetwork('dns', {
    resolver: { resolve4: async host => { assert.equal(host, 'api.github.com'); return ['192.0.2.1'] },
      resolve6: async () => { throw Object.assign(new Error('secret'), { code: 'ENODATA' }) } },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.records, { A: { count: 1, status: 'resolved' }, AAAA: { count: 0, status: 'failed', code: 'ENODATA' } })
  assert.ok(!JSON.stringify(result).includes('192.0.2.1'))
})
test('HTTPS reports a real response and explicitly avoids plugin proxy', async () => {
  const result = await probeEnvironmentNetwork('direct', { request: async (url, opts) => {
    assert.equal(url, 'https://api.github.com/')
    assert.equal(opts.method, 'HEAD')
    assert.equal(opts.agent, false)
    assert.equal(opts.timeout, 8000)
    return { statusCode: 403, body: 'secret' }
  } })
  assert.equal(result.ok, true)
  assert.equal(result.statusCode, 403)
  assert.ok(!JSON.stringify(result).includes('secret'))
})
test('network errors are reported without raw error details', async () => {
  const result = await probeEnvironmentNetwork('direct', { request: async () => {
    throw Object.assign(new Error('secret'), { code: 'ETIMEDOUT' })
  } })
  assert.equal(result.ok, false)
  assert.match(result.error, /ETIMEDOUT/)
  assert.ok(!result.error.includes('secret'))
  assert.equal((await probeEnvironmentNetwork('invalid')).ok, false)
})
