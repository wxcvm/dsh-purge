import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanCommand, runDiscoveryScan, executeScanAndIngest } from '../lib/redteam/scan-runner.js'

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), 'redteam-scan-run-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('Nmap and httpx command arrays are explicit and contain no shell', () => {
  assert.deepEqual(scanCommand('nmap', '192.0.2.1', { ports: '80,443' }).args,
    ['-sT', '-sV', '--open', '-oX', '-', '-p', '80,443', '192.0.2.1'])
  assert.deepEqual(scanCommand('httpx', 'https://example.org').args,
    ['-u', 'https://example.org', '-json', '-silent'])
  assert.throws(() => scanCommand('nmap', '-oX /tmp/file'), /target/)
  assert.throws(() => scanCommand('nmap', 'host;whoami'), /hostname/)
  assert.throws(() => scanCommand('nmap', 'example.org', { ports: '80;whoami' }), /ports/)
  assert.throws(() => scanCommand('httpx', 'file:///etc/passwd'), /HTTP/)
})

test('running a local scanner preserves raw output and verifiable metadata', async (t) => {
  const root = temp(t)
  const executable = join(root, 'nmap.exe')
  writeFileSync(executable, 'fixture')
  let invoked = 0
  const run = await runDiscoveryScan({
    kind: 'nmap', target: '192.0.2.1', ports: '80,443', outputDir: join(root, 'records'),
  }, {
    root, config: { platform: 'windows', tools: { nmap: executable }, toolkitDir: root, binDirs: [] },
    env: { PATH: '' },
    /* 这些用例注入 execFileFn、不真正发包；显式声明"无隧道网卡"，
       否则守卫会按宿主真实环境（FlClash TUN）把扫描拦下。 */
    interfaces: () => ({}),
    execFileFn: (path, args, cfg, done) => {
      invoked++
      assert.equal(path, executable)
      assert.equal(cfg.shell, false)
      assert.equal(cfg.timeout, 180000)
      assert.equal(args.at(-1), '192.0.2.1')
      done(null, '<nmaprun><host></host></nmaprun>', '')
    },
  })
  assert.equal(invoked, 1)
  assert.equal(run.status, 'executed')
  assert.equal(run.ok, true)
  assert.match(readFileSync(run.outputFile, 'utf8'), /nmaprun/)
  const manifest = JSON.parse(readFileSync(run.manifestFile, 'utf8'))
  assert.equal(manifest.sha256, run.sha256)
  assert.equal(manifest.target, '192.0.2.1')
  assert.equal(manifest.source, 'config')
  assert.equal(manifest.execution.environmentId, 'local')
  assert.equal(manifest.execution.transport, 'local')
  assert.equal(manifest.execution.executionId, run.runId)
  assert.equal(manifest.execution.toolId, 'nmap')
  assert.equal(manifest.execution.attempted, true)
  assert.equal(manifest.execution.resultStatus, 'executed')
})

test('failed execution preserves diagnostics but never invokes ingestion', async (t) => {
  const root = temp(t), file = join(root, 'httpx.exe')
  writeFileSync(file, 'fixture')
  const result = await executeScanAndIngest({
    kind: 'httpx', target: 'https://example.org', outputDir: join(root, 'runs'),
  }, {
    root, config: { platform: 'windows', tools: { httpx: file }, toolkitDir: root, binDirs: [] },
    env: { PATH: '' },
    /* 这些用例注入 execFileFn、不真正发包；显式声明"无隧道网卡"，
       否则守卫会按宿主真实环境（FlClash TUN）把扫描拦下。 */
    interfaces: () => ({}),
    execFileFn: (_bin, _argv, _cfg, done) => done(new Error('binary exited 1'), '', 'bad input'),
    ingest: () => { throw new Error('must not ingest failed run') },
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.equal(result.ingested, false)
  assert.equal(JSON.parse(readFileSync(result.manifestFile, 'utf8')).status, 'failed')
})

test('successful run reuses ingestion and records the outcome on the same manifest', async (t) => {
  const root = temp(t), file = join(root, 'httpx.exe')
  writeFileSync(file, 'fixture')
  let calls = 0
  const result = await executeScanAndIngest({
    kind: 'httpx', target: 'https://example.org', outputDir: join(root, 'runs'),
  }, {
    root, config: { platform: 'windows', tools: { httpx: file }, toolkitDir: root, binDirs: [] },
    env: { PATH: '' },
    /* 这些用例注入 execFileFn、不真正发包；显式声明"无隧道网卡"，
       否则守卫会按宿主真实环境（FlClash TUN）把扫描拦下。 */
    interfaces: () => ({}),
    execFileFn: (_bin, args, cfg, done) => {
      assert.deepEqual(args, ['-u', 'https://example.org', '-json', '-silent'])
      done(null, '{"url":"https://example.org","port":443}\n', '')
    },
    ingest: ({ file, kind, argv, commit }) => {
      calls++
      assert.equal(kind, 'httpx')
      assert.equal(commit, true)
      assert.equal(argv[0], '-u')
      assert.match(readFileSync(file, 'utf8'), /example.org/)
      return { ok: true, assets: 1, ports: 1, imported: { scan_run_id: 7 } }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'imported')
  assert.equal(result.ingested, true)
  const manifest = JSON.parse(readFileSync(result.manifestFile, 'utf8'))
  assert.equal(manifest.ingested, true)
  assert.equal(manifest.ingestion.imported.scan_run_id, 7)
})

test('scanner output without recognized findings never reports a successful import', async (t) => {
  const root = temp(t), file = join(root, 'nmap.exe')
  writeFileSync(file, 'fixture')
  const result = await executeScanAndIngest({
    kind: 'nmap', target: '192.0.2.99', outputDir: join(root, 'runs'),
  }, {
    root, config: { platform: 'windows', tools: { nmap: file }, toolkitDir: root, binDirs: [] },
    env: { PATH: '' },
    /* 这些用例注入 execFileFn、不真正发包；显式声明"无隧道网卡"，
       否则守卫会按宿主真实环境（FlClash TUN）把扫描拦下。 */
    interfaces: () => ({}),
    execFileFn: (_bin, _argv, _cfg, done) => done(null, '<nmaprun></nmaprun>', ''),
    ingest: () => ({ ok: true, assets: 0, ports: 0, vulns: 0 }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'no-findings')
  assert.equal(result.ingested, false)
  assert.equal(JSON.parse(readFileSync(result.manifestFile, 'utf8')).status, 'no-findings')
})

test('opt-in low-impact Nmap uses fewer service probes and a configured timeout', async (t) => {
  const root = temp(t), executable = join(root, 'nmap.exe')
  writeFileSync(executable, 'fixture')
  const result = await runDiscoveryScan({
    kind: 'nmap', target: '192.0.2.10', outputDir: join(root, 'runs'),
  }, {
    root, config: { platform: 'windows', tools: { nmap: executable }, toolkitDir: root, binDirs: [],
      scanPreferences: { mode: 'low-impact', timeoutSeconds: 60, captureDiagnostics: false } },
    env: { PATH: '' },
    /* 这些用例注入 execFileFn、不真正发包；显式声明"无隧道网卡"，
       否则守卫会按宿主真实环境（FlClash TUN）把扫描拦下。 */
    interfaces: () => ({}),
    execFileFn: (path, argv, opt, callback) => {
      assert.deepEqual(argv, ['-sT', '--open', '-oX', '-', '--max-retries', '1', '192.0.2.10'])
      assert.equal(opt.timeout, 60000)
      const error = new Error('secret local filename')
      error.code = 2
      callback(error, '<nmaprun/>', 'some secret stderr')
    },
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.scanPreferences.mode, 'low-impact')
  assert.equal(result.scanPreferences.captureDiagnostics, false)
  assert.equal(result.stderr, '')
  assert.equal(result.error, 'scanner-exit-2')
  assert.match(readFileSync(result.outputFile, 'utf8'), /nmaprun/)
  assert.equal(JSON.parse(readFileSync(result.manifestFile, 'utf8')).stderr, '')
})

test('standard scan arguments remain unchanged if no preference was enabled', () => {
  assert.deepEqual(scanCommand('nmap', '192.0.2.10').args,
    ['-sT', '-sV', '--open', '-oX', '-', '192.0.2.10'])
})

test('optional reverse DNS suppression only changes Nmap when enabled', () => {
  assert.deepEqual(scanCommand('nmap', '192.0.2.10', { noReverseDns: true }).args,
    ['-sT', '-sV', '--open', '-oX', '-', '-n', '192.0.2.10'])
  assert.deepEqual(scanCommand('httpx', 'https://192.0.2.10', { noReverseDns: true }).args,
    ['-u', 'https://192.0.2.10', '-json', '-silent'])
})


test('selected WSL environment is revalidated and recorded in the scan manifest', async (t) => {
  const root = temp(t)
  const calls = []
  const run = await runDiscoveryScan({
    kind: 'nmap', target: '192.0.2.50', environmentId: 'wsl:Ubuntu-24.04',
    outputDir: join(root, 'records'),
  }, {
    platform: 'win32',
    interfaces: () => ({}),
    execFileFn: (command, args, options, done) => {
      calls.push({ command, args })
      assert.equal(command, 'wsl.exe')
      assert.equal(options.shell, false)
      if (args[0] === '--list') return done(null, '* Ubuntu-24.04 Running 2\n', '')
      if (args.includes('--version')) return done(null, 'Nmap version 7.99\n', '')
      assert.deepEqual(args, ['--distribution', 'Ubuntu-24.04', '--exec', 'nmap',
        '-sT', '-sV', '--open', '-oX', '-', '192.0.2.50'])
      done(null, '<nmaprun><host></host></nmaprun>', '')
    },
  })
  assert.equal(calls.length, 3)
  assert.equal(run.status, 'executed')
  assert.equal(run.environmentId, 'wsl:Ubuntu-24.04')
  assert.equal(run.execution.environmentId, 'wsl:Ubuntu-24.04')
  assert.equal(run.execution.transport, 'wsl')
  assert.equal(run.execution.attempted, true)
  const manifest = JSON.parse(readFileSync(run.manifestFile, 'utf8'))
  assert.equal(manifest.environmentId, 'wsl:Ubuntu-24.04')
  assert.equal(manifest.execution.transport, 'wsl')
})


test('host TUN guard blocks WSL target execution before probing or scanning', async (t) => {
  const root = temp(t)
  let calls = 0
  const result = await runDiscoveryScan({ kind: 'nmap', target: '192.0.2.60', environmentId: 'wsl:Ubuntu-24.04', outputDir: join(root, 'records') }, {
    platform: 'win32',
    interfaces: () => ({ FlClash: [{ address: '198.18.0.1', family: 'IPv4' }] }),
    execFileFn: () => { calls++ },
  })
  assert.equal(result.status, 'tunnel-detected')
  assert.equal(result.execution.attempted, false)
  assert.equal(calls, 0)
})

test('SSH Kali scan records remote egress as unverified despite a host TUN', async (t) => {
  const root = temp(t)
  const run = await runDiscoveryScan({ kind: 'httpx', target: 'https://example.org', environmentId: 'ssh:kali-vm', outputDir: join(root, 'records') }, {
    root, config: { kaliVm: { host: '192.0.2.10', user: 'kali', port: 22 } },
    interfaces: () => ({ FlClash: [{ address: '198.18.0.1', family: 'IPv4' }] }),
    execFileFn: (_command, args, _options, done) => {
      const remote = args.at(-1)
      if (remote === 'cat /etc/os-release') return done(null, 'ID=kali\nPRETTY_NAME="Kali GNU/Linux"\n', '')
      if (remote.includes('-version')) return done(null, 'httpx 1.6.0\n', '')
      done(null, '{"url":"https://example.org/"}\n', '')
    },
  })
  assert.equal(run.status, 'executed')
  assert.equal(run.scanEnvironment.scope, 'remote-ssh')
  assert.match(run.scanEnvironment.warning, /远端出站路由未由本机检查/)
})
