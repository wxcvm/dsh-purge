import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPlatformConfig, savePlatformConfig } from '../lib/redteam/platform-config.js'
import { normalizeKaliVm, validateKaliVm } from '../lib/redteam/ssh-kali-config.js'
import { registeredKaliVm, inspectKaliVm, parseLinuxRelease, probeKaliVmTool } from '../lib/redteam/adapters/ssh-kali.js'
import { discoverEnvironments } from '../lib/redteam/environment-registry.js'

const workspace = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ssh-kali-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const vm = { host: '192.168.56.102', user: 'kali', port: 2222, identityFile: '/keys/kali_ed25519' }

test('optional SSH profile preserves existing settings without storing credentials', (t) => {
  const root = workspace(t)
  savePlatformConfig({ tools: { nmap: '/fixture/nmap' }, env: { FOFA_KEY: 'fixture' } }, root)
  const saved = savePlatformConfig({ kaliVm: vm }, root)
  assert.deepEqual(saved.kaliVm, vm)
  assert.equal(saved.tools.nmap, '/fixture/nmap')
  assert.equal(saved.env.FOFA_KEY, 'fixture')
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8').includes('PRIVATE KEY'), false)
  const otherSave = savePlatformConfig({ notes: 'unchanged SSH' }, root)
  assert.deepEqual(otherSave.kaliVm, vm)
  assert.deepEqual(loadPlatformConfig(root).kaliVm, vm)
})

test('SSH destination validation rejects injected commands and option-like hostnames', () => {
  for (const host of ['-oProxyCommand=evil', 'kali.local;echo', 'user@host', '192.168.1.1 && whoami']) {
    assert.match(validateKaliVm({ ...vm, host }), /地址/)
  }
  assert.match(validateKaliVm({ ...vm, user: 'bad user' }), /用户名/)
  assert.match(validateKaliVm({ ...vm, port: 'bad' }), /端口/)
  assert.equal(validateKaliVm({ ...vm, identityFile: 'C:\\Users\\example\\id_ed25519' }), null)
  assert.deepEqual(normalizeKaliVm(), { host: '', user: 'kali', port: 22, identityFile: '' })
})

test('discovery lists configured Kali without invoking SSH or misreporting reachability', async (t) => {
  const root = workspace(t)
  savePlatformConfig({ kaliVm: vm }, root)
  const result = await discoverEnvironments({
    root, platform: 'linux', execFileFn: () => { throw Error('no discovery connection') },
    dockerExecFileFn: (_cmd, _args, _opts, done) => done(null, '', ''),
  })
  assert.equal(result.environments.length, 2)
  assert.equal(result.environments[1].id, 'ssh:kali-vm')
  assert.equal(result.environments[1].state, 'configured')
  assert.equal(result.environments[1].reachable, null)
  assert.equal(result.providers.ssh.state, 'configured')
  assert.equal(registeredKaliVm({ root }).discovery.state, 'configured')
})

test('explicit SSH identity inspection runs fixed command with strict known-host checks', async (t) => {
  const root = workspace(t)
  savePlatformConfig({ kaliVm: vm }, root)
  let count = 0
  const result = await inspectKaliVm({
    root,
    execFileFn: (binary, args, opts, done) => {
      count++
      assert.equal(binary, 'ssh')
      assert.equal(opts.shell, false)
      assert.equal(opts.windowsHide, true)
      assert.equal(opts.timeout, 10000)
      assert.ok(args.includes('StrictHostKeyChecking=yes'))
      assert.ok(args.includes('BatchMode=yes'))
      assert.ok(args.includes('ClearAllForwardings=yes'))
      assert.ok(args.includes('-T'))
      assert.ok(args.includes('-n'))
      assert.deepEqual(args.slice(-2), ['kali@192.168.56.102', 'cat /etc/os-release'])
      assert.equal(args[args.indexOf('-i') + 1], vm.identityFile)
      done(null, 'ID=kali\nPRETTY_NAME="Kali GNU/Linux"\nVERSION_ID="2026.3"\n', '')
    },
  })
  assert.equal(count, 1)
  assert.equal(result.ok, true)
  assert.equal(result.state, 'kali-verified')
  assert.equal(result.distro.name, 'Kali GNU/Linux')
  assert.equal(result.distro.kali, true)
})

test('Linux-other identity is not falsely reported as Kali', async (t) => {
  const root = workspace(t)
  savePlatformConfig({ kaliVm: vm }, root)
  const result = await inspectKaliVm({
    root, execFileFn: (_command, _args, _opts, done) => done(null, 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04"\n', ''),
  })
  assert.equal(result.state, 'linux-verified')
  assert.equal(result.distro.kali, false)
  assert.equal(parseLinuxRelease('ID=kali\nPRETTY_NAME="Kali"\n').kali, true)
})

test('explicit SSH tool version probe invokes only catalog binary and flags', async (t) => {
  const root = workspace(t)
  savePlatformConfig({ kaliVm: vm }, root)
  let called = 0
  const result = await probeKaliVmTool('nmap', {
    root, execFileFn: (binary, args, opts, done) => {
      called++
      assert.equal(binary, 'ssh')
      assert.equal(opts.shell, false)
      assert.equal(opts.timeout, 13000)
      assert.deepEqual(args.slice(-2), ['kali@192.168.56.102', 'nmap --version'])
      done(null, 'Nmap version 7.99\n', '')
    },
  })
  assert.equal(called, 1)
  assert.equal(result.status, 'probe_verified')
  assert.match(result.version, /Nmap version/)
  assert.equal(result.capabilityVerified, false)
  assert.equal(result.executionStatus, 'not-run')
  assert.equal(result.dependencyStatus, 'not-checked')
})

test('unknown IDs, absent SSH config and unsupported tools never invoke SSH', async (t) => {
  const root = workspace(t)
  const noCall = () => { throw Error('must not execute') }
  assert.equal((await inspectKaliVm({ root, execFileFn: noCall })).state, 'not-configured')
  assert.equal((await probeKaliVmTool('nmap', { root, execFileFn: noCall })).status, 'not-configured')
  savePlatformConfig({ kaliVm: vm }, root)
  assert.equal((await probeKaliVmTool('../../bin/sh', { root, execFileFn: noCall })).status, 'unknown')
  assert.equal((await probeKaliVmTool('impacket', { root, execFileFn: noCall })).status, 'unsupported')
})

test('untrusted SSH host key and auth failures are reported without accepting hosts', async (t) => {
  const root = workspace(t)
  savePlatformConfig({ kaliVm: vm }, root)
  const failure = await inspectKaliVm({
    root, execFileFn: (_binary, _args, _opts, done) =>
      done(Object.assign(new Error('ssh exit 255'), { code: 255 }), '',
        'Host key verification failed.'),
  })
  assert.equal(failure.ok, false)
  assert.equal(failure.state, 'unreachable')
  assert.match(failure.error, /主机密钥/)
})

test('both browser client surfaces have visible Kali configuration and operations', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(src, /VMware Kali · SSH 环境/)
    assert.match(src, /op: 'kaliVmInspect'/)
    assert.match(src, /op: 'kaliVmToolProbe'/)
    assert.match(src, /kaliVm: draft\.kaliVm/)
  }
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.ok(host.includes("op === 'kaliVmInspect') return observe("))
  assert.ok(host.includes('...await inspectKaliVm(scope)'))
  assert.ok(host.includes("op === 'kaliVmToolProbe') return observedProbe(scope => probeKaliVmTool(request.id, scope))"))
})
