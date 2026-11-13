import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const worker = fileURLToPath(new URL('./fixtures/task-recovery-worker.mjs', import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-process-recovery-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return (phase, expected = 0) => {
    const result = spawnSync(process.execPath, [worker, root, phase], { encoding: 'utf8', timeout: 30000, windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status, expected, phase + '\n' + result.stdout + '\n' + result.stderr)
    return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null
  }
}

test('24 dependent record tasks survive process restarts, route revision and lost write/submit acknowledgements', { timeout: 120000 }, t => {
  const run = fixture(t)
  run('setup')
  run('lost-write-ack', 86)
  run('lost-submit-ack', 87)
  run('finish')
  const first = run('audit')
  const again = run('audit')
  assert.deepEqual(again.counts, first.counts, 'repeated recovery must not duplicate delivery')
})

test('abrupt process exit before outer commit leaves neither evidence nor receipt and retry writes once', { timeout: 60000 }, t => {
  const run = fixture(t)
  run('rollback-setup')
  run('rollback-write', 88)
  assert.equal(run('rollback-audit').counts.http_evidence, 1)
})
