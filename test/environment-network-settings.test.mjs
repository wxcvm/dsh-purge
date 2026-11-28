import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleProxyOp } from '../lib/redteam/proxy-api.js'

test('standalone proxy readback and explicit loopback test report the same saved settings', async t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-proxy-health-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let requests = 0, hold = false, arrived
  let respond
  const proxy = createServer((_req, res) => {
    requests++
    const reply = () => { res.writeHead(204); res.end() }
    if (hold) { respond = reply; arrived() } else reply()
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  t.after(() => { proxy.closeAllConnections(); return new Promise(resolve => proxy.close(resolve)) })
  const config = { enabled: true, protocol: 'http', host: '127.0.0.1', port: proxy.address().port,
    username: 'fixture', password: 'NOT_A_REAL_PASSWORD', noProxy: [] }
  const save = patch => handleProxyOp(root, { op: 'proxyConfigSave', config: patch })
  const get = () => handleProxyOp(root, { op: 'proxyConfigGet' })
  const probe = expectedProxyRevision => handleProxyOp(root, { op: 'proxyConfigTest', expectedProxyRevision }, {
    testUrl: 'http://127.0.0.1:1/health-fixture',
  })
  assert.equal((await save(config)).ok, true)
  const snapshot = await get()
  assert.equal(snapshot.config.passwordSet, true)
  assert.equal(JSON.stringify(snapshot).includes(config.password), false)

  const fresh = await probe(snapshot.proxyRevision)
  assert.equal(fresh.ok, true)
  assert.equal(fresh.scope, 'saved_plugin_proxy')
  assert.equal(fresh.proxyRevision, snapshot.proxyRevision)
  assert.ok(Number.isFinite(Date.parse(fresh.checkedAt)))
  assert.equal(requests, 1)

  hold = true
  const received = new Promise(resolve => { arrived = resolve })
  const pending = probe(snapshot.proxyRevision)
  await received
  const switched = await save({ enabled: false })
  respond()
  const rejected = await pending
  assert.equal(switched.ok, true)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'proxy_config_changed')
  assert.equal(requests, 2)
  assert.equal((await get()).config.enabled, false)
})
