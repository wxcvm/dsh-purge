import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseDockerPs, discoverDockerEnvironments, probeDockerTool,
} from '../lib/redteam/adapters/docker.js'
import { discoverEnvironments } from '../lib/redteam/environment-registry.js'

const containerId = 'a'.repeat(64)
const sample = JSON.stringify({
  ID: containerId, Names: 'kali-tools', Image: 'kali:tools',
  State: 'running', Status: 'Up 10 minutes',
}) + '\n'
const expectedList = ['ps', '--no-trunc', '--filter', 'status=running', '--format', '{{json .}}']

function listDocker(command, args, opts, done) {
  assert.equal(command, 'docker')
  assert.deepEqual(args, expectedList)
  assert.equal(opts.shell, false)
  assert.equal(opts.windowsHide, true)
  done(null, sample, '')
}

test('Docker JSON lines only recognize running container IDs and never trust names as targets', () => {
  const data = parseDockerPs(
    sample + sample +
    JSON.stringify({ ID: 'b'.repeat(64), Names: 'stopped', State: 'exited', Image: 'test' }) + '\n' +
    JSON.stringify({ ID: '-v /etc', Names: 'injected', State: 'running' }) + '\n')
  assert.equal(data.environments.length, 1)
  assert.equal(data.rejected, 2)
  assert.equal(data.environments[0].id, 'docker:' + containerId)
  assert.equal(data.environments[0].containerId, containerId)
  assert.equal(data.environments[0].image, 'kali:tools')
  assert.equal(data.environments[0].reachable, null)
})

test('environment discovery lists running Docker containers without executing inside them', async () => {
  let commands = 0
  const result = await discoverEnvironments({
    platform: 'linux', config: { kaliVm: {} },
    dockerExecFileFn: (...args) => { commands++; return listDocker(...args) },
  })
  assert.equal(commands, 1)
  assert.equal(result.providers.docker.state, 'listed')
  assert.equal(result.environments.length, 2)
  assert.equal(result.environments[1].containerId, containerId)
  assert.equal(result.environments[1].discovery.state, 'listed')
})

test('Docker unavailable and missing daemon are not reported as no containers', async () => {
  const missing = await discoverDockerEnvironments({
    execFileFn: (_cmd, _args, _opts, done) =>
      done(Object.assign(new Error('docker ENOENT'), { code: 'ENOENT' }), '', ''),
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.state, 'unavailable')
  assert.match(missing.note, /未找到 Docker CLI/)
  const daemon = await discoverDockerEnvironments({
    execFileFn: (_cmd, _args, _opts, done) => done(new Error('exit code 1'), '', 'cannot connect to Docker daemon'),
  })
  assert.equal(daemon.ok, false)
  assert.equal(daemon.state, 'unavailable')
  const empty = await discoverDockerEnvironments({
    execFileFn: (_cmd, _args, _opts, done) => done(null, '', ''),
  })
  assert.equal(empty.ok, true)
  assert.equal(empty.state, 'empty')
  const invalid = await discoverDockerEnvironments({
    execFileFn: (_cmd, _args, _opts, done) => done(null, 'not JSON\n', ''),
  })
  assert.equal(invalid.state, 'unparsed')
})

test('version probe requires a freshly listed running container and fixed catalog binary', async () => {
  const calls = []
  const result = await probeDockerTool(containerId, 'nmap', {
    execFileFn: (command, args, opts, done) => {
      calls.push({ command, args })
      assert.equal(opts.shell, false)
      if (calls.length === 1) return listDocker(command, args, opts, done)
      assert.equal(command, 'docker')
      assert.deepEqual(args, ['exec', containerId, 'nmap', '--version'])
      done(null, 'Nmap version 7.99\n', '')
    },
  })
  assert.equal(calls.length, 2)
  assert.equal(result.status, 'probe_verified')
  assert.equal(result.version, 'Nmap version 7.99')
  assert.equal(result.environmentId, 'docker:' + containerId)
  assert.equal(result.capabilityVerified, false)
  assert.equal(result.executionStatus, 'not-run')
  assert.equal(result.dependencyStatus, 'not-checked')
})

test('unknown and unsupported tools cannot launch Docker; an unlisted container cannot be entered', async () => {
  const noCalls = () => { throw Error('should not run Docker') }
  assert.equal((await probeDockerTool(containerId, '../../bin/sh', { execFileFn: noCalls })).status, 'unknown')
  assert.equal((await probeDockerTool(containerId, 'impacket', { execFileFn: noCalls })).status, 'unsupported')
  let requests = 0
  const missing = await probeDockerTool('b'.repeat(64), 'nmap', {
    execFileFn: (...args) => { requests++; return listDocker(...args) },
  })
  assert.equal(requests, 1)
  assert.equal(missing.status, 'environment-missing')
})

test('Docker probe errors are reported, not promoted to verified', async () => {
  const result = await probeDockerTool(containerId, 'nmap', {
    execFileFn: (cmd, args, opts, done) => {
      if (args[0] === 'ps') return listDocker(cmd, args, opts, done)
      done(new Error('exit 127'), '', 'executable file not found')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'degraded')
  assert.equal(result.capabilityVerified, false)
})

test('actual host bridge, source UI and embedded client expose Docker discovery and probe', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /op === 'dockerToolProbe'/)
  assert.match(host, /probeDockerTool\(request\.containerId, request\.id\)/)
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /Docker · 已运行容器/)
    assert.match(source, /op: 'dockerToolProbe'/)
    assert.match(source, /显式验证版本/)
  }
})


test('malformed Docker rows do not block explicit probes of valid running containers', async () => {
  const mixed = sample + 'not valid JSON\n'
  const listed = await discoverDockerEnvironments({
    execFileFn: (_cmd, _args, _opts, done) => done(null, mixed, ''),
  })
  assert.equal(listed.state, 'partial')
  assert.equal(listed.ok, true)
  assert.equal(listed.environments.length, 1)

  let count = 0
  const probe = await probeDockerTool(containerId, 'nmap', {
    execFileFn: (cmd, args, opts, done) => {
      count++
      if (args[0] === 'ps') return done(null, mixed, '')
      assert.deepEqual(args, ['exec', containerId, 'nmap', '--version'])
      // Some tools write version output to stderr even on a successful exit.
      done(null, '', 'Nmap version 7.99 from stderr\n')
    },
  })
  assert.equal(count, 2)
  assert.equal(probe.status, 'probe_verified')
  assert.equal(probe.version, 'Nmap version 7.99 from stderr')
  assert.equal(probe.capabilityVerified, false)
  assert.equal(probe.executionStatus, 'not-run')
})

test('null JSON records and paused containers are not treated as running', () => {
  const paused = JSON.stringify({
    ID: 'b'.repeat(64), Names: 'paused-tools', Image: 'kali:tools',
    State: 'running', Status: 'Up 1m (Paused)',
  })
  const parsed = parseDockerPs('null\n' + paused + '\n')
  assert.equal(parsed.environments.length, 0)
  assert.equal(parsed.rejected, 2)
})

test('WSL and Docker discovery are started concurrently without touching containers', async () => {
  let finishWsl
  let finishDocker
  const discovering = discoverEnvironments({
    platform: 'win32', config: { kaliVm: {} },
    execFileFn: (_cmd, _args, _opts, done) => { finishWsl = done },
    dockerExecFileFn: (_cmd, args, _opts, done) => {
      assert.deepEqual(args, expectedList)
      finishDocker = done
    },
  })
  assert.equal(typeof finishWsl, 'function')
  assert.equal(typeof finishDocker, 'function')
  finishDocker(null, sample, '')
  finishWsl(null, '', '')
  const result = await discovering
  assert.equal(result.providers.docker.state, 'listed')
  assert.equal(result.environments.length, 2)
})

test('Docker httpx probe falls through catalogued binary aliases', async () => {
  const calls = []
  const result = await probeDockerTool(containerId, 'httpx', {
    execFileFn: (_command, args, _opts, done) => {
      calls.push(args)
      if (args[0] === 'ps') return done(null, sample, '')
      if (args[2] === 'httpx-toolkit') return done(Object.assign(new Error('not found'), { code: 127 }), '', 'not found')
      assert.deepEqual(args, ['exec', containerId, 'pd-httpx', '-version'])
      done(null, 'httpx 1.6.0\\n', '')
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(result.status, 'probe_verified')
  assert.equal(result.binary, 'pd-httpx')
})
