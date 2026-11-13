import test from 'node:test'
import assert from 'node:assert/strict'
import { gitHubCredential, parseUpdateProxy, updateProxy } from '../lib/update-network.js'
import { readFileSync } from 'node:fs'

test('Git credential reuse is noninteractive, scoped, memory-only and keeps tokens out of diagnostics', () => {
  const secret = 'fixture-only-secret'
  const value = gitHubCredential((command, args, options) => {
    assert.equal(command, 'git')
    assert.ok(args.includes('fill'))
    assert.match(options.input, /path=wxcvm\/dsh-purge\.git/)
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(options.env.GCM_INTERACTIVE, 'Never')
    assert.equal(options.windowsHide, true)
    return 'protocol=https\nhost=github.com\npassword=' + secret + '\n'
  }, {})
  assert.equal(value, secret)
  assert.equal(gitHubCredential(() => { throw new Error(secret) }), '')
  assert.equal(gitHubCredential(() => 'protocol=https\nhost=other.example\npassword=' + secret), '')
})

test('update proxy respects explicit settings and Windows HTTPS system proxy without mutating the environment', () => {
  assert.equal(parseUpdateProxy('127.0.0.1:7890'), 'http://127.0.0.1:7890/')
  assert.equal(parseUpdateProxy('http=127.0.0.1:1;https=127.0.0.1:2'), 'http://127.0.0.1:2/')
  const env = { DSH_PURGE_UPDATE_PROXY: 'direct', HTTPS_PROXY: 'http://127.0.0.1:3' }
  assert.equal(updateProxy({ env, platform: 'win32', run: () => { throw new Error('must not run') } }), '')
  assert.deepEqual(env, { DSH_PURGE_UPDATE_PROXY: 'direct', HTTPS_PROXY: 'http://127.0.0.1:3' })
  assert.equal(updateProxy({ env: {}, platform: 'win32', run: (_cmd, args) => args.at(-1) === 'ProxyEnable'
    ? ' ProxyEnable REG_DWORD 0x1\n' : ' ProxyServer REG_SZ 127.0.0.1:7890\n' }), 'http://127.0.0.1:7890/')
  assert.equal(updateProxy({ env: {}, platform: 'linux' }), '')
  assert.throws(() => parseUpdateProxy('file:///secret'), /invalid update proxy/)
})

test('updater UI consumes real check results, including unavailable upstreams, without a second installation action', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /purge-upstream-status/)
  assert.match(client, /updateInfo\.upstreams\.sources\.map/)
  assert.match(client, /update\.upstreamUnknown/)
})
