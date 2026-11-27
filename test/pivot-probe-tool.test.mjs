import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

async function mockSocks5() {
  let connections = 0
  const server = createServer(socket => {
    connections++
    let stage = 'greeting'
    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 'greeting' && buffer.length >= 3) {
        buffer = buffer.subarray(3)
        socket.write(Buffer.from([5, 0]))
        stage = 'connect'
      }
      if (stage === 'connect' && buffer.length >= 10) {
        buffer = buffer.subarray(10)
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        stage = 'done'
      }
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    server,
    listen: '127.0.0.1:' + server.address().port,
    connections: () => connections,
  }
}

test('redteam_pivot_probe requires scope, tunnel reach, target-side legitimacy and an existing open port', async t => {
  const home = mkdtempSync(join(tmpdir(), 'purge-pivot-tool-'))
  const previousHome = process.env.DSH_HOME
  const previousKb = process.env.ARTEX_KB_DIR
  const moduleDir = join(home, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{}')
  writeFileSync(join(moduleDir, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(moduleDir, 'index.js'), 'exports.defineTool = spec => spec\\n')
  process.env.DSH_HOME = home
  process.env.ARTEX_KB_DIR = join(home, 'artkb')
  mkdirSync(process.env.ARTEX_KB_DIR, { recursive: true })

  const store = new RedteamStore(home)
  const proxy = await mockSocks5()
  t.after(async () => {
    await new Promise(resolve => proxy.server.close(resolve))
    for (const db of store.handles.values()) db.close()
    rmSync(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousKb === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = previousKb
  })

  const { apply } = await import('../lib/redteam/tools.js')
  const registered = new Map()
  const ctx = {
    redteam: store,
    tools: { register(tool) { registered.set(tool.name, tool) } },
    on: () => () => {},
    effect: attach => { const dispose = attach(); t.after(() => dispose?.()) },
  }
  apply(ctx)
  const tool = registered.get('redteam_pivot_probe')
  assert.ok(tool, 'pivot probe must be registered')

  const engagement = store.openEngagement('pivot-probe-scope', ['10.0.0.0/24'], { bindCurrent: false }).id
  store.importBundle(engagement, {
    assets: [{
      ip: '10.0.0.5', state: 'live',
      ports: [{ port: 443, proto: 'tcp', state: 'open' }],
    }],
  })
  const asset = store.db(engagement).prepare('SELECT id FROM asset WHERE ip = ?').get('10.0.0.5')
  const tunnel = store.addTunnel(engagement, {
    kind: 'socks5', listen: proxy.listen, reach: '10.0.1.0/24',
    entry_kind: 'target-outbound', status: 'active',
  })

  const base = { engagement, tunnel_id: tunnel.id, asset_id: asset.id, port: 443, timeout_ms: 1000 }
  const closedPort = JSON.parse(await tool.execute({ ...base, port: 444 }, {}))
  assert.equal(closedPort.ok, false)
  assert.match(closedPort.error, /already be recorded as open/)
  assert.equal(proxy.connections(), 0)

  const outOfReach = JSON.parse(await tool.execute(base, {}))
  assert.equal(outOfReach.ok, false)
  assert.match(outOfReach.error, /outside the registered tunnel reach/)
  assert.equal(proxy.connections(), 0)

  store.updateTunnel(engagement, tunnel.id, { reach: '10.0.0.0/24', entry_kind: 'self-only' })
  const selfOnly = JSON.parse(await tool.execute(base, {}))
  assert.equal(selfOnly.ok, false)
  assert.match(selfOnly.error, /target-side tunnel/)
  assert.equal(proxy.connections(), 0)

  store.updateTunnel(engagement, tunnel.id, { entry_kind: 'target-outbound' })
  const reachable = JSON.parse(await tool.execute(base, {}))
  assert.equal(reachable.ok, true)
  assert.equal(reachable.reachable, true)
  assert.equal(reachable.target, '10.0.0.5:443')
  assert.equal(proxy.connections(), 1)
})
