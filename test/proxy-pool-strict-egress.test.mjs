import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  disposeProxyPool, loadProxyPool, proxyPoolSave, proxyProfileSave, requestWithProxyPool,
} from '../lib/redteam/proxy-pool.js'
import { handleProxyOp } from '../lib/redteam/proxy-api.js'

async function localFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-strict-egress-'))
  let hits = 0
  const server = createServer((_req, res) => {
    hits += 1
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('local-test-ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await disposeProxyPool(root)
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    url: 'http://127.0.0.1:' + server.address().port + '/probe',
    hits: () => hits,
  }
}

test('strict plugin egress is persisted and never falls back on disabled pool or noProxy', async (t) => {
  const { root, url, hits } = await localFixture(t)
  const configured = await proxyPoolSave(root, { strictEgress: true })
  assert.equal(configured.strictEgress, true)
  assert.equal(loadProxyPool(root).strictEgress, true)
  assert.equal((await handleProxyOp(root, { op: 'proxyPoolGet' })).strictEgress, true)
  await assert.rejects(requestWithProxyPool(root, url, { timeout: 2000 }), /严格出口模式/)
  assert.equal(hits(), 0, 'a disabled pool cannot bypass the required proxy')

  const profile = await proxyProfileSave(root, {
    name: 'proxy-only-fixture', protocol: 'http', host: '127.0.0.1',
    port: 6550, noProxy: '127.0.0.1',
  })
  await proxyPoolSave(root, { enabled: true, autoConnect: false, activeId: profile.savedId })
  await assert.rejects(requestWithProxyPool(root, url, { timeout: 2000 }), /直连/)
  assert.equal(hits(), 0, 'noProxy must not reconnect directly under strict policy')

  const saved = await proxyPoolSave(root, { strictEgress: false })
  assert.equal(saved.strictEgress, false)
  const direct = await requestWithProxyPool(root, url, { timeout: 2000 })
  assert.equal(direct.statusCode, 200)
  assert.equal(direct.body, 'local-test-ok')
  assert.equal(hits(), 1, 'legacy explicit noProxy behavior is unchanged when strict mode is off')
})

test('per-request requireProxy also blocks direct HTTP without changing saved preferences', async (t) => {
  const { root, url, hits } = await localFixture(t)
  assert.equal(loadProxyPool(root).strictEgress, false)
  await assert.rejects(requestWithProxyPool(root, url, { requireProxy: true }), /严格出口模式/)
  assert.equal(hits(), 0)
  assert.equal(loadProxyPool(root).strictEgress, false)
})
