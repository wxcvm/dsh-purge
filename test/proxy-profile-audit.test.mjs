import test from 'node:test'
import assert from 'node:assert/strict'
import { auditProxyProfile } from '../lib/redteam/proxy-profile-audit.js'

test('reports wildcard LAN and unauthenticated management listeners without exposing credentials', () => {
  const r = auditProxyProfile('allow-lan: true\nbind-address: "*"\nauthentication: []\nexternal-controller: 0.0.0.0:9090\nsecret: CHANGE_ME\nproxies:\n  - name: private-node\n    password: test-secret-value')
  assert.deepEqual(r.findings.map(x=>x.id),['lan-no-auth','lan-wildcard','external-controller-no-secret'])
  assert.equal(r.actualReachability,'not_tested')
  assert.ok(!JSON.stringify(r).includes('test-secret-value'))
  assert.ok(!JSON.stringify(r).includes('private-node'))
  assert.ok(!JSON.stringify(r).includes('0.0.0.0:9090'))
})

test('loopback and disabled LAN do not become fake verified firewall claims', () => {
  const r=auditProxyProfile('allow-lan: false\nbind-address: "*"\nexternal-controller: "127.0.0.1:9090"')
  assert.equal(r.findings.length,0)
  assert.equal(r.scope,'config-only')
  assert.equal(r.actualReachability,'not_tested')
  assert.equal(auditProxyProfile('allow-lan: true\nbind-address: 192.0.2.1\nauthentication: ["local:fixture-password"]').findings.length,0)
  assert.ok(auditProxyProfile('allow-lan: true\nbind-address: 192.0.2.1\nauthentication: ["local:CHANGE_ME"]').findings.some(x=>x.id==='lan-no-auth'))
  assert.ok(auditProxyProfile('allow-lan: true\nbind-address: 192.0.2.1\nauthentication: ["local:fixture-password"]\nskip-auth-prefixes: ["192.0.2.0/24"]').findings.some(x=>x.id==='lan-auth-exception'))
  assert.throws(()=>auditProxyProfile('secret: [fixture-secret'),/无法解析代理 YAML/)
})

test('DNS audit separates resolver transports, configuration state and runtime evidence', () => {
  const r = auditProxyProfile('dns:\n  enable: true\n  enhanced-mode: fake-ip\n  respect-rules: false\n  nameserver: [192.0.2.53, "https://dns.example.invalid/private-path"]\n  fallback: ["tls://dns.example.invalid", "system"]\n  nameserver-policy:\n    "+.example.invalid": ["udp://192.0.2.54", "quic://dns.example.invalid"]')
  assert.equal(r.dns.state,'enabled')
  assert.equal(r.dns.mode,'fake-ip')
  assert.equal(r.dns.respectRules,'disabled')
  assert.deepEqual(r.dns.groups[0],{name:'nameserver',plaintext:1,encrypted:1,unknown:0})
  assert.deepEqual(r.dns.groups[1],{name:'fallback',plaintext:0,encrypted:1,unknown:1})
  assert.deepEqual(r.dns.groups[2],{name:'nameserver-policy',plaintext:1,encrypted:1,unknown:0})
  assert.equal(r.dns.actualResolution,'not_tested')
  assert.ok(r.findings.some(x=>x.id==='dns-plaintext'))
  assert.ok(r.findings.some(x=>x.id==='dns-transport-unknown'))
  assert.ok(!JSON.stringify(r).includes('example.invalid'))
  assert.ok(!JSON.stringify(r).includes('192.0.2.53'))
  assert.ok(!JSON.stringify(r).includes('private-path'))
  const disabled = auditProxyProfile('dns:\n  enable: false\n  nameserver: [192.0.2.53]')
  assert.equal(disabled.dns.state,'disabled')
  assert.equal(disabled.findings.length,0)
  assert.equal(auditProxyProfile('allow-lan: false').dns.state,'unspecified')
  assert.ok(auditProxyProfile('dns:\n  enable: true\n  respect-rules: true\n  nameserver: ["https://dns.example.invalid/dns-query"]').findings.some(x=>x.id==='dns-rule-dependency'))
})
