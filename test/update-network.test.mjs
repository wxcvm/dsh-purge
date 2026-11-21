import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { gitHubCredential, parseUpdateProxy, updateProxy, publicUpstreamRefs } from '../lib/update-network.js'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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

test('public upstream refs isolate all private Git credentials and config while retaining the selected proxy', () => {
  const inherited = {
    DSH_PURGE_GITHUB_TOKEN: 'private-token',
    GITHUB_TOKEN: 'github-token',
    GH_TOKEN: 'gh-token',
    GH_ENTERPRISE_TOKEN: 'enterprise-token',
    GIT_ASKPASS: '/private/askpass',
    SSH_ASKPASS: '/private/ssh-askpass',
    GIT_ASKPASS_REQUIRE: 'force',
    GIT_CONFIG_PARAMETERS: "'http.extraHeader=Authorization: Bearer private'",
    GIT_CONFIG: '/private/gitconfig',
    GIT_CONFIG_GLOBAL: '/private/global-config',
    GIT_CONFIG_SYSTEM: '/private/system-config',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: 'Authorization: Bearer private',
    GIT_DIR: '/private/.git',
    GIT_WORK_TREE: '/private/worktree',
    GIT_SSL_NO_VERIFY: '1',
    HTTPS_PROXY: 'http://proxy-user:proxy-pass@127.0.0.1:7890',
    https_proxy: 'http://proxy-user:proxy-pass@127.0.0.1:7890',
  }
  const original = { ...inherited }
  let cwd = ''
  const result = publicUpstreamRefs({ repository: 'deepseek-ai/deepseek-harness', releasePrefix: 'dsh-v' }, {
    env: inherited,
    proxyUrl: 'http://127.0.0.1:7890/',
    run: (_command, args, options) => {
      cwd = options.cwd
      assert.ok(existsSync(cwd), 'the isolated working directory exists only for this request')
      const effectiveConfig = execFileSync('git', ['config', '--list', '--show-origin'], {
        cwd, env: options.env, encoding: 'utf8', windowsHide: true,
      })
      assert.match(effectiveConfig, /http\.proxy=http:\/\/127\.0\.0\.1:7890\//)
      assert.doesNotMatch(effectiveConfig, /private-token|github-token|gh-token|Authorization|private\/askpass/i)
      assert.ok(args.includes('ls-remote'))
      assert.ok(!args.some(v => v.includes('7890')))
      assert.equal(options.env.DSH_PURGE_GITHUB_TOKEN, undefined)
      assert.equal(options.env.GITHUB_TOKEN, undefined)
      assert.equal(options.env.GH_TOKEN, undefined)
      assert.equal(options.env.GH_ENTERPRISE_TOKEN, undefined)
      assert.equal(options.env.GIT_ASKPASS, undefined)
      assert.equal(options.env.SSH_ASKPASS, undefined)
      assert.equal(options.env.GIT_ASKPASS_REQUIRE, undefined)
      assert.equal(options.env.GIT_CONFIG_PARAMETERS, undefined)
      assert.equal(options.env.GIT_DIR, undefined)
      assert.equal(options.env.GIT_WORK_TREE, undefined)
      assert.equal(options.env.GIT_SSL_NO_VERIFY, undefined)
      assert.equal(options.env.HTTPS_PROXY, undefined)
      assert.equal(options.env.https_proxy, undefined)
      assert.equal(options.env.GIT_CONFIG_NOSYSTEM, '1')
      assert.equal(options.env.GIT_CONFIG_GLOBAL, path.join(cwd, 'empty.gitconfig'))
      assert.equal(options.env.GIT_CONFIG_SYSTEM, path.join(cwd, 'empty.gitconfig'))
      assert.equal(readFileSync(options.env.GIT_CONFIG_GLOBAL, 'utf8'), '')
      assert.equal(options.env.GIT_CEILING_DIRECTORIES, cwd)
      assert.equal(options.env.GIT_CONFIG_COUNT, '4')
      assert.equal(options.env.GIT_CONFIG_KEY_0, 'credential.helper')
      assert.equal(options.env.GIT_CONFIG_VALUE_0, '')
      assert.equal(options.env.GIT_CONFIG_KEY_1, 'http.proxy')
      assert.equal(options.env.GIT_CONFIG_VALUE_1, 'http://127.0.0.1:7890/')
      assert.equal(options.env.GIT_CONFIG_KEY_2, 'http.extraHeader')
      assert.equal(options.env.GIT_CONFIG_VALUE_2, '')
      assert.equal(options.env.GIT_CONFIG_KEY_3, 'http.https://github.com/.extraHeader')
      assert.equal(options.env.GIT_CONFIG_VALUE_3, '')
      return 'a'.repeat(40) + '\trefs/heads/master\n' + 'b'.repeat(40) + '\trefs/tags/dsh-v0.2.2-rc.3\n'
    },
  })
  assert.deepEqual(result.tags, ['dsh-v0.2.2-rc.3'])
  assert.deepEqual(inherited, original, 'caller environment is never mutated')
  assert.equal(existsSync(cwd), false, 'temporary isolated directory is removed')
})
