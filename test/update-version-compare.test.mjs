import test from 'node:test'
import assert from 'node:assert/strict'
import { versionIsNewer } from '../lib/update.js'

test('#244 修复：wxcvm.N 预发布段的数字感知比较', () => {
  // 核心 bug：pre 段 "wxcvm.16" vs "wxcvm.7-beta.10" 走纯字符串比较，
  // "16" > "7-beta" 因首字符 '1'<'7' 判 false —— 正式版比 beta 版旧的反例。
  // 修复：pre 段比较对"数字开头"的片段优先按数值比较。
  assert.equal(versionIsNewer('1.1.92-wxcvm.16', '1.1.92-wxcvm.7-beta.10'), true, '正式 .16 应比 beta.10 新')
  assert.equal(versionIsNewer('1.1.92-wxcvm.16', '1.1.92-wxcvm.15'), true)
  assert.equal(versionIsNewer('1.1.92-wxcvm.16', '1.1.92-wxcvm.16'), false, '同版不算新')
  assert.equal(versionIsNewer('1.1.92-wxcvm.7-beta.10', '1.1.92-wxcvm.7-beta.9'), true, 'beta.10 应比 beta.9 新')
  assert.equal(versionIsNewer('1.1.92-wxcvm.7-beta.2', '1.1.92-wxcvm.7-beta.10'), false, 'beta.2 应比 beta.10 旧')
  assert.equal(versionIsNewer('1.1.92-wxcvm.7-beta.11', '1.1.92-wxcvm.7-beta.9'), true)
})

test('#244 修复：跨量级数字不再按字串长度误判', () => {
  assert.equal(versionIsNewer('1.1.92-wxcvm.10', '1.1.92-wxcvm.9'), true, '.10 应比 .9 新')
  assert.equal(versionIsNewer('1.1.92-wxcvm.9', '1.1.92-wxcvm.10'), false)
  assert.equal(versionIsNewer('1.1.92-wxcvm.100', '1.1.92-wxcvm.99'), true)
})

test('既有语义回归：core 三段与稳定版/预发布优先级', () => {
  assert.equal(versionIsNewer('1.1.93', '1.1.92-wxcvm.16'), true, 'core 更高即更新')
  assert.equal(versionIsNewer('1.1.92', '1.1.92-wxcvm.16'), true, '无 pre 比有 pre 新（发布优先）')
  assert.equal(versionIsNewer('1.1.92-wxcvm.7-beta.1', '1.1.92'), false, 'beta 比同 core 正式版旧')
  assert.equal(versionIsNewer('2.0.0', '1.9.9-wxcvm.99'), true)
  assert.equal(versionIsNewer('', '1.0.0'), false, '空 remote 恒 false')
  assert.equal(versionIsNewer('1.0.0', ''), true, '空 local 恒 true')
})

test('build metadata does not change updater version precedence', () => {
  for (const version of ['1.1.92', '1.1.92-wxcvm.24', '1.1.92-wxcvm.7-beta.10']) {
    assert.equal(versionIsNewer(version + '+build.20', version), false)
    assert.equal(versionIsNewer(version, version + '+build.20'), false)
    assert.equal(versionIsNewer(version + '+build-20', 'v' + version + '+build.9'), false)
    assert.equal(versionIsNewer('v' + version + '+build.9', version + '+build-20'), false)
  }
  assert.equal(versionIsNewer('1.1.92-wxcvm.25+build.1', '1.1.92-wxcvm.24+build.99'), true)
  assert.equal(versionIsNewer('1.1.92-wxcvm.7-beta.10+build.1', '1.1.92-wxcvm.7-beta.9+build.99'), true)
  assert.equal(versionIsNewer('1.1.92+build-1', '1.1.92-wxcvm.24+build.99'), true)
})
