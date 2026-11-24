import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  disposeProxyPool,
  proxyPoolExportArtexModeBConfig,
  proxyPoolSave,
  proxyPoolSnapshot,
  proxyProfileSave,
} from '../lib/redteam/proxy-pool.js'
import { handleProxyOp } from '../lib/redteam/proxy-api.js'

const fixtureNodes = () => [
  { type: 'socks5', server: '127.0.0.1', port: 7890 },
  { type: 'vless', server: '192.0.2.10', port: 443,
    uuid: 'fixture-vps1-uuid', tls: true, servername: 'vps1.example',
    'reality-opts': { 'public-key': 'fixture-vps1-public-key', 'short-id': '111' } },
  { type: 'vless', server: '198.51.100.20', port: 443,
    uuid: 'fixture-vps2-uuid', tls: true, servername: 'vps2.example',
    'reality-opts': { 'public-key': 'fixture-vps2-public-key', 'short-id': '222' } },
]

async function configuredPool(t, nodes) {
  const root = mkdtempSync(join(tmpdir(), 'purge-artex-export-'))
  t.after(async () => {
    await disposeProxyPool(root)
    rmSync(root, { recursive: true, force: true })
  })
  const saved = await proxyProfileSave(root, {
    kind: 'mihomo-chain', name: 'private Mode B', nodes,
  })
  await proxyPoolSave(root, {
    enabled: true, strictEgress: true, autoConnect: false, activeId: saved.savedId,
  })
  return root
}

test('ARTEX export contains the active strict chain but public Purge snapshots stay redacted', async (t) => {
  const root = await configuredPool(t, fixtureNodes())
  const exported = proxyPoolExportArtexModeBConfig(root)
  assert.equal(exported.ok, true)
  assert.equal(exported.filename, 'config.yaml')
  assert.equal(exported.hopCount, 3)
  assert.equal(exported.finalExit, 'vps2')
  assert.equal(exported.containsCredentials, true)
  assert.equal(exported.requiresDockerGatewayReachableAirport, true)
  assert.match(exported.yaml, /Contains proxy credentials; keep private/)
  const config = parseYaml(exported.yaml)
  assert.equal(config['mixed-port'], 7890)
  assert.equal(config['allow-lan'], true)
  assert.equal(config['bind-address'], '*')
  assert.equal(config.ipv6, false)
  assert.equal(config.dns['respect-rules'], true)
  assert.deepEqual(config.dns.nameserver, ['https://1.1.1.1/dns-query#vps2'])
  assert.deepEqual(config.proxies.map((node) => node.name), ['airport-entry', 'vps1', 'vps2'])
  assert.equal(config.proxies[0].server, 'host.docker.internal')
  assert.equal(config.proxies[1]['dialer-proxy'], 'airport-entry')
  assert.equal(config.proxies[2]['dialer-proxy'], 'vps1')
  assert.deepEqual(config.rules, ['MATCH,vps2'])
  assert.equal(config.tun, undefined)
  assert.equal(config['external-controller'], undefined)
  assert.match(exported.yaml, /fixture-vps1-uuid/)
  assert.match(exported.yaml, /fixture-vps2-uuid/)
  assert.doesNotMatch(JSON.stringify(proxyPoolSnapshot(root)), /fixture-vps[12]-uuid|fixture-vps[12]-public-key/)
  const apiSnapshot = await handleProxyOp(root, { op: 'proxyPoolGet' })
  assert.doesNotMatch(JSON.stringify(apiSnapshot), /fixture-vps[12]-uuid|fixture-vps[12]-public-key/)
})

test('ARTEX export supports an explicit two-hop airport → VPS1 profile', async (t) => {
  const root = await configuredPool(t, fixtureNodes().slice(0, 2))
  const exported = proxyPoolExportArtexModeBConfig(root)
  const config = parseYaml(exported.yaml)
  assert.equal(exported.hopCount, 2)
  assert.equal(exported.finalExit, 'vps1')
  assert.deepEqual(config.rules, ['MATCH,vps1'])
  assert.deepEqual(config.dns.nameserver, ['https://1.1.1.1/dns-query#vps1'])
  assert.equal(config.proxies[1]['dialer-proxy'], 'airport-entry')
})

test('ARTEX export is unavailable without an active strict chain or a Docker-reachable airport host', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-artex-export-invalid-'))
  t.after(async () => {
    await disposeProxyPool(root)
    rmSync(root, { recursive: true, force: true })
  })
  assert.throws(() => proxyPoolExportArtexModeBConfig(root), /严格出口模式 B/)

  const saved = await proxyProfileSave(root, {
    kind: 'mihomo-chain', name: 'domain airport', nodes: [
      { type: 'socks5', server: 'airport.example', port: 7890 },
      ...fixtureNodes().slice(1, 2),
    ],
  })
  await proxyPoolSave(root, {
    enabled: true, strictEgress: true, autoConnect: false, activeId: saved.savedId,
  })
  assert.throws(() => proxyPoolExportArtexModeBConfig(root), /IP 地址或本机 FlClash/)
  await proxyPoolSave(root, { enabled: false })
  assert.throws(() => proxyPoolExportArtexModeBConfig(root), /严格出口模式 B/)
})

test('Purge exposes ARTEX export only as an explicit local API operation', async (t) => {
  const root = await configuredPool(t, fixtureNodes())
  const result = await handleProxyOp(root, { op: 'proxyModeBExportArtex' })
  assert.equal(result.ok, true)
  assert.equal(result.filename, 'config.yaml')
  assert.match(result.yaml, /fixture-vps2-uuid/)
  const unknown = await handleProxyOp(root, { op: 'proxyModeBExportArtex', yaml: 'ignored' })
  assert.equal(unknown.ok, true)
  const source = readFileSync(new URL('../lib/redteam/proxy-api.js', import.meta.url), 'utf8')
  assert.match(source, /proxyModeBExportArtex/)
})

test('Purge environment page offers a credential-confirmed ARTEX export in source and bundle', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /proxyModeBExportArtex/)
    assert.match(source, /window\.confirm/)
    assert.match(source, /导出 ARTEX Docker 配置（包含凭据）/)
    assert.match(source, /ARTEX\/network\/mode-b\//)
    assert.match(source, /绝不可提交仓库/)
  }
})
