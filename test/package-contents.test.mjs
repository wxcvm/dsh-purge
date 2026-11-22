import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractZipBuffer, listZipEntries } from '../lib/zip-extract.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
const source = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
const required = [
  'package.json',
  'client.js',
  'cordis.patch.yml',
  'lib/index.js',
  'bin/dsh-purge.js',
  'lib/update.js',
  'lib/workspace/runtime-panel.js',
  'lib/redteam/index.js',
  'lib/redteam/store-core.js',
  'scripts/ensure-profile-bundle.mjs',
  'maintenance/README.md',
  'LICENSE',
  'NOTICE',
  'scripts/redteam-setup.sh',
  'skills/redteam/active-scan.md',
  'skills/redteam/source-manifest.json',
  'maintenance/inject-switch/Build.ps1',
]

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repo, windowsHide: true, timeout: 60_000, ...options,
  })
  assert.equal(result.status, 0, `${cmd} ${args.join(' ')}: ${
    result.error?.message || String(result.stderr || '') || result.signal || 'no exit status'
  }`)
  return result.stdout
}

const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding)

function checkArchive(label, names, prefix, read) {
  const files = new Set()
  for (const name of names) {
    assert.ok(name.startsWith(prefix), `${label} contains path outside ${prefix}: ${name}`)
    const parts = name.slice(prefix.length).split('/')
    assert.ok(!parts.includes('..'), `${label} contains an unsafe path: ${name}`)
    if (!name.endsWith('/')) files.add(name.slice(prefix.length))
  }
  for (const entry of required) {
    assert.ok(files.has(entry), `${label} omits ${entry}`)
  }
  assert.ok([...files].filter(file => file.startsWith('skills/redteam/')).length > 20,
    `${label} omits most of the bundled skill library`)
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.name, source.name, `${label}: package name`)
  assert.equal(manifest.version, source.version, `${label}: version`)
  assert.equal(manifest.main, source.main, `${label}: package entry`)
  assert.deepEqual(manifest.bin, source.bin, `${label}: CLI entry`)
  for (const entry of [manifest.main, ...Object.values(manifest.bin)]) {
    // Check the packaged bytes without importing the plugin or running an install hook.
    run(process.execPath, ['--input-type=module', '--check'], { input: read(entry) })
  }
  return files
}

test('real npm tarball satisfies the package contract; CI also verifies a Git archive of the same checkout', t => {
  const parent = realpathSync(tmpdir())
  const temp = mkdtempSync(path.join(parent, 'purge package 制品 -'))
  t.after(() => {
    const resolved = realpathSync(temp)
    assert.equal(resolved, temp, 'refuse to remove a redirected test directory')
    assert.equal(path.dirname(resolved), parent)
    rmSync(temp, { recursive: true, force: true })
  })
  const verifyZip = process.env.PURGE_VERIFY_GIT_ARCHIVE === '1'
  // An archive comes from the Git tree, whereas npm reads the disk. In CI the
  // two must start from the same tracked checkout.
  if (verifyZip) run('git', ['diff', '--quiet', 'HEAD', '--'])

  const packOptions = {
    encoding: 'utf8',
    env: { ...process.env, npm_config_pack_destination: temp },
  }
  // On Windows npm is a cmd shim. Keep the shell command fixed and pass the
  // temp path through the environment, not a command string.
  const packed = process.platform === 'win32'
    ? run('npm.cmd pack --offline --json --ignore-scripts', [], { ...packOptions, shell: true })
    : run('npm', ['pack', '--offline', '--json', '--ignore-scripts'], packOptions)
  const [entry] = JSON.parse(packed)
  assert.equal(entry.filename, `${source.name}-${source.version}.tgz`)
  const tar = readFileSync(path.join(temp, entry.filename))
  assert.equal(tar.length, entry.size, 'npm tarball size')
  assert.equal(`sha512-${hash(tar, 'sha512', 'base64')}`, entry.integrity, 'npm tarball integrity')
  const tarNames = run('tar', ['-tzf', entry.filename], { cwd: temp }).toString('utf8').trimEnd().split(/\r?\n/)
  const tarDestination = path.join(temp, 'tar')
  mkdirSync(tarDestination)
  // Only archives produced by this test are ever extracted here.
  run('tar', ['-xzf', entry.filename, '-C', 'tar'], { cwd: temp })
  const tarRead = file => readFileSync(path.join(tarDestination, 'package', file))
  const tarFiles = checkArchive('npm tarball', tarNames, 'package/', tarRead)
  assert.ok(![...tarFiles].some(file => file.startsWith('maintenance/') && file.includes('/dist/')),
    'built maintenance binaries must be release artifacts, not bundled npm payload')
  assert.ok(!tarFiles.has('lib/default-prompt-inject.md'), 'local prompt source must not be packed by npm')
  t.diagnostic(`${entry.filename} SHA-256 ${hash(tar)}`)

  if (!verifyZip) return
  const zipName = `dsh-purge-${source.version}.zip`
  const prefix = `dsh-purge-${source.version}/`
  const zipPath = path.join(temp, zipName)
  run('git', ['archive', '--format=zip', `--prefix=${prefix}`, `--output=${zipPath}`, 'HEAD'])
  const zip = readFileSync(zipPath)
  const zipDestination = path.join(temp, 'zip')
  extractZipBuffer(zip, zipDestination)
  const zipRead = file => readFileSync(path.join(zipDestination, prefix, file))
  checkArchive('Git ZIP', listZipEntries(zip), prefix, zipRead)
  assert.equal(hash(zipRead('client.js')), hash(tarRead('client.js')), 'generated client differs between packages')
  t.diagnostic(`${zipName} SHA-256 ${hash(zip)}`)
})
