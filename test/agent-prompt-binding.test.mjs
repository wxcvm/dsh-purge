/**
 * 角色提示词的执行边界校验。
 * 旧 exploit / internal 提示词不得再把目标操作指令暴露给模型。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROMPTS, ROLE_ORDER } from '../lib/redteam/store-core.js'

test('exploit role prompt is disabled and cannot direct target operations', () => {
  const prompt = DEFAULT_PROMPTS.exploit
  assert.match(prompt, /漏洞利用角色（已停用）/)
  assert.match(prompt, /dry_run=false 返回 unsupported/)
  assert.doesNotMatch(prompt, /webshell-toolkit|冰蝎|哥斯拉|password-spray|hydra|shell-handler|vps-reverse-shell/)
})

test('internal role prompt is disabled and cannot direct lateral movement', () => {
  const prompt = DEFAULT_PROMPTS.internal
  assert.match(prompt, /内网角色（已停用）/)
  assert.match(prompt, /status=unsupported|unsupported/)
  assert.doesNotMatch(prompt, /suo5-tunnel|proxychains|impacket-|gogo-intranet|fscan-intranet/)
})

test('all role prompts retain structured reporting tails', () => {
  for (const role of ROLE_ORDER) {
    assert.match(DEFAULT_PROMPTS[role], /redteamReport:/, role + ' 缺少 redteamReport 尾注')
    assert.match(DEFAULT_PROMPTS[role], /blocked_reason/, role + ' 缺少 blocked_reason')
  }
})
