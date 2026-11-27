/**
 * 扫描环境守卫测试
 *
 * 事故背景：FlClash TUN 下 nmap 报 1000/1000 open、0.75ms 延迟；
 * 连 1.1.1.1:1 这类必闭端口都被判 open。守卫必须在扫描前拦下这种环境。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectScanTunnel, guardScanEnvironment } from '../lib/redteam/scan-environment.js'
import { runDiscoveryScan } from '../lib/redteam/scan-runner.js'

const NO_TUN = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
}
const WITH_TUN = {
  ...NO_TUN,
  FlClash: [{ address: '198.18.0.1', family: 'IPv4', internal: false }],
}
const WITH_UTUN_ONLY = {
  ...NO_TUN,
  utun3: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
}

test('clean host is not reported as tunneled', () => {
  const r = detectScanTunnel({ interfaces: () => NO_TUN, env: {} })
  assert.equal(r.tunneled, false)
  assert.deepEqual(r.adapters, [])
  assert.deepEqual(r.evidence, [])
})

test('TUN adapter name is detected', () => {
  const r = detectScanTunnel({ interfaces: () => WITH_UTUN_ONLY, env: {} })
  assert.equal(r.tunneled, true)
  assert.ok(r.adapters.includes('utun3'))
})

test('fake-ip range is detected even when the name is unfamiliar', () => {
  const r = detectScanTunnel({ interfaces: () => WITH_TUN, env: {} })
  assert.equal(r.tunneled, true)
  assert.ok(r.adapters.includes('FlClash'))
  assert.ok(r.evidence.some((e) => e.includes('198.18.0.0/15')))
})

test('loopback proxy env is only a hint, never a tunnel verdict', () => {
  const r = detectScanTunnel({
    interfaces: () => NO_TUN,
    env: { ALL_PROXY: 'socks5://127.0.0.1:7890' },
  })
  assert.equal(r.tunneled, false, 'a local proxy alone must not block scanning')
  assert.match(String(r.proxyHint), /ALL_PROXY/)
})

test('guard blocks a tunneled host', () => {
  const g = guardScanEnvironment({ interfaces: () => WITH_TUN, env: {} })
  assert.equal(g.ok, false)
  assert.equal(g.status, 'tunnel-detected')
  assert.match(g.error, /不可信/)
})

test('guard allows explicit operator override and keeps a warning', () => {
  const g = guardScanEnvironment({ interfaces: () => WITH_TUN, env: {}, allowTunnelScan: true })
  assert.equal(g.ok, true)
  assert.match(String(g.warning), /伪造 open/)
})

test('runDiscoveryScan refuses before launching the scanner under a tunnel', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-tunnel-guard-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const exe = join(root, 'nmap.exe')
  writeFileSync(exe, 'fixture')

  let invoked = false
  const result = await runDiscoveryScan(
    { kind: 'nmap', target: '192.0.2.1', ports: '80,443', outputDir: join(root, 'out') },
    {
      root,
      config: { platform: 'windows', tools: { nmap: exe }, toolkitDir: root, binDirs: [] },
      env: { PATH: '' },
      interfaces: () => WITH_TUN,
      execFileFn: (_b, _a, _c, done) => { invoked = true; done(null, '', '') },
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.status, 'tunnel-detected')
  assert.equal(invoked, false, 'the scanner must not be launched at all')
})

test('explicit override still records the environment in the manifest', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-tunnel-allow-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const exe = join(root, 'nmap.exe')
  writeFileSync(exe, 'fixture')

  const result = await runDiscoveryScan(
    { kind: 'nmap', target: '192.0.2.1', ports: '80', outputDir: join(root, 'out') },
    {
      root,
      config: { platform: 'windows', tools: { nmap: exe }, toolkitDir: root, binDirs: [] },
      env: { PATH: '' },
      interfaces: () => WITH_TUN,
      allowTunnelScan: true,
      execFileFn: (_b, _a, _c, done) => done(null, '<nmaprun></nmaprun>', ''),
    },
  )

  assert.equal(result.ok, true)
  assert.equal(result.scanEnvironment.tunneled, true)
  assert.ok(result.scanEnvironment.adapters.includes('FlClash'))
  assert.match(String(result.scanEnvironment.warning), /伪造 open/)
})