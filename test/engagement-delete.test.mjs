/**
 * 删除靶标 = 归档。
 *
 * 为什么单独测：这是一个**不可在界面撤销**的动作，路径写错就是整场演练的记录没了。
 * 这里固定四条：目录被搬走而不是删掉、当前指针不会指空、重复/非法 id 会拒绝、
 * dispatch 层必须要求显式 confirm。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'

function storeInTemp(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eng-del-'))
  const store = new RedteamStore(root)
  t.after(() => {
    /* Windows 上 SQLite 句柄没关就删不掉目录，必须先 close 再删（close 是 store 的公开方法） */
    try { store.close() } catch { /* 已关闭就忽略 */ }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(root, { recursive: true, force: true })
        return
      } catch {
        /* Windows 释放句柄有延迟，重试几次再放弃（残留的临时目录不影响断言） */
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60)
      }
    }
  })
  return store
}

test('删除靶标只做归档：目录搬进 archive/，库文件跟着走', t => {
  const store = storeInTemp(t)
  const alpha = store.openEngagement('Alpha', [])
  const beta = store.openEngagement('Beta', [])
  store.setActiveEngagement(alpha.id)
  assert.equal(store.listEngagements().length, 2)

  const removed = store.deleteEngagement(alpha.id)
  assert.equal(removed.id, alpha.id)
  assert.equal(existsSync(store.dirOf(alpha.id)), false, '原目录应已不在 engagements/ 下')
  assert.ok(existsSync(removed.archived), '归档目录必须存在')
  assert.ok(existsSync(join(removed.archived, 'assets.db')), '归档里必须保留事实库')
  assert.ok(existsSync(join(removed.archived, 'engagement.yaml')), '归档里必须保留元数据')
  assert.equal(store.listEngagements().length, 1)
  assert.equal(store.listEngagements()[0].id, beta.id)
})

test('删掉当前靶标后指针回退到剩下的那个，不会指空', t => {
  const store = storeInTemp(t)
  const alpha = store.openEngagement('Alpha', [])
  const beta = store.openEngagement('Beta', [])
  store.setActiveEngagement(alpha.id)
  store.deleteEngagement(alpha.id)
  assert.equal(store.activeEngagementId(), beta.id)
  assert.equal(store.setActiveEngagement(alpha.id), false, '已删靶标不能再被设为当前')
})

test('重复删除、非法 id、不存在的靶标都要被拒绝', t => {
  const store = storeInTemp(t)
  const alpha = store.openEngagement('Alpha', [])
  store.deleteEngagement(alpha.id)
  assert.throws(() => store.deleteEngagement(alpha.id), /not found/)
  for (const bad of ['../etc', '', '   ', 'a/b']) {
    assert.throws(() => store.deleteEngagement(bad), /invalid engagement id|not found/)
  }
})

test('dispatch 层必须显式 confirm:true，且返回刷新后的名册', t => {
  const store = storeInTemp(t)
  const alpha = store.openEngagement('Alpha', [])
  store.openEngagement('Beta', [])

  const refused = dispatch(store, { op: 'deleteEngagement', engagement: alpha.id })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /confirm/)
  assert.equal(store.listEngagements().length, 2, '未确认时不能动任何东西')

  const done = dispatch(store, { op: 'deleteEngagement', engagement: alpha.id, confirm: true })
  assert.equal(done.ok, true)
  assert.equal(done.deleted, alpha.id)
  assert.equal(done.engagements.length, 1)
  assert.ok(done.current)
  assert.equal(existsSync(done.archived), true)
})
