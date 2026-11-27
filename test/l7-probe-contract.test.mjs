import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('TUN L7 probe requires a read Skill, explicit per-call confirmation, one scoped port and loopback proxy', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-l7-contract-'))
  const prevHome = process.env.DSH_HOME
  const prevKb = process.env.ARTEX_KB_DIR
  let redteam
  t.after(() => {
    redteam?.close()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    if (prevKb === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = prevKb
    rmSync(home, { recursive: true, force: true })
  })

  const moduleDir = join(home, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{}')
  writeFileSync(join(moduleDir, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(moduleDir, 'index.js'), 'exports.defineTool = spec => spec\n')
  process.env.DSH_HOME = home
  process.env.ARTEX_KB_DIR = join(home, 'artkb')
  mkdirSync(process.env.ARTEX_KB_DIR, { recursive: true })

  const { apply } = await import('../lib/redteam/tools.js')
  redteam = new RedteamStore(home)
  const registered = new Map()
  const ctx = {
    redteam,
    tools: { register(tool) { registered.set(tool.name, tool) } },
    on: () => () => {},
    effect: (attach) => { const dispose = attach(); t.after(() => dispose?.()) },
  }
  apply(ctx)

  const l7 = registered.get('redteam_l7_probe')
  const skillRead = registered.get('redteam_skill_read')
  assert.ok(l7)
  assert.ok(skillRead)
  const exec = { sessionId: 'l7-probe-contract-root' }
  const scoped = redteam.openEngagement('l7-scoped', ['192.0.2.0/24'], { bindCurrent: false }).id
  const call = async (engagement, args) => JSON.parse(await l7.execute({ engagement, ...args }, exec))

  const unread = await call(scoped, { host: '192.0.2.10', ports: [443], confirm: true })
  assert.equal(unread.ok, false)
  assert.match(String(unread.error || ''), /redteam:l7-service-confirmation/)

  const read = JSON.parse(await skillRead.execute({ key: 'redteam:l7-service-confirmation' }, exec))
  assert.equal(read.ok, true)
  assert.equal(read.skillReadReceipt, 'recorded-for-current-root-session')

  const noConfirm = await call(scoped, { host: '192.0.2.10', ports: [443] })
  assert.equal(noConfirm.ok, false)
  assert.match(String(noConfirm.error || ''), /confirm:true/)

  const manyPorts = await call(scoped, { host: '192.0.2.10', ports: [80, 443], confirm: true })
  assert.equal(manyPorts.ok, false)
  assert.match(String(manyPorts.error || ''), /只允许一个端口/)

  const noPorts = await call(scoped, { host: '192.0.2.10', confirm: true })
  assert.equal(noPorts.ok, false)
  assert.match(String(noPorts.error || ''), /只允许一个端口/)

  const invalidPort = await call(scoped, { host: '192.0.2.10', ports: [70000], confirm: true })
  assert.equal(invalidPort.ok, false)
  assert.match(String(invalidPort.error || ''), /1-65535/)

  const remoteProxy = await call(scoped, {
    host: '192.0.2.10', ports: [443], confirm: true, proxy: 'socks5://198.51.100.9:1080',
  })
  assert.equal(remoteProxy.ok, false)
  assert.match(String(remoteProxy.error || ''), /loopback SOCKS5/)

  const emptyScope = redteam.openEngagement('l7-empty', [], { bindCurrent: false }).id
  const noScope = await call(emptyScope, { host: '192.0.2.10', ports: [443], confirm: true })
  assert.equal(noScope.ok, false)
  assert.match(String(noScope.error || ''), /非空授权范围|空 scope/)

  const outsideScope = redteam.openEngagement('l7-outside', ['198.51.100.0/24'], { bindCurrent: false }).id
  const outside = await call(outsideScope, { host: '192.0.2.10', ports: [443], confirm: true })
  assert.equal(outside.ok, false)
  assert.match(String(outside.error || ''), /不在该演练登记的授权范围/)
})
