import test from 'node:test'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectGitSource, readSourceLicense } from '../lib/redteam/source-provenance.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-source-provenance-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('source license status distinguishes MIT, unrecognized and undeclared', (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'LICENSE'), 'MIT License\n\nPermission is hereby granted.')
  assert.deepEqual(readSourceLicense(root), {
    license: 'MIT', licenseFile: 'LICENSE', licenseStatus: 'identified',
  })
  writeFileSync(join(root, 'LICENSE'), 'Custom terms without a recognized SPDX identifier.')
  assert.deepEqual(readSourceLicense(root), {
    license: null, licenseFile: 'LICENSE', licenseStatus: 'unrecognized',
  })
  unlinkSync(join(root, 'LICENSE'))
  assert.deepEqual(readSourceLicense(root), {
    license: null, licenseFile: null, licenseStatus: 'not-declared',
  })
  writeFileSync(join(root, 'LICENSE.md'), 'Apache License\nVersion 2.0, January 2004\n')
  assert.deepEqual(readSourceLicense(root), {
    license: 'Apache-2.0', licenseFile: 'LICENSE.md', licenseStatus: 'identified',
  })
  writeFileSync(join(root, 'LICENSE.md'), 'GNU GENERAL PUBLIC LICENSE\\nVersion 3, 29 June 2007\\n')
  assert.deepEqual(readSourceLicense(root), {
    license: null, licenseFile: 'LICENSE.md', licenseStatus: 'unrecognized',
  })
})

test('SPDX identifiers are preserved and exact Git HEAD is reported without a shell', (t) => {
  const root = fixture(t)
  writeFileSync(join(root, 'LICENSE.md'), 'SPDX-License-Identifier: Apache-2.0\n')
  const expected = 'a'.repeat(40)
  let called
  const result = inspectGitSource(root, (command, args, options) => {
    called = { command, args, options }
    return expected + '\n'
  })
  assert.equal(called.command, 'git')
  assert.deepEqual(called.args, ['-C', root, 'rev-parse', '--verify', 'HEAD'])
  assert.equal(called.options.encoding, 'utf8')
  assert.equal(result.revision, expected)
  assert.equal(result.license, 'Apache-2.0')
  assert.equal(result.licenseFile, 'LICENSE.md')
  assert.equal(result.licenseStatus, 'identified')
})

test('unavailable Git metadata does not fabricate a source revision', (t) => {
  const root = fixture(t)
  const result = inspectGitSource(root, () => { throw new Error('git unavailable') })
  assert.equal(result.revision, null)
  assert.equal(result.licenseStatus, 'not-declared')
})


test('reads the exact HEAD of a real local checkout', (t) => {
  const root = fixture(t)
  execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Purge Test'])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'purge-test@example.invalid'])
  execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false'])
  writeFileSync(join(root, 'LICENSE'), 'MIT License\\n')
  execFileSync('git', ['-C', root, 'add', 'LICENSE'], { stdio: 'ignore' })
  execFileSync('git', ['-C', root, 'commit', '-m', 'provenance fixture'], { stdio: 'ignore' })
  const result = inspectGitSource(root)
  assert.match(result.revision, /^[a-f0-9]{40}$/)
  assert.equal(result.license, 'MIT')
  assert.equal(result.licenseStatus, 'identified')
})
