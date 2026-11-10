/**
 * 宿主 agentPresets 的能力探测。
 *
 * DSH 0.2.2-rc.1 的 `@deepseek-ai/dsh-agent-preset-registry` 对外只有
 * defaultId / presetForSession / composedPreset / register / activate，
 * 没有 `standingKeyFor`。面板原来直接用它，于是服务在也会被判成"尚未获取服务"，
 * 技能目录一直退化成读本地文件，提示还说错原因。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { presetScopeApi } from '../lib/redteam/skill-registry-state.js'

test('没有服务 → missing', () => {
  assert.equal(presetScopeApi(undefined), 'missing')
  assert.equal(presetScopeApi({}), 'unknown-api')
  assert.equal(presetScopeApi(null), 'missing')
})

test('服务在但没有 standingKeyFor、有 composedPreset → agent-scope（不是 missing）', () => {
  const registry = { defaultId: 'standard', presetForSession() {}, composedPreset() {} }
  assert.equal(presetScopeApi(registry), 'agent-scope')
})

test('提供 standingKeyFor → standing-key-for', () => {
  assert.equal(presetScopeApi({ standingKeyFor: async () => ({}) }), 'standing-key-for')
})
