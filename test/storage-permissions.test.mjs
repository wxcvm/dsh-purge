import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, rmSync, existsSync } from 'node:fs'
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
