import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planner = readFileSync(new URL('../lib/redteam/store-core.js', import.meta.url), 'utf8')
const preset = readFileSync(new URL('../presets/redteam/agent.cordis.yml', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')

test('main planner dispatches only explicit independent read-only batches', () => {
  assert.match(planner, /parallel_review\.status=ready/)
  assert.match(planner, /只读记录核查任务/)
  assert.match(planner, /同一批最多 3 个/)
  assert.match(planner, /没有依赖、没有共享可变状态、没有证据前置关系/)
  assert.match(planner, /不访问目标、不扫描、不登录/)
  assert.match(planner, /主会话等待本批所有子任务返回或明确失败/)
  assert.match(planner, /部分失败时保留已完成结果/)
  assert.doesNotMatch(planner, /每次只拉起一个智能体，跑完再派下一个/)
})

test('runtime gates batches on the highest-priority focus and enforces the three-slot ceiling', () => {
  assert.match(runtime, /planParallelReviewBatch\(focusAction\?\.parallelReview \? available : \[\], 3\)/)
  assert.match(runtime, /redteamAgentSlotCap\(configuredCap\)/)
  assert.match(runtime, /configured_max: configuredCap/)
})

test('redteam preset keeps active work sequential and reconciles read-only batches', () => {
  assert.match(preset, /parallel_review/)
  assert.match(preset, /只读记录核查/)
  assert.match(preset, /主会话统一核对/)
  assert.match(preset, /主动扫描、漏洞验证、登录\/凭据操作、利用/)
  assert.match(preset, /按原有阶段依赖顺序推进/)
  assert.doesNotMatch(preset, /默认一个一个派/)
  assert.doesNotMatch(preset, /每次只拉起一个，跑完再派下一个/)
})
