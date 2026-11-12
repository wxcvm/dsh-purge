import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { inspectStorageAcl, parseStorageAuditOutput } from '../lib/redteam/storage-audit.js'

const counts = {
  inspected: 5, broadRead: 2, otherRead: 1, inheritanceEnabled: 4,
  aclReadErrors: 0, skippedReparse: 0, enumerationErrors: 0,
}
const line = (value) => 'ACL_AUDIT ' + JSON.stringify(value) + '\r\n'
const root = 'C:\\Purge test\\redteam'

test('storage audit parser validates counts and drops unrecognized fields', () => {
  assert.deepEqual(parseStorageAuditOutput('preview\r\n' + line({
    ...counts, path: 'private-path', secret: 'private-value',
  })), counts)
  for (const output of [
    '', 'ACL_AUDIT broken', line(counts) + line(counts),
    line({ ...counts, inspected: -1 }), line({ ...counts, broadRead: 6 }),
    line({ ...counts, otherRead: '1' }), line({ ...counts, aclReadErrors: 0.5 }),
    line({ ...counts, inspected: 0, broadRead: 0, otherRead: 0, inheritanceEnabled: 0 }),
  ]) assert.equal(parseStorageAuditOutput(output), null)
})

test('storage audit executes only the packaged read-only preview with a fixed root', async () => {
  const result = await inspectStorageAcl(root, {
    platform: 'win32',
    run: async (executable, args, options) => {
      assert.equal(win32.basename(executable), 'powershell.exe')
      assert.ok(win32.isAbsolute(executable))
      assert.deepEqual(args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'])
      assert.equal(args[4], '-File')
      assert.match(args[5], /protect-redteam-acl\.ps1$/)
      assert.deepEqual(args.slice(6), ['-Root', root])
      assert.equal(args.includes('-Apply'), false)
      assert.equal(args.includes('-Details'), false)
      assert.equal(options.windowsHide, true)
      assert.equal(options.timeout, 60000)
      assert.equal(options.maxBuffer, 65536)
      return { stdout: line(counts) }
    },
  })
  assert.deepEqual(result, { ok: true, status: 'complete', counts })
})

test('storage audit preserves partial, timeout, unsupported and invalid states without raw errors', async () => {
  const partial = { ...counts, skippedReparse: 1 }
  const result = await inspectStorageAcl(root, {
    platform: 'win32', run: async () => ({ stdout: line(partial) }),
  })
  assert.deepEqual(result, { ok: true, status: 'partial', counts: partial })
  for (const key of ['aclReadErrors', 'enumerationErrors']) {
    const failed = { ...counts, [key]: 1 }
    assert.equal((await inspectStorageAcl(root, {
      platform: 'win32', run: async () => ({ stdout: line(failed) }),
    })).status, 'partial')
  }
  const noRun = async () => { assert.fail('must not execute') }
  assert.deepEqual(await inspectStorageAcl(root, { platform: 'linux', run: noRun }),
    { ok: false, status: 'unsupported' })
  assert.deepEqual(await inspectStorageAcl('relative-root', { platform: 'win32', run: noRun }),
    { ok: false, status: 'unavailable' })
  assert.deepEqual(await inspectStorageAcl(root, { platform: 'win32',
    run: async () => ({ stdout: 'private-path' }) }), { ok: false, status: 'invalid_response' })
  assert.deepEqual(await inspectStorageAcl(root, { platform: 'win32',
    run: async () => { throw Object.assign(new Error('private-path'), { killed: true }) } }),
    { ok: false, status: 'timeout' })
  assert.deepEqual(await inspectStorageAcl(root, { platform: 'win32',
    run: async () => { throw new Error('private-path') } }), { ok: false, status: 'unavailable' })
})

test('Windows packaged ACL preview runs against a temporary workspace', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'purge-storage-audit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'fixture.txt')
  writeFileSync(file, 'unchanged')
  const result = await inspectStorageAcl(dir)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'complete')
  assert.equal(result.counts.inspected, 2)
  assert.equal(readFileSync(file, 'utf8'), 'unchanged')
})

test('privacy panel uses the existing authenticated bridge and does not run audit automatically', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /request\.op === 'storageAclAudit'/)
  assert.match(host, /inspectStorageAcl\(\(store && store\.root\) \|\| redteamRoot\(\)\)/)
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const start = source.indexOf('function LowImpactTab(props)')
    const end = source.indexOf('const runStorageAudit =', start)
    assert.ok(start >= 0 && end > start)
    assert.doesNotMatch(source.slice(start, end), /storageAclAudit/)
    assert.match(source, /api\(\{ op: 'storageAclAudit' \}\)/)
    assert.match(source, /onClick: runStorageAudit/)
    assert.match(source, /Windows 存储权限诊断/)
    assert.match(source, /部分检查完成/)
  }
})
