import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { purgePnpmBuildSpecs } from '../lib/profile-insert.js'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const fork = 'wxcvm/dsh-purge'
const version = JSON.parse(read('../package.json')).version
const tarball = `https://codeload.github.com/${fork}/tar.gz/refs/tags/v${version}`

test('fork package metadata installs from its own maintained repository', () => {
  const pkg = JSON.parse(read('../package.json'))
  assert.equal(pkg.repository.url, `git+https://github.com/${fork}.git`)
  assert.equal(pkg.homepage, `https://github.com/${fork}#readme`)
  assert.equal(pkg.bugs.url, `https://github.com/${fork}/issues`)
  assert.equal(pkg.dsh.install.tarball, tarball)
  assert.equal(pkg.dsh.install.zip, `https://codeload.github.com/${fork}/zip/refs/tags/v${version}`)
  assert.equal(pkg.dsh.install.git, `https://github.com/${fork}.git`)
  assert.ok(purgePnpmBuildSpecs().includes(`dsh-purge@${tarball}`))
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
 * Canonical README baseline: CallMeGuLab/dsh-purge-safe main@29bf73a.
 * Keep the fork's package/update metadata in wxcvm/dsh-purge, but do not
 * rewrite the upstream project homepage or add fork-specific copy to it.
 * These Git blob hashes make upstream README drift an explicit sync task.
 */
const UPSTREAM_README_BLOBS = Object.freeze({
  'README.md': 'b4a4a02130e59bf9a949a2d246ad3068bf291390',
  'README.en.md': 'b4a4a02130e59bf9a949a2d246ad3068bf291390',
  'README.zh-CN.md': 'e13bd8f3df8da8733bc80bb0e4a619db80872a07',
  'README.ja.md': 'a46a562c9f24b6ebeee21b6d80203ca19615f651',
})

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${bytes.length}\\0`).update(bytes).digest('hex')
}

test('README files match the selected upstream baseline and retain its attribution', () => {
  for (const [name, expectedSha] of Object.entries(UPSTREAM_README_BLOBS)) {
    const content = read('../' + name)
    assert.equal(gitBlobSha(content), expectedSha, name + ' must match CallMeGuLab/dsh-purge-safe main@29bf73a')
    assert.ok(content.includes('CallMeGuLab'), name + ' must retain upstream attribution')
    assert.ok(content.includes('LICENSE'), name + ' must retain the license reference')
    assert.ok(content.includes('NOTICE'), name + ' must retain the notice reference')
    assert.doesNotMatch(content, /https:\\/\\/codeload\\.github\\.com\\/(?:wxcvm|YuJunZhiXue)\\/dsh-purge\\//)
  }
})

test('Windows Desktop installer pins the current release and supports rollback', () => {
  const version = JSON.parse(read('../package.json')).version
  const script = read('../scripts/update-desktop-fork.ps1')
  /* 版本不再写死在脚本里：默认从 package.json 读，避免"发版忘了改脚本"导致装错标签。
     -Version 保留显式覆盖（回滚到指定版本时用）。 */
  assert.match(script, /\\[string\\]\\$Version = ''/, 'must accept an explicit -Version override')
  assert.ok(script.includes("Join-Path $repoRoot 'package.json'"), 'must derive the version from package.json')
  assert.ok(script.includes('https://codeload.github.com/wxcvm/dsh-purge/tar.gz/refs/tags/v$version'))
  assert.ok(!/^\\$version = '\\d/m.test(script), 'no hardcoded version literal')
  assert.match(script, /pnpm install --frozen-lockfile --ignore-scripts/)
  assert.match(script, /\\[switch\\]\\$CheckOnly/)
  assert.ok(version.length > 0)
})
