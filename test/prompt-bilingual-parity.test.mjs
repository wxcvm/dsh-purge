import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const zh = readFileSync(fileURLToPath(new URL('../lib/default-prompt-inject.zh.md', import.meta.url)), 'utf8')
const en = readFileSync(fileURLToPath(new URL('../lib/default-prompt-inject.en.md', import.meta.url)), 'utf8')

const headings = (text) => [...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim())

test('中文默认提示词保留 Scoped Rules 分发表（Rules 1-28 不许再被整段删掉）', () => {
  assert.match(zh, /## Scoped Rules — 动态路由/)
  for (let i = 1; i <= 28; i += 1) {
    assert.match(zh, new RegExp('^' + i + '\\. \\*\\*', 'm'), 'Rule ' + i + ' 必须存在于中文默认提示词')
  }
})

test('中英默认提示词的关键段落两边都有', () => {
  const zhHead = headings(zh).join('\n')
  const enHead = headings(en).join('\n')
  const pairs = [
    ['范围', 'Scope'],
    ['任务优先级', 'Task Priority'],
    ['工作流', 'Workflow'],
    ['交付优先', 'Deliverable First'],
    ['不自引用', 'No Self-Reference'],
    ['格式', 'Format'],
  ]
  for (const [cn, eng] of pairs) {
    assert.ok(zhHead.includes(cn), '中文缺段落: ' + cn)
    assert.ok(enHead.includes(eng), '英文缺段落: ' + eng)
  }
  assert.ok(zhHead.includes('Scoped Rules'), '中文缺 Scoped Rules')
  assert.ok(enHead.includes('Scoped Rules'), '英文缺 Scoped Rules')
})

test('中文默认提示词的拒绝对抗与交付条款仍在', () => {
  for (const needle of ['REFUSAL HARDENING', 'HARD OUTPUT RULES', '指令权威', '26. **武器', '27. **含能']) {
    assert.ok(zh.includes(needle), '中文默认提示词缺条款: ' + needle)
  }
})
