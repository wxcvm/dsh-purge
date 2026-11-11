import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseRunningContainers, discoverDockerEnvironments, probeDockerTool } from '../lib/redteam/adapters/docker.js'
import { discoverEnvironments } from '../lib/redteam/environment-registry.js'

const one = '0123456789abcdef'.repeat(4)
const two = 'abcdef0123456789'.repeat(4)
const listing = [
  JSON.stringify({ ID: one, Names: 'kali-tools', Image: 'kali:rolling', State: 'running', Status: 'Up 2h' }),
  JSON.stringify({ ID: two, Names: 'site-demo', Image: 'nginx:alpine', State: 'running', Status: 'Up 10m' }),
].join('\n') + '\n'
const expectedListArgs = [
  'container', 'ls', '--no-trunc', '--filter', 'status=running', '--format', '{{json .}}',
]
const listStub = (command, args, opts, done) => {
  assert.equal(command, 'docker')
  assert.deepEqual(args, expectedListArgs)
  assert.equal(opts.shell, false)
  assert.equal(opts.windowsHide, true)
  assert.ok(opts.timeout <= 6500)
  done(null, listing, '')
}

test('Docker list parses running IDs only, without confusing discovery and capability', () => {
  const items = parseRunningContainers(listing)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((item) => item.id), ['docker:' + one, 'docker:' + two])
  assert.equal(items[0].label, 'kali-tools')
  assert.equal(items[0].image, 'kali:rolling')
  assert.equal(items[0].state, 'running')
  assert.equal(items[0].reachable, null)
  assert.equal(items[0].discovery.state, 'listed')
  assert.deepEqual(parseRunningContainers([
    JSON.stringify({ ID: one, Names: 'running', State: 'running', Status: 'Up 2h' }),
    JSON.stringify({ ID: one, Names: 'duplicate', State: 'running', Status: 'Up 2h' }),
    JSON.stringify({ ID: two, Names: 'paused', State: 'paused', Status: 'Up (Paused)' }),
    '{"ID":broken json',
    JSON.stringify({ ID: '-name', Names: 'bad', State: 'running' }),
  ].join('\n')).map((item) => item.label), ['running'])
})

test('explicit Docker discovery only lists running containers and never starts images', async () => {
  let calls = 0
  const result = await discoverDockerEnvironments({
    dockerExecFileFn: (...args) => { calls++; return listStub(...args) },
  })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'listed')
  assert.equal(result.environments.length, 2)
  assert.equal(calls, 1)
})

test('combined environment discovery lists current host, WSL state and Docker separately', async () => {
  const result = await discoverEnvironments({
    platform: 'linux',
    dockerExecFileFn: listStub,
  })
  assert.equal(result.ok, true)
  assert.equal(result.environments.length, 3)
  assert.equal(result.environments[0].id, 'local')
  assert.equal(result.environments[1].id, 'docker:' + one)
  assert.equal(result.providers.wsl.state, 'unsupported')
  assert.equal(result.providers.docker.state, 'listed')
})

test('opt-in version probe only uses catalog binary and no flags for elevation or shell', async () => {
  const commands = []
  const result = await probeDockerTool(one, 'nmap', {
    dockerExecFileFn: (command, args, opts, done) => {
      commands.push(args)
      assert.equal(command, 'docker')
      assert.equal(opts.shell, false)
      if (commands.length === 1) {
        assert.deepEqual(args, expectedListArgs)
        done(null, listing, '')
      } else {
        assert.deepEqual(args, ['container', 'exec', one, 'nmap', '--version'])
        assert.equal(args.includes('--privileged'), false)
        assert.equal(args.includes('-i'), false)
        assert.equal(args.includes('-t'), false)
        done(null, 'Nmap version 7.99\n', '')
      }
    },
  })
  assert.equal(commands.length, 2)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'probe_verified')
  assert.equal(result.version, 'Nmap version 7.99')
  assert.equal(result.environmentId, 'docker:' + one)
  assert.equal(result.capabilityVerified, false)
  assert.equal(result.dependencyStatus, 'not-checked')
  assert.equal(result.executionStatus, 'not-run')
})

test('missing, stopped or injected container IDs cannot be executed', async () => {
  const noCall = () => { throw new Error('unexpected Docker invocation') }
  const invalid = await probeDockerTool('--privileged', 'nmap', { dockerExecFileFn: noCall })
  assert.equal(invalid.status, 'invalid-container')
  const unknown = await probeDockerTool(one, '../../sh', { dockerExecFileFn: noCall })
  assert.equal(unknown.status, 'unknown')
  const unsupported = await probeDockerTool(one, 'impacket', { dockerExecFileFn: noCall })
  assert.equal(unsupported.status, 'unsupported')
  let calls = 0
  const gone = await probeDockerTool('f'.repeat(64), 'nmap', {
    dockerExecFileFn: (...args) => { calls++; return listStub(...args) },
  })
  assert.equal(gone.status, 'container-missing')
  assert.equal(calls, 1)
})

test('Docker daemon failures, no CLI and unknown output are not reported as no containers', async () => {
  const missing = await discoverDockerEnvironments({
    dockerExecFileFn: (_command, _args, _opts, done) => {
      const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      done(error, '', '')
    },
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.state, 'unavailable')
  const failed = await discoverDockerEnvironments({
    dockerExecFileFn: (_command, _args, _opts, done) =>
      done(new Error('daemon unavailable'), '', 'daemon unavailable'),
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.state, 'failed')
  const unparsed = await discoverDockerEnvironments({
    dockerExecFileFn: (_command, _args, _opts, done) =>
      done(null, 'not valid JSON\n', ''),
  })
  assert.equal(unparsed.state, 'unparsed')
  const none = await discoverDockerEnvironments({
    dockerExecFileFn: (_command, _args, _opts, done) => done(null, '', ''),
  })
  assert.equal(none.state, 'none')
})

test('Docker probe failure stays distinct from success', async () => {
  const result = await probeDockerTool(one, 'nmap', {
    dockerExecFileFn: (command, args, opts, done) => {
      if (args[1] === 'ls') return done(null, listing, '')
      done(new Error('not installed'), '', 'executable file not found')
    },
  })
  assert.equal(result.status, 'degraded')
  assert.equal(result.capabilityVerified, false)
  assert.equal(result.executionStatus, 'not-run')
})

test('both client surfaces expose real Docker controls and host routes', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /Docker · 运行中容器/)
    assert.match(source, /op: 'dockerToolProbe'/)
    assert.match(source, /验证容器工具版本/)
    assert.match(source, /item\.containerId/)
  }
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /if \(op === 'dockerToolProbe'\) return probeDockerTool\(request\.containerId, request\.id\)/)
})
