import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'

const workflow = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'))
const releaseStep = workflow.jobs.release.steps.find(step => step.name === 'Build, verify and optionally publish GitHub Release')
const version = '1.0.0'
const tag = 'v' + version
const zip = 'dsh-purge-' + version + '.zip'
const members = [
  'client.js', 'lib/redteam/client.js', 'lib/redteam/store-core.js',
  'lib/redteam/tools.js', 'lib/redteam/task-context.js', 'lib/artex-knowledge.js',
  'lib/redteam/adapters/wsl.js', 'lib/redteam/adapters/ssh-kali.js',
  'scripts/update-desktop-fork.ps1',
]
const skip = process.platform !== 'linux' ? 'the publishing workflow uses Linux bash, unzip and sha256sum' : false

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'purge-release-preflight-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'source')
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  for (const dir of [repo, home, bin]) mkdirSync(dir)
  const ghCalled = path.join(root, 'unexpected-gh-call')
  // Only Git is real. Any accidental GitHub invocation leaves proof and fails.
  writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf called >> "$PREFLIGHT_GH_PROBE"\nexit 97\n', { mode: 0o700 })
  const env = {
    PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    LC_ALL: 'C', PREFLIGHT_GH_PROBE: ghCalled,
  }
  function run(command, args, extra = {}) {
    const result = spawnSync(command, args, {
      cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: 12000, maxBuffer: 512 * 1024,
    })
    assert.ifError(result.error)
    return result
  }
  function git(...args) {
    const result = run('git', args)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  function write(file, contents) {
    const absolute = path.join(repo, file)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
  }
  function commit(message) {
    git('add', '.')
    git('commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q')
  write('package.json', JSON.stringify({ name: 'dsh-purge', version }))
  write('release-notes-wxcvm.md', '# ' + version + '\n')
  for (const file of members) write(file, 'fixture for ' + file + '\n')
  const head = commit('fixture candidate')
  git('update-ref', 'refs/remotes/origin/master', head)
  assert.equal(typeof releaseStep?.run, 'string', 'the real workflow step must be exercised')
  return {
    git, write, commit, head, run, ghExecutable: path.join(bin, 'gh'), ghCalled, path: file => path.join(repo, file),
    preflight(extra = {}) {
      const result = run('bash', ['-c', releaseStep.run], {
        GITHUB_REPOSITORY: 'wxcvm/dsh-purge',
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'master',
        GITHUB_SHA: head, DRY_RUN: 'true', ...extra,
      })
      assert.equal(existsSync(ghCalled), false, 'dry runs and validation failures must not call gh')
      return result
    },
  }
}

test('release dry-run packages the fixed candidate, not a modified worktree, without contacting GitHub', { skip }, t => {
  const f = fixture(t)
  f.write('client.js', 'uncommitted code\n')
  const result = f.preflight()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /Release archive verified: .* \(no publication\)/)
  const digest = createHash('sha256').update(readFileSync(f.path(zip))).digest('hex')
  assert.equal(readFileSync(f.path('SHA256SUMS.txt'), 'utf8'), digest + '  ' + zip + '\n')
  const client = f.run('unzip', ['-p', zip, 'dsh-purge-' + version + '/client.js'])
  assert.equal(client.status, 0, client.stderr)
  assert.equal(client.stdout, 'fixture for client.js\n')
  assert.equal(f.git('tag', '--list'), '')
})

test('release preflight rejects an unrelated release branch or a candidate ahead of master', { skip }, t => {
  const f = fixture(t)
  let result = f.preflight({ GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'release/v0.9.9' })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /Release branch must match package version/)
  f.write('client.js', 'branch-only change\n')
  const ahead = f.commit('candidate not promoted to master')
  result = f.preflight({ GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'release/' + tag, GITHUB_SHA: ahead })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /Release branch must point to current master/)
  assert.equal(existsSync(f.path(zip)), false)
})

test('release preflight rejects a tag tied to different source before packaging', { skip }, t => {
  const f = fixture(t)
  f.git('tag', tag, f.head)
  f.write('client.js', 'new code without a version bump\n')
  const candidate = f.commit('candidate reuses version')
  const result = f.preflight({ GITHUB_SHA: candidate })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /already has tag .* use a new version/)
  assert.equal(f.git('rev-parse', tag), f.head)
  assert.equal(existsSync(f.path(zip)), false)
})

test('release preflight will not attest an archive with a different version or missing runtime files', { skip }, t => {
  const f = fixture(t)
  f.write('package.json', JSON.stringify({ name: 'dsh-purge', version: '0.9.9' }))
  const oldVersion = f.commit('different package version in archive')
  f.write('package.json', JSON.stringify({ name: 'dsh-purge', version }))
  let result = f.preflight({ GITHUB_SHA: oldVersion })
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(f.path('SHA256SUMS.txt')), false)
  rmSync(f.path('lib/artex-knowledge.js'))
  const missing = f.commit('archive excludes a required module')
  result = f.preflight({ GITHUB_SHA: missing })
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(f.path('SHA256SUMS.txt')), false)
})

test('existing published GitHub Release fails closed without replacing assets', { skip }, t => {
  const f = fixture(t)
  writeFileSync(f.ghExecutable, '#!/bin/sh\nprintf "%s\n" "$*" >> "$PREFLIGHT_GH_PROBE"\nif [ "$1" = release ] && [ "$2" = view ]; then exit 0; fi\nexit 98\n', { mode: 0o700 })
  const result = f.run('bash', ['-c', releaseStep.run], {
    GITHUB_REPOSITORY: 'wxcvm/dsh-purge',
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'master',
    GITHUB_SHA: f.head, DRY_RUN: 'false',
  })
  assert.notEqual(result.status, 0, 'preexisting release must block publication')
  assert.match(result.stdout + result.stderr, /already exists; refusing to overwrite immutable assets/)
  assert.deepEqual(readFileSync(f.ghCalled, 'utf8').trim().split('\n'), ['release view ' + tag],
    'no release create or upload may run after an existing release is observed')
  assert.equal(f.git('tag', '--list'), '', 'local repository tags are unchanged')
})
