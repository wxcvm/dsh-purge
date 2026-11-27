import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeToolInEnvironment } from '../lib/redteam/execution-adapter.js'
import { scanCommand } from '../lib/redteam/scan-runner.js'

const workspace = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-execution-adapter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const dockerId = 'a'.repeat(64)
const dockerListing = JSON.stringify({
  ID: dockerId, Names: 'kali-tools', Image: 'kali:tools',
  State: 'running', Status: 'Up 10 minutes',
}) + '\n'

test('local adapter runs only the configured binary with a shell-free argv', async (t) => {
  const root = workspace(t)
  const nmap = join(root, 'nmap.exe')
  writeFileSync(nmap, 'fixture')
  let calls = 0
  const result = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'local', args: ['-sT', '192.0.2.1'],
  }, {
    root, config: { platform: 'windows', tools: { nmap }, toolkitDir: root, binDirs: [] },
    env: { PATH: '' },
    execFileFn: (command, args, options, done) => {
      calls++
      assert.equal(command, nmap)
      assert.deepEqual(args, ['-sT', '192.0.2.1'])
      assert.equal(options.shell, false)
      done(null, '<nmaprun/>', '')
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'executed')
  assert.equal(result.environmentId, 'local')
  assert.equal(result.transport, 'local')
  assert.equal(result.attempted, true)
})

test('WSL adapter re-lists the selected distro, probes the tool, then executes fixed argv', async () => {
  const calls = []
  const result = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'wsl:Ubuntu-24.04', args: ['-sT', '192.0.2.2'],
  }, {
    platform: 'win32',
    execFileFn: (command, args, options, done) => {
      calls.push({ command, args, options })
      assert.equal(command, 'wsl.exe')
      assert.equal(options.shell, false)
      if (args[0] === '--list') return done(null, '* Ubuntu-24.04 Running 2\n', '')
      if (args.includes('--version')) return done(null, 'Nmap version 7.99\n', '')
      assert.deepEqual(args, ['--distribution', 'Ubuntu-24.04', '--exec', 'nmap', '-sT', '192.0.2.2'])
      done(null, '<nmaprun/>', '')
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(result.status, 'executed')
  assert.equal(result.transport, 'wsl')
  assert.equal(result.environmentId, 'wsl:Ubuntu-24.04')
})

test('Docker adapter requires a fresh running-container listing and a successful version probe', async () => {
  const calls = []
  const result = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'docker:' + dockerId, args: ['-sT', '192.0.2.3'],
  }, {
    execFileFn: (command, args, options, done) => {
      calls.push({ command, args, options })
      assert.equal(command, 'docker')
      assert.equal(options.shell, false)
      if (args[0] === 'ps') return done(null, dockerListing, '')
      if (args[0] === 'exec' && args[3] === '--version') return done(null, 'Nmap version 7.99\n', '')
      assert.deepEqual(args, ['exec', dockerId, 'nmap', '-sT', '192.0.2.3'])
      done(null, '<nmaprun/>', '')
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(result.status, 'executed')
  assert.equal(result.transport, 'docker')
  assert.equal(result.environmentId, 'docker:' + dockerId)
})

test('SSH adapter requires trusted Kali identity and quotes each remote argv element', async (t) => {
  const root = workspace(t)
  const config = {
    kaliVm: { host: '192.0.2.10', user: 'kali', port: 2222, identityFile: '/keys/kali_ed25519' },
  }
  const calls = []
  const result = await executeToolInEnvironment({
    toolId: 'httpx', environmentId: 'ssh:kali-vm',
    args: scanCommand('httpx', "https://example.org/?q=a'b&x=1").args,
  }, {
    root, config,
    execFileFn: (command, args, options, done) => {
      calls.push({ command, args, options })
      assert.equal(command, 'ssh')
      assert.equal(options.shell, false)
      assert.ok(args.includes('StrictHostKeyChecking=yes'))
      assert.ok(args.includes('ClearAllForwardings=yes'))
      const remote = args.at(-1)
      if (remote === 'cat /etc/os-release') return done(null, 'ID=kali\nPRETTY_NAME="Kali GNU/Linux"\n', '')
      if (remote === 'httpx-toolkit -version') return done(null, 'httpx 1.6.0\n', '')
      assert.match(remote, /^'httpx-toolkit' '-u' /)
      assert.ok(remote.includes("'\\''"), 'single quotes in URL must be shell-escaped')
      done(null, '{"url":"https://example.org/"}\n', '')
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(result.status, 'executed')
  assert.equal(result.transport, 'ssh')
  assert.equal(result.environmentId, 'ssh:kali-vm')
})

test('unverified SSH host and unsupported environment never launch a target task', async (t) => {
  const root = workspace(t)
  let calls = 0
  const result = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'ssh:kali-vm', args: ['-sT', '192.0.2.4'],
  }, {
    root, config: { kaliVm: { host: '192.0.2.10', user: 'kali', port: 22 } },
    execFileFn: (_command, _args, _options, done) => {
      calls++
      done(null, 'ID=ubuntu\nPRETTY_NAME="Ubuntu"\n', '')
    },
  })
  assert.equal(result.status, 'environment-unverified')
  assert.equal(result.attempted, false)
  assert.equal(calls, 1)
  const unsupported = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'ssh:other-host', args: ['-sT', '192.0.2.4'],
  }, { execFileFn: () => { throw Error('must not execute') } })
  assert.equal(unsupported.status, 'unsupported-environment')
  assert.equal(unsupported.attempted, false)
})

test('arbitrary tools and malformed arguments cannot reach an execution adapter', async () => {
  const noCall = () => { throw Error('must not execute') }
  const unknownTool = await executeToolInEnvironment({
    toolId: 'impacket', environmentId: 'local', args: ['secretsdump.py'],
  }, { execFileFn: noCall })
  assert.equal(unknownTool.status, 'unsupported-tool')
  const badArgs = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'local', args: ['-sT', 'bad\nargument'],
  }, { execFileFn: noCall })
  assert.equal(badArgs.status, 'invalid-arguments')
})

test('stale WSL and Docker environment IDs are rejected before target execution', async () => {
  let wslCalls = 0
  const staleWsl = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'wsl:Debian', args: ['-sT', '192.0.2.5'],
  }, {
    platform: 'win32',
    execFileFn: (_command, args, _options, done) => {
      wslCalls++
      assert.deepEqual(args, ['--list', '--verbose'])
      done(null, '* Ubuntu-24.04 Running 2\n', '')
    },
  })
  assert.equal(staleWsl.status, 'environment-missing')
  assert.equal(staleWsl.attempted, false)
  assert.equal(wslCalls, 1)

  let dockerCalls = 0
  const staleDocker = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'docker:' + 'b'.repeat(64), args: ['-sT', '192.0.2.5'],
  }, {
    execFileFn: (_command, args, _options, done) => {
      dockerCalls++
      assert.equal(args[0], 'ps')
      done(null, dockerListing, '')
    },
  })
  assert.equal(staleDocker.status, 'environment-missing')
  assert.equal(staleDocker.attempted, false)
  assert.equal(dockerCalls, 1)
})

test('remote version-probe failure blocks the actual scan invocation', async () => {
  let calls = 0
  const result = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'wsl:Ubuntu-24.04', args: ['-sT', '192.0.2.6'],
  }, {
    platform: 'win32',
    execFileFn: (_command, args, _options, done) => {
      calls++
      if (args[0] === '--list') return done(null, '* Ubuntu-24.04 Running 2\n', '')
      done(Object.assign(new Error('nmap missing'), { code: 127 }), '', 'not found')
    },
  })
  assert.equal(result.status, 'tool-not-runnable')
  assert.equal(result.attempted, false)
  assert.equal(calls, 2)
})


test('a local executable spawn failure is not recorded as a target invocation', async (t) => {
  const root = workspace(t)
  const executable = join(root, 'nmap.exe')
  writeFileSync(executable, 'fixture')
  const result = await executeToolInEnvironment({
    toolId: 'nmap', environmentId: 'local', args: ['-sT', '192.0.2.7'],
  }, {
    root,
    config: { platform: 'windows', tools: { nmap: executable }, toolkitDir: root, binDirs: [] },
    execFileFn: (_command, _args, _options, done) => {
      const error = new Error('spawn failed')
      error.code = 'ENOENT'
      done(error, '', '')
    },
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.attempted, false)
  assert.equal(result.errorCode, 'ENOENT')
})
