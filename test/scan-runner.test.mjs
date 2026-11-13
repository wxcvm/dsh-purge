import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanCommand, runDiscoveryScan, executeScanAndIngest } from '../lib/redteam/scan-runner.js'
import { listScanHistory, inspectScanArtifact } from '../lib/redteam/scan-history.js'

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
    execFileFn: (path, args, cfg, done) => {
      invoked++
      assert.equal(path, executable)
      assert.equal(cfg.shell, false)
      assert.equal(cfg.timeout, 180000)
      assert.deepEqual(args, ['-sT', '-sV', '--open', '-oX', '-', '-p', '80,443', '192.0.2.1'])
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

test('preparation is saved before the existing runner and replaced by the real final record', async (t) => {
  const root = temp(t), file = join(root, 'nmap.exe'), dir = join(root, 'runs')
  writeFileSync(file, 'fixture')
  const result = await runDiscoveryScan({ kind: 'nmap', target: '192.0.2.1', outputDir: dir }, {
    root, config: { platform: 'windows', tools: { nmap: file }, toolkitDir: root, binDirs: [] },
    env: { PATH: '' },
    execFileFn: (_bin, _args, _opt, done) => {
      const files = readdirSync(dir)
      assert.equal(files.length, 1)
      const prepared = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
      assert.equal(prepared.status, 'unfinalized')
      assert.ok(prepared.preparedAt)
      assert.equal(prepared.finishedAt, null)
      assert.equal(Object.hasOwn(prepared, 'execution'), false)
      assert.equal(Object.hasOwn(prepared, 'startedAt'), false)
      assert.equal(existsSync(join(dir, prepared.runId + '.xml')), false)
      done(null, '<nmaprun/>', '')
    },
  })
  const final = JSON.parse(readFileSync(result.manifestFile, 'utf8'))
  assert.equal(final.status, 'executed')
  assert.equal(final.execution.attempted, true)
  assert.ok(final.preparedAt)
  assert.ok(final.finishedAt)
  assert.equal(readdirSync(dir).some(name => name.endsWith('.tmp')), false)
})

test('live observation is correlated to the exact local run and disappears after completion', async t => {
  const root = temp(t), executable = join(root, 'nmap.exe'), dir = join(root, 'alpha', 'scan-output')
  writeFileSync(executable, 'fixture')
  const store = { dirOf: id => join(root,id), listEngagements: () => [{ id:'alpha' },{ id:'beta' }] }
  let complete, imported, signalImport
  const startedImport = new Promise(resolve => { signalImport = resolve })
  const pending = executeScanAndIngest({kind:'nmap',target:'192.0.2.1',outputDir:dir}, {
    root, config:{platform:'windows',tools:{nmap:executable},toolkitDir:root,binDirs:[]},
    env:{PATH:''},
    execFileFn: (_bin,_args,_opt,done) => { complete = done },
    ingest: () => new Promise(resolve => { imported = resolve; signalImport() }),
  })
  const item = listScanHistory(store,'alpha').items[0]
  assert.equal(item.status,'unfinalized')
  assert.equal(item.runtime_activity.state,'observed')
  assert.equal(item.runtime_activity.phase,'awaiting-result')
  assert.equal(item.runtime_activity.scope,'current-process')
  assert.equal((await inspectScanArtifact(store,'alpha',item.run_id)).runtime_activity.phase,'awaiting-result')
  assert.equal(listScanHistory(store,'beta').total,0)
  complete(null,'<nmaprun/>','')
  await startedImport
  const during = listScanHistory(store,'alpha').items[0]
  assert.equal(during.status,'executed')
  assert.equal(during.runtime_activity.phase,'ingestion')
  imported({ok:true,assets:1,ports:1,vulns:0})
  const result = await pending
  assert.equal(result.status,'imported')
  const after = listScanHistory(store,'alpha').items[0]
  assert.equal(after.runtime_activity.state,'not-observed')
  assert.equal(after.runtime_activity.phase,null)
})

test('failed ingestion clears local activity while preserving final failure record', async t => {
  const root = temp(t), executable = join(root,'nmap.exe'), dir = join(root,'alpha','scan-output')
  writeFileSync(executable,'fixture')
  const store = {dirOf:id=>join(root,id),listEngagements:()=>[{id:'alpha'}]}
  const result = await executeScanAndIngest({kind:'nmap',target:'192.0.2.1',outputDir:dir},{
    root, config:{platform:'windows',tools:{nmap:executable},toolkitDir:root,binDirs:[]},env:{PATH:''},
    execFileFn: (_b,_a,_o,done)=>done(null,'<nmaprun/>',''),
    ingest: ()=>{throw new Error('fixture import failed')},
  })
  assert.equal(result.status,'import-failed')
  const row = listScanHistory(store,'alpha').items[0]
  assert.equal(row.runtime_activity.state,'not-observed')
  assert.equal(row.status,'import-failed')
})
