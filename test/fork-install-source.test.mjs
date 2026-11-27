import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { purgePnpmBuildSpecs } from '../lib/profile-insert.js'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const fork = 'wxcvm/dsh-purge'
const version = JSON.parse(read('../package.json')).version
const tarball = 'https://codeload.github.com/' + fork + '/tar.gz/refs/tags/v' + version

test('fork package metadata installs from its own maintained repository', () => {
  const pkg = JSON.parse(read('../package.json'))
  assert.equal(pkg.repository.url, 'git+https://github.com/' + fork + '.git')
  assert.equal(pkg.homepage, 'https://github.com/' + fork + '#readme')
  assert.equal(pkg.bugs.url, 'https://github.com/' + fork + '/issues')
  assert.equal(pkg.dsh.install.tarball, tarball)
  assert.equal(pkg.dsh.install.zip, 'https://codeload.github.com/' + fork + '/zip/refs/tags/v' + version)
  assert.equal(pkg.dsh.install.git, 'https://github.com/' + fork + '.git')
  assert.ok(purgePnpmBuildSpecs().includes('dsh-purge@' + tarball))
})

test('built-in updater and profile fallback no longer point at the original repository', () => {
  const updater = read('../lib/update.js')
  const profile = read('../lib/profile-insert.js')
  assert.ok(updater.includes('const REPO = "wxcvm/dsh-purge";'))
  assert.ok(!updater.includes('YuJunZhiXue/dsh-purge'))
  assert.ok(profile.includes('pkg?.dsh?.install?.tarball'))
  assert.ok(!profile.includes('YuJunZhiXue/dsh-purge'))
})

/*
 * Canonical README baseline: CallMeGuLab/dsh-purge-safe main.
 * Keep fork-specific package/update metadata in wxcvm/dsh-purge, not in the
 * upstream project homepage. Semantic assertions are line-ending independent.
 */
test('README files follow the selected upstream homepage and retain attribution', () => {
  const english = read('../README.md')
  assert.equal(read('../README.en.md'), english, 'README.en.md must mirror the default English page')

  const pages = [
    ['README.md', english, 'DeepSeek Harness cybersecurity red-team tool (dsh-purge-safe)'],
    ['README.zh-CN.md', read('../README.zh-CN.md'), 'DeepSeek Harness 网络安全红队工具（dsh-purge-safe）'],
    ['README.ja.md', read('../README.ja.md'), 'DeepSeek Harness サイバーセキュリティ レッドチームツール (dsh-purge-safe)'],
  ]
  for (const [name, content, title] of pages) {
    assert.ok(content.includes(title), name + ' must retain the upstream title')
    assert.ok(content.includes('2.0.0'), name + ' must retain the upstream version marker')
    assert.ok(content.includes('CallMeGuLab'), name + ' must retain upstream attribution')
    assert.ok(content.includes('LICENSE'), name + ' must retain the license reference')
    assert.ok(content.includes('NOTICE'), name + ' must retain the notice reference')
    assert.ok(!content.includes('https://github.com/wxcvm/dsh-purge/releases'), name + ' must not replace the upstream homepage with fork-specific copy')
    assert.ok(!content.includes('https://codeload.github.com/wxcvm/dsh-purge/'), name + ' must not add a fork-specific install URL')
  }
})
test('Windows Desktop installer pins the current release and supports rollback', () => {
  const version = JSON.parse(read('../package.json')).version
  const script = read('../scripts/update-desktop-fork.ps1')
  /* 版本不再写死在脚本里：默认从 package.json 读，避免"发版忘了改脚本"导致装错标签。
     -Version 保留显式覆盖（回滚到指定版本时用）。 */
  assert.ok(script.includes("[string]$Version = ''"), 'must accept an explicit -Version override')
  assert.ok(script.includes("Join-Path $repoRoot 'package.json'"), 'must derive the version from package.json')
  assert.ok(script.includes('https://codeload.github.com/wxcvm/dsh-purge/tar.gz/refs/tags/v$version'))
  assert.doesNotMatch(script, /^\$version = '\d/m, 'no hardcoded version literal')
  assert.ok(script.includes('pnpm install --frozen-lockfile --ignore-scripts'))
  assert.ok(script.includes('[switch]$CheckOnly'))
  assert.ok(version.length > 0)
})
