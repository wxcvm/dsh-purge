import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPlatformConfig, savePlatformConfig, mergeConfigEnv } from '../lib/redteam/platform-config.js'
import {
  splitLegacyVpsHost, normalizeVpsConfig, validateVpsConfig,
  selectedVpsAddress, vpsLegacyEnvironment,
} from '../lib/redteam/vps-config.js'

const workspace = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vps-dualstack-'))
  t.after(() => rmSync(dir, { force: true, recursive: true }))
  return dir
}
const dual = {
  user: 'root', domain: 'vps.example.com', ipv4: '192.0.2.10',
  ipv6: '2001:db8::10', addressMode: 'auto',
  identityFile: 'C:\\Users\\demo\\.ssh\\id_ed25519',
}

test('legacy user@IPv4, bracketed IPv6 and bare domain are parsed separately from SSH identity', () => {
  assert.deepEqual(splitLegacyVpsHost('root@192.0.2.10'), { user: 'root', host: '192.0.2.10' })
  assert.deepEqual(splitLegacyVpsHost('root@[2001:db8::10]'), { user: 'root', host: '2001:db8::10' })
  assert.equal(normalizeVpsConfig(null, { REDTEAM_VPS_HOST: 'root@192.0.2.10' }).user, 'root')
  assert.equal(normalizeVpsConfig(null, { REDTEAM_VPS_HOST: 'root@192.0.2.10' }).ipv4, '192.0.2.10')
  assert.equal(normalizeVpsConfig(null, { REDTEAM_VPS_HOST: 'root@[2001:db8::10]' }).ipv6, '2001:db8::10')
  assert.equal(normalizeVpsConfig(null, { REDTEAM_VPS_HOST: 'vps.example.com' }).domain, 'vps.example.com')
  assert.equal(normalizeVpsConfig(null, {}).user, 'ubuntu')
})

test('address preference is explicit, and host-only legacy environment never embeds a username', () => {
  assert.deepEqual(selectedVpsAddress(dual), { address: 'vps.example.com', kind: 'domain' })
  assert.deepEqual(selectedVpsAddress({ ...dual, addressMode: 'ipv4' }), {
    address: '192.0.2.10', kind: 'ipv4',
  })
  assert.deepEqual(selectedVpsAddress({ ...dual, addressMode: 'ipv6' }), {
    address: '2001:db8::10', kind: 'ipv6',
  })
  assert.deepEqual(selectedVpsAddress({ ...dual, domain: '' }), {
    address: '192.0.2.10', kind: 'ipv4',
  })
  assert.deepEqual(vpsLegacyEnvironment(dual), {
    REDTEAM_VPS_HOST: 'vps.example.com',
    REDTEAM_VPS_USER: 'root',
    REDTEAM_VPS_KEY: dual.identityFile,
  })
})

test('VPS fields reject malformed addresses while allowing optional blank addresses', () => {
  assert.equal(validateVpsConfig(dual), null)
  assert.equal(validateVpsConfig({ ...dual, ipv6: 'bad:ipv6:' }), 'VPS IPv6 地址无效（不要填写方括号或端口）')
  assert.match(validateVpsConfig({ ...dual, ipv4: 'root@192.0.2.10' }), /IPv4/)
  assert.match(validateVpsConfig({ ...dual, domain: 'https://vps.example.com' }), /域名/)
  assert.match(validateVpsConfig({ ...dual, user: 'bad user' }), /用户名/)
  assert.match(validateVpsConfig({ ...dual, addressMode: 'ipv6', ipv6: '' }), /IPv6 优先/)
  assert.equal(validateVpsConfig({ user: 'ubuntu', domain: '', ipv4: '', ipv6: '' }), null)
})

test('old platform config migrates on explicit new UI save and preserves unrelated fields', (t) => {
  const root = workspace(t)
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    version: 2, env: {
      REDTEAM_VPS_HOST: 'root@192.0.2.10',
      REDTEAM_VPS_KEY: 'C:\\Users\\demo\\.ssh\\id_rsa',
      FOFA_KEY: 'sample',
    }, tools: { nmap: '/fixture/nmap' }, notes: 'existing',
  }))
  const legacy = loadPlatformConfig(root)
  assert.equal(legacy.vps.user, 'root')
  assert.equal(legacy.vps.ipv4, '192.0.2.10')
  assert.equal(legacy.env.REDTEAM_VPS_HOST, 'root@192.0.2.10')

  const saved = savePlatformConfig({ vps: dual }, root)
  assert.equal(saved.env.REDTEAM_VPS_HOST, 'vps.example.com')
  assert.equal(saved.env.REDTEAM_VPS_USER, 'root')
  assert.equal(saved.env.REDTEAM_VPS_KEY, dual.identityFile)
  assert.equal(saved.env.FOFA_KEY, 'sample')
  assert.equal(saved.tools.nmap, '/fixture/nmap')
  assert.equal(saved.notes, 'existing')
  assert.deepEqual(saved.vps, dual)

  const other = savePlatformConfig({ notes: 'updated' }, root)
  assert.deepEqual(other.vps, dual)
  assert.equal(other.env.REDTEAM_VPS_HOST, 'vps.example.com')
  assert.equal(other.notes, 'updated')
  assert.deepEqual(mergeConfigEnv({}, other).REDTEAM_VPS_HOST, 'vps.example.com')
  // Process values retain existing precedence: don't silently overwrite .env.
  assert.equal(mergeConfigEnv({ REDTEAM_VPS_HOST: 'preexisting.example' }, other)
    .REDTEAM_VPS_HOST, 'preexisting.example')
})

test('old clients can still update env-only VPS configuration without new vps object', (t) => {
  const root = workspace(t)
  savePlatformConfig({ env: { REDTEAM_VPS_HOST: 'ubuntu@old.example.com',
    REDTEAM_VPS_KEY: '/keys/id_ed25519' } }, root)
  let config = loadPlatformConfig(root)
  assert.equal(config.vps.domain, 'old.example.com')
  assert.equal(config.vps.user, 'ubuntu')
  assert.equal(config.env.REDTEAM_VPS_HOST, 'ubuntu@old.example.com')

  config = savePlatformConfig({ env: { REDTEAM_VPS_HOST: 'ubuntu@2001:db8::10' } }, root)
  assert.equal(config.vps.ipv6, '2001:db8::10')
  assert.equal(config.vps.user, 'ubuntu')
})

test('UI source, bundled client, setup script and both guides include real configuration help', () => {
  for (const p of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8')
    assert.match(src, /vps: draft\.vps/)
    assert.match(src, /SSH 用户名/)
    assert.match(src, /公网 IPv6/)
    assert.match(src, /自动模式只决定优先用哪种地址/)
    assert.match(src, /vpsField\('identityFile'/)
  }
  const script = readFileSync(new URL('../scripts/redteam-setup.sh', import.meta.url), 'utf8')
  assert.match(script, /LEGACY_USER/)
  assert.match(script, /VPS 主机 IP\/IPv6\/域名（不含用户）/)
  const guide = readFileSync(new URL('../docs/OPERATIONS_GUIDE.zh-CN.md', import.meta.url), 'utf8')
  assert.match(guide, /多环境的作用与 VPS 配置方法/)
  assert.match(guide, /VMware Kali SSH/)
  assert.match(guide, /IPv6 URL/)
  const environmentGuide = readFileSync(new URL('../docs/ENVIRONMENT_CAPABILITY.zh-CN.md', import.meta.url), 'utf8')
  assert.match(environmentGuide, /VPS 双栈与执行环境角色/)
})
