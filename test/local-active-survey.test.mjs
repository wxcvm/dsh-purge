import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLocalActiveDiscovery, parseLocalDiscovery } from '../lib/redteam/local-active-survey.js'
import { summarizeProtection } from '../lib/redteam/privacy-posture.js'
import { dispatch, dispatchAsync } from '../lib/redteam/store-core.js'

function fixture(t, scope = ['192.0.2.10']) {
  const root = mkdtempSync(join(tmpdir(), 'redteam-active-survey-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const executable = join(root, 'nmap.exe')
  writeFileSync(executable, 'mock')
  const imported = []
  const store = {
    root, listEngagements: () => [{ id: 'example', scope }],
    activeEngagementId: () => 'example', dirOf: () => join(root, 'example'),
    importBundle: (id, bundle) => {
      imported.push({ id, bundle })
      return { assets: bundle.assets.length, ports: bundle.assets.reduce((n, a) => n + a.ports.length, 0),
        scan_run_id: 7 }
    },
  }
  return { root, store, imported, scan: {
    config: { platform: 'windows', tools: { nmap: executable }, toolkitDir: root, binDirs: [],
      scanPreferences: { mode: 'low-impact', timeoutSeconds: 60, noReverseDns: true } },
    env: { PATH: '' },
    /* 注入式单元测试不真发包；显式声明"无隧道网卡"，避免守卫按宿主真实环境拦截。 */
    interfaces: () => ({}),
    execFileFn: (_exe, argv, options, cb) => {
      assert.deepEqual(argv,
        ['-sT', '--open', '-oX', '-', '--max-retries', '1', '-n', '-p', '80,443', '192.0.2.10'])
      assert.equal(options.timeout, 60000)
      cb(null, '<nmaprun><host><address addr="192.0.2.10" addrtype="ipv4"/>'
        + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
        + '<service name="https" product="nginx" version="1.24"/></port>'
        + '<port protocol="tcp" portid="80"><state state="closed"/></port>'
        + '</ports></host></nmaprun>', '')
    },
  } }
}

test('single-host active survey runs local Nmap, imports discovered evidence and saves history', async (t) => {
  const { root, store, imported, scan } = fixture(t)
  const result = await runLocalActiveDiscovery(store, {
    engagement: 'example', kind: 'nmap', target: '192.0.2.10',
    ports: '80,443', commit: true,
  }, scan)
  assert.equal(result.ok, true)
  assert.equal(result.scope, 'ip-matched')
  assert.equal(result.status, 'imported')
  assert.equal(result.assets, 1)
  assert.equal(result.ports, 1)
  assert.equal(result.ingested, true)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].id, 'example')
  assert.equal(imported[0].bundle.assets[0].ip, '192.0.2.10')
  assert.equal(imported[0].bundle.assets[0].ports[0].product, 'nginx')
  const saved = JSON.parse(readFileSync(result.manifest_file, 'utf8'))
  assert.equal(saved.status, 'imported')
  assert.equal(saved.scanPreferences.noReverseDns, true)
  assert.equal(saved.ingestion.ports, 1)
})

test('multi-host Nmap output imports only IPs explicitly in scope for an IP target', async (t) => {
  const { store, imported, scan } = fixture(t, ['192.0.2.10'])
  const output = '<nmaprun>'
    + '<host><address addr="192.0.2.10" addrtype="ipv4"/>'
    + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
    + '<service name="https" product="nginx"/></port></ports></host>'
    + '<host><address addr="192.0.2.11" addrtype="ipv4"/>'
    + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
    + '<service name="https" product="apache"/></port></ports></host>'
    + '</nmaprun>'
  const result = await runLocalActiveDiscovery(store, {
    engagement: 'example', kind: 'nmap', target: '192.0.2.10',
    ports: '80,443', commit: true,
  }, { ...scan, execFileFn: (_exe, _argv, _options, cb) => cb(null, output, '') })
  assert.equal(result.assets, 1)
  assert.equal(imported.length, 1)
  assert.deepEqual(imported[0].bundle.assets.map(asset => asset.ip), ['192.0.2.10'])
})

test('preview is the default and never writes assets; out-of-scope is rejected before scanning', async (t) => {
  const { store, imported, scan } = fixture(t)
  const preview = await runLocalActiveDiscovery(store, {
    kind: 'nmap', engagement: 'example', target: '192.0.2.10', ports: '80,443',
  }, scan)
  assert.equal(preview.ok, true)
  assert.equal(preview.status, 'previewed')
  assert.equal(preview.ingested, false)
  assert.equal(imported.length, 0)
  await assert.rejects(() => runLocalActiveDiscovery(store, {
    kind: 'nmap', target: '198.51.100.11', ports: '80,443',
  }, { ...scan, execFileFn: () => { throw Error('should never execute') } }), /范围内/)
  assert.equal(imported.length, 0)
})

test('empty scope needs explicit confirmation, with no extension to batch scans', async (t) => {
  const { store, scan } = fixture(t, [])
  await assert.rejects(() => runLocalActiveDiscovery(store, {
    kind: 'nmap', target: '192.0.2.10', ports: '80,443',
  }, scan), /确认/)
  const confirmed = await runLocalActiveDiscovery(store, {
    kind: 'nmap', target: '192.0.2.10', ports: '80,443', confirm: true,
  }, scan)
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.scope, 'scope-empty-confirmed')
  const bad = await dispatchAsync(store, {
    op: 'localActiveSurvey', engagement: 'example', kind: 'nmap',
    target: '192.0.2.10; invalid', confirm: true,
  })
  assert.equal(bad.ok, false)
})

test('hostname-only scope does not authorize importing its resolved IP as an asset', async t => {
  const { store, imported, scan } = fixture(t, ['example.test'])
  const output = '<nmaprun><host><address addr="192.0.2.50" addrtype="ipv4"/>'
    + '<hostnames><hostname name="example.test" type="user"/></hostnames>'
    + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
    + '<service name="https" product="nginx"/></port></ports></host></nmaprun>'
  const result = await runLocalActiveDiscovery(store, {
    engagement: 'example', kind: 'nmap', target: 'example.test',
    ports: '80,443', commit: true,
  }, { ...scan, execFileFn: (_exe, argv, _options, cb) => {
    assert.equal(argv.at(-1), 'example.test')
    cb(null, output, '')
  } })
  assert.equal(result.ok, true)
  assert.equal(result.scope, 'name-only')
  assert.equal(result.assets, 0)
  assert.equal(result.ports, 0)
  assert.match(result.note, /IP\/CIDR/)
  assert.equal(imported.length, 0)
  assert.ok(result.output_file, 'raw scan output remains available for manual review')
})

test('empty-scope confirmation of a hostname still cannot import its resolved IPs', async t => {
  const { store, imported, scan } = fixture(t, [])
  const output = '<nmaprun><host><address addr="192.0.2.51" addrtype="ipv4"/>'
    + '<hostnames><hostname name="example.test" type="user"/></hostnames>'
    + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
    + '<service name="https" product="nginx"/></port></ports></host></nmaprun>'
  const result = await runLocalActiveDiscovery(store, {
    engagement: 'example', kind: 'nmap', target: 'example.test',
    ports: '80,443', confirm: true, commit: true,
  }, { ...scan, execFileFn: (_exe, _argv, _options, cb) => cb(null, output, '') })
  assert.equal(result.ok, true)
  assert.equal(result.scope, 'scope-empty-confirmed')
  assert.equal(result.assets, 0)
  assert.match(result.note, /IP\/CIDR/)
  assert.equal(imported.length, 0)
})

test('hostname scope plus an explicit matching IP/CIDR rule can import the resolved asset', async t => {
  const { store, imported, scan } = fixture(t, ['example.test', '192.0.2.0/24'])
  const output = '<nmaprun><host><address addr="192.0.2.50" addrtype="ipv4"/>'
    + '<hostnames><hostname name="example.test" type="user"/></hostnames>'
    + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
    + '<service name="https" product="nginx"/></port></ports></host></nmaprun>'
  const result = await runLocalActiveDiscovery(store, {
    engagement: 'example', kind: 'nmap', target: 'example.test',
    ports: '80,443', commit: true,
  }, { ...scan, execFileFn: (_exe, argv, _options, cb) => {
    assert.equal(argv.at(-1), 'example.test')
    cb(null, output, '')
  } })
  assert.equal(result.assets, 1)
  assert.equal(imported.length, 1)
  assert.equal(imported[0].bundle.assets[0].ip, '192.0.2.50')
})

test('Nmap parser retains bounded host records, names, service versions and CPE evidence', () => {
  const observed = parseLocalDiscovery('nmap',
    '<nmaprun>'
    + '<host><address addr="192.0.2.21" addrtype="ipv4"/>'
    + '<hostnames><hostname name="edge.example.test" type="user"/></hostnames>'
    + '<ports><port protocol="tcp" portid="443"><state state="open"/>'
    + '<service name="https" product="nginx" version="1.24">'
    + '<cpe>cpe:/a:nginx:nginx:1.24</cpe></service></port></ports></host>'
    + '<host><address addr="192.0.2.22" addrtype="ipv4"/>'
    + '<hostnames><hostname name="api.example.test" type="user"/></hostnames>'
    + '<ports><port protocol="tcp" portid="8443"><state state="open"/>'
    + '<service name="https" product="caddy" version="2.8"/></port></ports></host>'
    + '</nmaprun>', 'example.test')
  assert.equal(observed.length, 2)
  assert.deepEqual(observed.map(asset => asset.ip), ['192.0.2.21', '192.0.2.22'])
  assert.equal(observed[0].primary_name, 'example.test')
  assert.ok(observed[0].names.some(item => item.name === 'edge.example.test'))
  assert.equal(observed[0].ports[0].cpe, 'cpe:/a:nginx:nginx:1.24')
  assert.equal(observed[0].ports[0].fingerprints[0].evidence, 'cpe:/a:nginx:nginx:1.24')
  assert.equal(observed[1].ports[0].version, '2.8')
})

test('HTTPx parser expands address arrays, normalizes hostnames and merges same-port evidence', () => {
  const observed = parseLocalDiscovery('httpx',
    JSON.stringify({ url: 'https://a.example.test/', ip: '192.0.2.20',
      a: ['192.0.2.20', '192.0.2.21'], title: 'App Home',
      tech: ['nginx'], webserver: 'nginx', status_code: 200 })
    + '\n' + JSON.stringify({ url: 'https://a.example.test/', ip: '192.0.2.20',
      a: ['192.0.2.20'], tech: ['React'] })
    + '\n' + JSON.stringify({ url: 'https://elsewhere.test', ip: '198.51.100.12',
      a: ['198.51.100.12'] }),
    'https://A.EXAMPLE.TEST./')
  assert.equal(observed.length, 2)
  assert.deepEqual(observed.map(asset => asset.ip), ['192.0.2.20', '192.0.2.21'])
  assert.equal(observed[0].primary_name, 'a.example.test')
  assert.equal(observed[0].ports[0].title, 'App Home')
  assert.equal(observed[0].ports[0].product, 'nginx')
  assert.equal(observed[0].ports[0].banner, 'nginx')
  assert.ok(observed[0].ports[0].fingerprints.some(fp => fp.product === 'React'))
  assert.ok(observed[0].ports[0].fingerprints.some(fp => fp.category === 'web-server'))
  assert.equal(observed[0].state, 'live')
  assert.equal(observed[1].state, 'unknown', 'DNS-only addresses must not inherit another IP response status')
  assert.equal(observed[1].ports.length, 0, 'service evidence belongs only to the connected IP')
})

test('HTTPx parser bounds expanded address arrays', () => {
  const addresses = Array.from({ length: 20 }, (_, index) => '192.0.2.' + (index + 1))
  const observed = parseLocalDiscovery('httpx',
    JSON.stringify({ url: 'https://bounded.example.test/', a: addresses }),
    'bounded.example.test')
  assert.equal(observed.length, 16)
})

test('privacy status never misrepresents target-side logs as protected', (t) => {
  const { store } = fixture(t)
  const defaults = summarizeProtection({ scanPreferences: {} })
  assert.equal(defaults.protected.some((x) => x.id === 'single-target'), true)
  assert.equal(defaults.available.some((x) => x.id === 'asset-mask'), true)
  assert.equal(defaults.limitations.some((x) => x.id === 'target-logs'), true)
  const enabled = summarizeProtection({ scanPreferences: {
    mode: 'low-impact', noReverseDns: true, captureDiagnostics: false,
    maskHistory: true, maskAssetResults: true,
  } })
  assert.deepEqual(enabled.available, [])
  assert.equal(enabled.protected.some((x) => x.id === 'diagnostics'), true)
  assert.equal(enabled.protected.some((x) => x.id === 'reverse-dns'), true)
  assert.equal(enabled.limitations.length, 3)
  const api = dispatch(store, { op: 'privacyPosture' })
  assert.equal(api.ok, true)
  assert.ok(api.protected.length > 0)
})

test('workbench and embedded copy provide one-target UI and a real status explanation', () => {
  for (const p of ['lib/redteam/client.js', 'client.js']) {
    const code = readFileSync(new URL('../' + p, import.meta.url), 'utf8')
    assert.match(code, /op: 'localActiveSurvey'/)
    assert.match(code, /'执行单目标测绘'/)
    assert.match(code, /'保护状态：已保护 \/ 可启用 \/ 仍会暴露'/)
    assert.match(code, /checkField\('maskAssetResults'/)
    assert.match(code, /checkField\('noReverseDns'/)
    assert.match(code, /maskAssets \? '资产标识已隐藏'/)
  }
})
