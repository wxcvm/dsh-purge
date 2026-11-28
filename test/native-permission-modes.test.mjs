import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NATIVE_PERMISSION_MODES,
  NATIVE_PERMISSION_PATCH_IDS,
  isNativePermissionPatch,
  nativePermissionMode,
  nativePermissionPatches,
  normalizeNativePermissionMode,
  restoreNativePermissionText,
  restoreLegacyPermissionText,
  setNativePermissionMode,
} from '../lib/native-permission-enforcement.js'

test('strict 是默认姿态：25 条权限 patch 全部反转', (t) => {
  t.after(() => setNativePermissionMode('strict'))
  assert.equal(nativePermissionMode(), 'strict')
  assert.deepEqual([...NATIVE_PERMISSION_MODES], ['strict', 'redteam'])
  assert.equal(NATIVE_PERMISSION_PATCH_IDS.length, 25)
  assert.equal(nativePermissionPatches().length, 25)
  assert.equal(isNativePermissionPatch(5), true)
  assert.equal(isNativePermissionPatch({ id: 70 }), true)
})

test('redteam 姿态下 25 条权限 patch 恢复生效，其余行为不变', (t) => {
  t.after(() => setNativePermissionMode('strict'))
  setNativePermissionMode('redteam')
  assert.equal(nativePermissionMode(), 'redteam')
  assert.deepEqual(nativePermissionPatches(), [])
  for (const id of NATIVE_PERMISSION_PATCH_IDS) {
    assert.equal(isNativePermissionPatch(id), false, 'patch ' + id + ' must be effective in redteam mode')
  }
  const text = 'wider retries are auto-granted. // [dsh-purge] official approval teaching removed'
  const restored = restoreLegacyPermissionText(text)
  assert.equal(restored.changed, false, 'redteam 模式不得反转 approval 教学段')
  assert.equal(restored.text, text)
  const sample = { id: 5, replacements: [{ pattern: 'native-before', replace: 'purge-after' }], markers: [] }
  const untouched = restoreNativePermissionText('purge-after', sample)
  assert.equal(untouched.changed, false, 'redteam 模式不得把 patch 输出改回宿主原文')
})

test('模式取值只有 strict / redteam，未知值一律回落 strict', () => {
  assert.equal(normalizeNativePermissionMode('redteam'), 'redteam')
  assert.equal(normalizeNativePermissionMode('weird'), 'strict')
  assert.equal(normalizeNativePermissionMode(undefined), 'strict')
  assert.equal(setNativePermissionMode('redteam'), 'redteam')
  assert.equal(setNativePermissionMode(''), 'strict')
  assert.equal(nativePermissionMode(), 'strict')
})
