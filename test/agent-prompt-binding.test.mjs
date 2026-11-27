/**
 * 角色提示词与作战智能体工具的绑定校验
 *
 * 目的：工具注册了但提示词没提，子智能体不会自发使用——链路等于断的。
 * 这里把「工具名出现在对应角色提示词里」固化成断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROMPTS, ROLE_ORDER } from '../lib/redteam/store-core.js'

test('exploit 角色提示词引用 redteam_exploit_chain', () => {
  const prompt = DEFAULT_PROMPTS.exploit
  assert.match(prompt, /redteam_exploit_chain/, 'exploit 角色必须知道这个工具存在')
  assert.match(prompt, /dry_run/, '必须说明默认干运行')
  assert.match(prompt, /redteam_credential_add|redteam_webshell_add/,
    '必须强调成果要自己落库，工具跑完不等于得分')
})

test('internal 角色提示词引用 redteam_internal_campaign', () => {
  const prompt = DEFAULT_PROMPTS.internal
  assert.match(prompt, /redteam_internal_campaign/)
  assert.match(prompt, /dry_run/)
  assert.match(prompt, /redteam_asset_add|redteam_access_add/,
    '必须强调内网成果要自己落库')
  // 工具不自动套代理，这点必须讲清楚，否则会误以为传了 tunnel_listen 就走隧道
  assert.match(prompt, /--proxy|proxychains/,
    '必须说明 tunnel_listen 不会自动套代理')
})

test('两个角色提示词仍保留既有硬约束（未因新增段落丢失）', () => {
  // 不考虑工具链时本来就成立的纪律不能被新内容顶掉
  assert.match(DEFAULT_PROMPTS.exploit, /redteam_vuln_query/)
  assert.match(DEFAULT_PROMPTS.exploit, /webshell-toolkit|冰蝎|哥斯拉/)
  assert.match(DEFAULT_PROMPTS.internal, /redteam_tunnel_list/)
  assert.match(DEFAULT_PROMPTS.internal, /没有可用隧道就没有内网渗透的前提/)
})

test('所有角色提示词仍带结构化回报尾注', () => {
  for (const role of ROLE_ORDER) {
    assert.match(DEFAULT_PROMPTS[role], /redteamReport:/, role + ' 缺少 redteamReport 尾注')
    assert.match(DEFAULT_PROMPTS[role], /blocked_reason/, role + ' 缺少 blocked_reason')
  }
})
