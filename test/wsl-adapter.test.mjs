import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeWslOutput, parseWslVerbose, discoverWslEnvironments, probeWslTool } from '../lib/redteam/adapters/wsl.js'
import { discoverEnvironments, listEnvironments } from '../lib/redteam/environment-registry.js'

const table = '* Ubuntu-22.04             Running         2\r\n'
  + '  kali-linux               Stopped         2\r\n'
  + '  Debian Testing           Stopped         1\r\n'
const tableBytes = Buffer.from('\uFEFF  NAME              STATE           VERSION\r\n' + table, 'utf16le')
const runList = (cmd, args, opts, done) => {
  assert.equal(cmd, 'wsl.exe')
  assert.deepEqual(args, ['--list', '--verbose'])
  assert.equal(opts.shell, false)
  assert.equal(opts.windowsHide, true)
  assert.equal(opts.encoding, 'buffer')
  done(null, tableBytes, Buffer.alloc(0))
}

test('handles UTF-16LE WSL output, default distribution and spaces in distro names', () => {
  assert.match(decodeWslOutput(tableBytes), /Ubuntu-22\.04/)
  const items = parseWslVerbose(tableBytes)
  assert.equal(items.length, 3)
  assert.deepEqual(items.map((d) => [d.distro, d.state, d.wslVersion]), [
    ['Ubuntu-22.04', 'running', 2],
    ['kali-linux', 'stopped', 2],
    ['Debian Testing', 'stopped', 1],
  ])
  assert.equal(items[0].isDefault, true)
  assert.equal(items[1].isDefault, false)
  assert.equal(items[0].discovery.state, 'listed')
  assert.equal(items[1].reachable, null)
})

test('explicit discovery only lists, never launches WSL distros', async () => {
  let calls = 0
  const result = await discoverEnvironments({
    platform: 'win32',
    execFileFn: (...args) => { calls++; return runList(...args) },
    dockerExecFileFn: (_cmd, _args, _opts, done) => done(null, '', ''),
  })
  assert.equal(calls, 1)
  assert.equal(result.environments.length, 4) // local + three WSL distros
  assert.equal(result.providers.wsl.state, 'listed')
  assert.equal(result.environments[0].kind, 'local')
  assert.equal(result.environments[1].kind, 'wsl')
  assert.equal(listEnvironments({ platform: 'win32' }).environments.length, 1)
})

test('non-Windows host skips WSL without spawning anything', async () => {
  const result = await discoverWslEnvironments({
    platform: 'linux',
    execFileFn: () => { throw Error('must not run') },
  })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'unsupported')
  assert.deepEqual(result.environments, [])
})

test('explicit opt-in probe executes ONLY a catalog binary and fixed version flags', async () => {
  const calls = []
  const result = await probeWslTool('kali-linux', 'nmap', {
    platform: 'win32',
    execFileFn: (command, args, options, done) => {
      calls.push(args)
      assert.equal(command, 'wsl.exe')
      assert.equal(options.shell, false)
      if (calls.length === 1) {
        assert.deepEqual(args, ['--list', '--verbose'])
        done(null, tableBytes, Buffer.alloc(0))
      } else {
        assert.deepEqual(args, ['--distribution', 'kali-linux', '--exec', 'nmap', '--version'])
        done(null, Buffer.from('Nmap version 7.98\n'), Buffer.alloc(0))
      }
    },
  })
  assert.equal(calls.length, 2)
  assert.equal(result.status, 'probe_verified')
  assert.match(result.version, /Nmap version/)
  assert.equal(result.environmentId, 'wsl:kali-linux')
  assert.equal(result.capabilityVerified, false)
  assert.equal(result.executionStatus, 'not-run')
  assert.equal(result.dependencyStatus, 'not-checked')
})

test('unsupported tool ID, unsupported version probe and unknown distro do not execute tools', async () => {
  const refuse = () => { throw new Error('must not launch WSL') }
  assert.equal((await probeWslTool('kali-linux', '../../bin/sh', {
    platform: 'win32', execFileFn: refuse,
  })).status, 'unknown')
  assert.equal((await probeWslTool('kali-linux', 'impacket', {
    platform: 'win32', execFileFn: refuse,
  })).status, 'unsupported')
  let calls = 0
  const missing = await probeWslTool('some-other-name', 'nmap', {
    platform: 'win32', execFileFn: (...args) => { calls++; return runList(...args) },
  })
  assert.equal(missing.status, 'environment-missing')
  assert.equal(calls, 1)
})

test('unparseable WSL output is never reported as no installed distributions', async () => {
  const result = await discoverWslEnvironments({
    platform: 'win32',
    execFileFn: (_command, _args, _opts, done) => done(null, Buffer.from('unparseable output'), Buffer.alloc(0)),
  })
  assert.equal(result.state, 'unparsed')
  assert.deepEqual(result.environments, [])
})

test('a missing WSL launcher is reported without claiming host availability', async () => {
  const result = await discoverWslEnvironments({
    platform: 'win32',
    execFileFn: (_command, _args, _opts, done) => {
      const err = new Error('spawn wsl.exe ENOENT')
      err.code = 'ENOENT'
      done(err, Buffer.alloc(0), Buffer.alloc(0))
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.state, 'unavailable')
})

test('both client surfaces expose the WSL discovery and explicit probe controls', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /op: 'environmentDiscover'/)
    assert.match(source, /op: 'wslToolProbe'/)
    assert.match(source, /显式验证版本/)
    assert.match(source, /显式版本检测可能启动已停止的 WSL 发行版/)
  }
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /if \(op === 'environmentDiscover'\) return diagnoseEnvironmentTopology\(\{ root \}\)/)
  assert.match(host, /if \(op === 'wslToolProbe'\) return probeWslTool\(request.distro, request.id\)/)
})
