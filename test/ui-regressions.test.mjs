/**
 * UI 回归：这几条都是实际在面板上看见过的问题，用静态断言钉住。
 *
 * 1. 同一句注册说明只准渲染一次（曾经横幅 + 列表各渲染一遍，出现两条一模一样的提示）；
 * 2. 信息性区块用中性样式 .rt-note，不要套 .rt-hint（红色虚线 = 纪律警示）；
 * 3. 技能目录标题不再自称「DSH 原生」——面板展示的是本地文件清单；
 * 4. AboutSecurity 必须能卸载，且二次确认；
 * 5. 指南页签与「删除靶标」入口不能再次消失。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const client = readFileSync(fileURLToPath(new URL('../lib/redteam/client.js', import.meta.url)), 'utf8')

test('注册状态说明只渲染一次', () => {
  const hits = client.match(/meta\.note/g) || []
  assert.equal(hits.length, 1, 'meta.note 出现了 ' + hits.length + ' 次，会在面板上重复显示')
})

test('信息性区块使用中性样式 rt-note，且样式已定义', () => {
  assert.match(client, /\.rt-note\{/, '.rt-note 样式缺失')
  assert.ok(client.includes("className: 'rt-note'"), 'AboutSecurity 卡片应使用 rt-note')
  assert.ok(client.includes("=== 'panel-no-agent') ? 'rt-note' : 'rt-hint'"), 'panel-no-agent 提示应为中性样式')
})

test('技能目录标题不再自称 DSH 原生', () => {
  assert.ok(client.includes("'技能目录'"), '标题应为「技能目录」')
  assert.ok(!client.includes('技能目录（DSH 原生）'), '标题不应再写「DSH 原生」——面板展示的是本地文件')
})

test('AboutSecurity 可卸载且需要二次确认', () => {
  assert.ok(client.includes("op: 'aboutSecurityRemove'"), '缺少卸载调用')
  assert.ok(client.includes('确认卸载'), '缺少二次确认文案')
  assert.match(client, /const \[removeArmed, setRemoveArmed\]/, '缺少卸载上膛状态')
})

test('指南页签与删除靶标入口仍在', () => {
  assert.match(client, /\['guide', '指南'\]/, '指南页签不见了')
  assert.ok(client.includes('归档靶标'), '归档靶标按钮不见了')
  assert.ok(client.includes('已归档靶标'), '归档恢复区不见了')
})
