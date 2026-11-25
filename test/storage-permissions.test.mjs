import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, rmSync, existsSync, readFileSync, linkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

const onUnix = process.platform !== 'win32'
const mode = (p) => statSync(p).mode & 0o777

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-private-'))
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, store }
}

test('new workspaces and databases are private on POSIX systems', { skip: !onUnix }, (t) => {
  const { root, store } = fixture(t)
  const id = store.openEngagement('private-credentials').id
  for (const dir of [root, store.engagementsDir, store.dirOf(id), join(store.dirOf(id), 'reports'), store.archiveDir()]) {
    assert.equal(mode(dir), 0o700, dir)
  }
  assert.equal(mode(store.dbPathOf(id)), 0o600)
  assert.equal(mode(store.currentPath()), 0o600)
})

test('opening a legacy workspace tightens existing database and directory permissions', { skip: !onUnix }, (t) => {
  const { store } = fixture(t)
  const id = store.openEngagement('legacy').id
  store.close()
  chmodSync(store.dirOf(id), 0o755)
  chmodSync(store.dbPathOf(id), 0o644)
  chmodSync(store.engagementsDir, 0o755)
  store.listEngagements()
  assert.equal(mode(store.engagementsDir), 0o700)
  assert.equal(mode(store.dirOf(id)), 0o700)
  assert.equal(mode(store.dbPathOf(id)), 0o600)
})

test('current workspace data and SQLite contents remain usable', (t) => {
  const { store } = fixture(t)
  const id = store.openEngagement('compatible').id
  assert.ok(existsSync(store.dbPathOf(id)))
  assert.equal(store.activeEngagementId(), id)
  assert.ok(store.stats(id))
  store.archiveDir()
})

test('updating workspace selection atomically replaces a hard-linked pointer without changing its other file', { skip: !onUnix }, (t) => {
  const { root, store } = fixture(t)
  const id = store.openEngagement('atomic-selection').id
  const unrelated = join(root, 'unrelated.txt')
  writeFileSync(unrelated, 'preserve original contents', { mode: 0o644 })
  unlinkSync(store.currentPath())
  linkSync(unrelated, store.currentPath())
  assert.equal(store.setActiveEngagement(id), true)
  assert.equal(readFileSync(unrelated, 'utf8'), 'preserve original contents')
  assert.equal(store.activeEngagementId(), id)
  assert.equal(mode(store.currentPath()), 0o600)
})

test('workspace metadata replacement preserves linked file contents and private mode', { skip: !onUnix }, t => {
  const { root, store } = fixture(t)
  const id = store.openEngagement('metadata-fixture').id
  const meta = store.metaPathOf(id)
  const original = readFileSync(meta, 'utf8')
  const other = join(root, 'metadata-original.txt')
  linkSync(meta, other)
  store.openEngagement('metadata-fixture')
  assert.equal(readFileSync(other, 'utf8'), original)
  assert.notEqual(statSync(meta).ino, statSync(other).ino)
  assert.equal(mode(meta), 0o600)
})

test('clearing a stale workspace pointer replaces the record without changing a linked file', { skip: !onUnix }, t => {
  const { root, store } = fixture(t)
  const other = join(root, 'stale-original.txt')
  writeFileSync(other, 'missing-fixture', { mode: 0o644 })
  linkSync(other, store.currentPath())
  const result = store.deleteEngagement('missing-fixture')
  assert.equal(result.not_found, true)
  assert.equal(readFileSync(other, 'utf8'), 'missing-fixture')
  assert.equal(readFileSync(store.currentPath(), 'utf8'), '')
  assert.equal(mode(store.currentPath()), 0o600)
})

test('archiving a synthetic workspace does not overwrite an unrelated linked selection file', { skip: !onUnix }, t => {
  const { root, store } = fixture(t)
  const id = store.openEngagement('archive-fixture').id
  const other = join(root, 'selection-original.txt')
  linkSync(store.currentPath(), other)
  const result = store.deleteEngagement(id)
  assert.equal(result.archived, true)
  assert.equal(readFileSync(other, 'utf8'), id)
  assert.equal(readFileSync(store.currentPath(), 'utf8'), '')
  assert.equal(mode(store.currentPath()), 0o600)
})
