import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeModeBChain, modeBChainPublic } from '../lib/redteam/proxy-mode-b-chain.js'
import { buildMihomoConfig } from '../lib/redteam/proxy-mihomo.js'
import { proxyPoolSave, proxyProfileSave, proxyPoolSnapshot, loadProxyPool, requestWithProxyPool } from '../lib/redteam/proxy-pool.js'
import { handleProxyOp } from '../lib/redteam/proxy-api.js'

const fixtureNodes = () => [
  { type: 'socks5', server: '127.0.0.1', port: 7890 },
  { type: 'vless', server: '192.0.2.10', port: 443,
    uuid: 'fixture-vps1-uuid', tls: true, servername: 'example.com',
    'reality-opts': { 'public-key': 'public-vps1', 'short-id': '111' } },
  { type: 'vless', server: '198.51.100.20', port: 443,
    uuid: 'fixture-vps2-uuid', tls: true, servername: 'example.org',
    'reality-opts': { 'public-key': 'public-vps2', 'short-id': '222' } },
]

test('3-hop profile has only the specified airport → VPS1 → VPS2 dialers and final exit', () => {
  const original = fixtureNodes()
  const nodes = normalizeModeBChain(original)
  assert.equal(original[1]['dialer-proxy'], undefined, 'caller input is never mutated')
  assert.deepEqual(nodes.map((x) => x.name), ['airport-entry', 'vps1', 'vps2'])
  assert.deepEqual(nodes.map((x) => x['dialer-proxy'] || null), [null, 'airport-entry', 'vps1'])
  assert.deepEqual(normalizeModeBChain(nodes), nodes, 'persisted generated dialers revalidate')
  const config = buildMihomoConfig(nodes, 29999, 'fixture-user', 'fixture-pass')
  assert.deepEqual(config.proxies, nodes)
  assert.deepEqual(config['proxy-groups'], [{ name: 'dsh-purge-owned', type: 'select', proxies: ['vps2'] }])
  assert.deepEqual(config.rules, ['MATCH,dsh-purge-owned'])
  assert.equal(config['allow-lan'], false)
  assert.equal(config['bind-address'], '127.0.0.1')
  assert.equal(config.tun.enable, false)
  assert.equal(config.dns['respect-rules'], true)
  assert.deepEqual(config.dns.nameserver, ['https://1.1.1.1/dns-query#vps2'])
  assert.doesNotMatch(JSON.stringify(config.rules), /DIRECT|fallback|REJECT/)
  assert.deepEqual(modeBChainPublic(nodes), {
    hopCount: 3, mode: 'B', finalExit: 'vps2_configured_unverified', verification: 'not_tested',
  })
})

test('2-hop profile stays explicitly VPS2-unconfigured and legacy Mihomo DNS is unchanged', () => {
  const nodes = normalizeModeBChain(fixtureNodes().slice(0, 2))
  const config = buildMihomoConfig(nodes, 29999, 'user', 'pass')
  assert.deepEqual(config['proxy-groups'][0].proxies, ['vps1'])
  assert.deepEqual(config.dns.nameserver, ['https://1.1.1.1/dns-query#vps1'])
  assert.equal(modeBChainPublic(nodes).finalExit, 'vps1_configured_unverified')
  const legacy = buildMihomoConfig({ name: 'single', type: 'vless', server: '192.0.2.10', port: 443 }, 29999, 'u', 'p')
  assert.deepEqual(legacy.dns, { enable: false })
  assert.deepEqual(legacy['proxy-groups'][0].proxies, ['single'])
})

test('Mode B rejects direct fallback, arbitrary dialers, missing IPs and unsupported middle hops', () => {
  const changes = [
    [0, { type: 'direct' }],
    [0, { 'dialer-proxy': 'DIRECT' }],
    [1, { 'dialer-proxy': 'DIRECT' }],
    [1, { 'dialer-proxy': 'vps2' }],
    [2, { 'proxy-provider': 'remote' }],
    [1, { 'interface-name': 'eth0' }],
    [1, { server: 'vps1.example.org' }],
    [1, { type: 'hysteria2' }],
    [1, { 'skip-cert-verify': true }],
    [2, { server: '192.0.2.10' }],
    [2, { uuid: '' }],
  ]
  for (const [index, patch] of changes) {
    const nodes = fixtureNodes()
    Object.assign(nodes[index], patch)
    assert.throws(() => normalizeModeBChain(nodes), undefined, 'invalid patch: ' + JSON.stringify(patch))
  }
  assert.throws(() => normalizeModeBChain([fixtureNodes()[0]]))
  assert.throws(() => normalizeModeBChain([...fixtureNodes(), fixtureNodes()[2]]))
  const cyclic = fixtureNodes()
  cyclic[1].loop = cyclic[1]
  assert.throws(() => normalizeModeBChain(cyclic), /循环/)
})

test('Mode B profile persists privately, returns no UUIDs, and selects exclusive strict egress', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-modeb-chain-'))
  t.after(() => rmSync(root, { force: true, recursive: true }))
  const saved = await proxyProfileSave(root, { kind: 'mihomo-chain', name: 'private Mode B', nodes: fixtureNodes() })
  const id = saved.savedId
  assert.ok(id)
  const metadata = saved.profiles.find((x) => x.id === id)
  assert.equal(metadata.kind, 'mihomo-chain')
  assert.equal(metadata.verification, 'not_tested')
  assert.equal(metadata.hopCount, 3)
  assert.equal(metadata.passwordSet, true)
  assert.equal(metadata.nodes, undefined)
  assert.doesNotMatch(JSON.stringify(saved), /fixture-vps[12]-uuid|public-vps[12]/)
  const stored = readFileSync(join(root, 'proxy-pool.json'), 'utf8')
  assert.match(stored, /fixture-vps1-uuid/)
  assert.match(stored, /fixture-vps2-uuid/)
  assert.equal(loadProxyPool(root).profiles[0].nodes[2]['dialer-proxy'], 'vps1')
  assert.equal((await handleProxyOp(root, { op: 'proxyPoolGet' })).profiles[0].nodes, undefined)

  const activated = await proxyPoolSave(root, { activeId: id, enabled: true, autoConnect: false })
  assert.equal(activated.strictEgress, true)
  assert.equal(proxyPoolSnapshot(root).activeId, id)
  await assert.rejects(proxyPoolSave(root, { strictEgress: false }), /严格出口/)
  const stopped = await proxyPoolSave(root, { enabled: false })
  assert.equal(stopped.strictEgress, true)
  await assert.rejects(requestWithProxyPool(root, 'http://127.0.0.1:1/', { timeout: 2000 }), /阻止直连/)
})

test('proxy console has a private, opt-in Mode B editor without changing model or system routes', () => {
  const html = readFileSync(new URL('../maintenance/proxy-console.html', import.meta.url), 'utf8')
  assert.match(html, /btnAddModeB/)
  assert.match(html, /kind: 'mihomo-chain'/)
  assert.match(html, /strictEgress: true, autoConnect: false/)
  assert.match(html, /modeBNodes'\)\.value = ''/)
  assert.match(html, /不改.*系统代理|不会更改系统代理/)
})
