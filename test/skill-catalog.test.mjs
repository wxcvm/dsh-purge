import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { aboutSecurityDir, communitySkillsDir, listLocalSkills, readLocalSkill, searchLocalSkills } from '../lib/redteam/skill-catalog.js'
import { unifiedKnowledgeRequest } from '../lib/redteam/knowledge-unified.js'

test('内建 redteam 技能可检索，无 AboutSecurity 时不影响原有技能', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-skill-search-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const entries = listLocalSkills({ home })
  assert.ok(entries.some((e) => e.key === 'redteam:web-injection'))
  const result = searchLocalSkills('web-injection', { home })
  assert.equal(result.aboutsecurity_installed, false)
  assert.ok(result.items.some((e) => e.key === 'redteam:web-injection'))
})

test('外部 AboutSecurity 的嵌套 SKILL.md 能搜索与按 key 读取', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-aboutsecurity-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = join(aboutSecurityDir(home), 'recon', 'passive-recon')
  mkdirSync(root, { recursive: true })
  const body = '---\nname: passive-recon\ndescription: "被动 OSINT 与威胁情报"\n---\n# 内容\n测试正文'
  writeFileSync(join(root, 'SKILL.md'), body)
  const result = searchLocalSkills('OSINT', { home })
  assert.equal(result.aboutsecurity_installed, true)
  assert.equal(result.total, 1)
  assert.equal(result.items[0].key, 'aboutsecurity:recon/passive-recon')
  assert.equal(readLocalSkill(result.items[0].key, { home }).content, body)
  assert.throws(() => readLocalSkill('aboutsecurity:../../secret', { home }), /not found/)
})

test('技能搜索、读取只读且返回数量受请求约束', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-skill-bounds-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const results = searchLocalSkills('', { home, limit: 3 })
  assert.equal(results.items.length, 3)
  const item = readLocalSkill('redteam:web-injection', { home, maxChars: 1000 })
  assert.equal(item.content.length <= 1000, true)
  assert.equal(item.key, 'redteam:web-injection')
})

test('块标量 description（| 与 >）要读成正文，而不是字面量管道符', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-skill-block-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const literal = join(aboutSecurityDir(home), 'ai-security', 'agent-security')
  mkdirSync(literal, { recursive: true })
  writeFileSync(join(literal, 'SKILL.md'), [
    '---',
    'name: agent-security',
    'description: |',
    '  AI Agent 系统安全测试方法论。',
    '  覆盖 OWASP Agentic AI Top 10。',
    'metadata:',
    '  category: ai-security',
    '---',
    '# 正文',
  ].join('\n'))
  const folded = join(aboutSecurityDir(home), 'web', 'xss')
  mkdirSync(folded, { recursive: true })
  writeFileSync(join(folded, 'SKILL.md'), [
    '---',
    'name: xss',
    'description: >',
    '  跨站脚本检测，',
    '  含上下文与绕过。',
    '---',
    '# 正文',
  ].join('\n'))

  const rows = listLocalSkills({ home }).filter((row) => row.source === 'aboutsecurity')
  const agent = rows.find((row) => row.name === 'agent-security')
  const xss = rows.find((row) => row.name === 'xss')
  assert.ok(agent.description.includes('AI Agent 系统安全测试方法论'), '块标量 | 必须展开成正文')
  assert.ok(!/^\s*[|>]\s*$/.test(agent.description), 'description 不能是字面量 | 或 >')
  assert.equal(xss.description, '跨站脚本检测， 含上下文与绕过。', '折叠标量按 YAML 语义用空格连接各行')
  assert.ok(!xss.description.includes('|'), '折叠标量不能残留标记')
})

test('内建业务安全控制技能可检索且只提供防御性审查内容', () => {
  const result = searchLocalSkills('business-security-controls')
  assert.ok(result.items.some(item => item.key === 'redteam:business-security-controls'))
  const skill = readLocalSkill('redteam:business-security-controls')
  assert.equal(skill.truncated, false)
  assert.match(skill.content, /合成账户、合成订单和虚拟余额/)
  assert.match(skill.content, /对象级授权/)
  assert.match(skill.content, /mock provider/)
  assert.match(skill.content, /verified: false/)
})


test('内建技能的 frontmatter 描述参与目录展示与检索', () => {
  const rows = listLocalSkills()
  const business = rows.find(row => row.key === 'redteam:business-security-controls')
  assert.ok(business)
  assert.match(business.description, /多租户隔离/)
  const result = searchLocalSkills('多租户隔离')
  assert.ok(result.items.some(row => row.key === 'redteam:business-security-controls'))
  const api = rows.find(row => row.key === 'redteam:api-attack')
  assert.ok(api.description.length > 0)
})

test('community Yaklang skill packs are searchable without replacing bundled entries', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-community-skills-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const community = communitySkillsDir(home)
  const hack = join(community, 'hack-skills', 'skills', 'api-security')
  const yak = join(community, 'yak-skills', 'skills', 'yaklang-syntax')
  mkdirSync(hack, { recursive: true })
  mkdirSync(yak, { recursive: true })
  writeFileSync(join(hack, 'SKILL.md'), '---\nname: api-security\ndescription: "API 安全审查"\n---\n# API 安全审查\nHACK_SKILL_CONTENT')
  writeFileSync(join(yak, 'SKILL.md'), '---\nname: yaklang-syntax\ndescription: "Yaklang 编程语法"\n---\n# Yaklang 语法\nYAK_SKILL_CONTENT')
  writeFileSync(join(yak, 'README.md'), '# Not a skill')
  mkdirSync(join(yak, 'examples'), { recursive: true })
  writeFileSync(join(yak, 'examples', 'usage.md'), '# Example, not a separate skill')
  const all = listLocalSkills({ home })
  assert.ok(all.some(row => row.key === 'redteam:web-injection'))
  const matches = all.filter(row => row.key.startsWith('redteam:community/'))
  assert.deepEqual(matches.map(row => row.key).sort(), [
    'redteam:community/hack-skills/api-security',
    'redteam:community/yak-skills/yaklang-syntax',
  ])
  assert.equal(matches.some(row => row.name === 'README'), false)
  const result = searchLocalSkills('Yaklang', { home })
  assert.equal(result.items[0].key, 'redteam:community/yak-skills/yaklang-syntax')
  assert.equal(result.items[0].community_source, 'yak-skills')
  const detail = readLocalSkill('redteam:community/hack-skills/api-security', { home })
  assert.match(detail.content, /HACK_SKILL_CONTENT/)
  const unified = unifiedKnowledgeRequest(home, {
    op: 'knowledgeUnifiedGet', source: 'redteam', id: 'redteam:community/yak-skills/yaklang-syntax',
  }, { home })
  assert.match(unified.item.body, /YAK_SKILL_CONTENT/)
  assert.equal(unified.item.community_source, 'yak-skills')
  assert.equal(unified.item.source_url, 'https://github.com/yaklang/yak-skills')
  const found = unifiedKnowledgeRequest(home, {
    op: 'knowledgeUnifiedSearch', source: 'redteam', query: 'Yaklang',
  }, { home })
  assert.equal(found.groups[0].items[0].category, 'community/yak-skills')
  assert.throws(() => readLocalSkill('redteam:community/hack-skills/../secret', { home }), /skill not found/)
})

test('optional community installer help runs without network or a checkout', () => {
  const script = fileURLToPath(new URL('../scripts/install-community-skills.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--source hack-skills\|yak-skills\|all/)
  assert.match(result.stdout, /--update/)
})


test('bundled skills expose the pinned upstream revision and license', () => {
  const skill = listLocalSkills().find((item) => item.name === 'active-scan')
  assert.ok(skill)
  assert.equal(skill.sourceMeta.repository, 'CallMeGuLab/dsh-purge-safe')
  assert.equal(skill.sourceMeta.revision, 'd0a9abda6e2eb020dde85b48b5727b45d26582a7')
  assert.equal(skill.sourceMeta.version, 'v2.0.1')
  assert.equal(skill.sourceMeta.license, 'Apache-2.0')
  assert.equal(skill.sourceMeta.adoption, 'adapted')
  assert.match(skill.sourceMeta.upstreamBlobSha, /^[a-f0-9]{40}$/)
})


test('2026-11-22 upstream absorption batch is discoverable and provenance-mapped', () => {
  const expected = [
    'ai-agent-attack', 'asset-correlation', 'asset-deep-scan', 'mobile-code-recon',
    'network-device', 'oob-verify', 'opsec-hygiene', 'supply-chain', 'host-post-exploit', 'netspy-recon',
    'api-attack', 'cloud-container',
  ]
  const rows = listLocalSkills()
  for (const name of expected) {
    const item = rows.find(row => row.key === 'redteam:' + name)
    assert.ok(item, name + ' must be present in the bundled skill catalog')
    assert.ok(item.description.trim().length > 0, name + ' must have a searchable description')
    assert.equal(item.sourceMeta.repository, 'CallMeGuLab/dsh-purge-safe', name)
    assert.equal(item.sourceMeta.revision, 'd0a9abda6e2eb020dde85b48b5727b45d26582a7', name)
    assert.equal(item.sourceMeta.version, 'v2.0.1', name)
    assert.equal(item.sourceMeta.license, 'Apache-2.0', name)
    assert.equal(item.sourceMeta.adoption, 'adapted', name)
    assert.match(item.sourceMeta.upstreamBlobSha, /^[a-f0-9]{40}$/, name)
  }
  assert.equal(rows.find(row => row.name === 'api-attack').sourceMeta.upstreamPath,
    'skills/redteam/api-data-exfil.md')
  assert.equal(rows.find(row => row.name === 'cloud-container').sourceMeta.upstreamPath,
    'skills/redteam/cloud-k8s.md')
  assert.equal(rows.find(row => row.name === 'host-post-exploit').sourceMeta.upstreamPath,
    'skills/redteam/host-post-exploit.md')
  assert.equal(rows.find(row => row.name === 'netspy-recon').sourceMeta.upstreamPath,
    'skills/redteam/netspy-recon.md')
})

test('newly absorbed skills reference only registered Purge tools', () => {
  const toolSource = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  const registered = new Set([...toolSource.matchAll(/name:\s*['"]((?:redteam)_[a-z0-9_]+)['"]/g)].map(match => match[1]))
  const names = [
    'ai-agent-attack', 'asset-correlation', 'asset-deep-scan', 'mobile-code-recon',
    'network-device', 'oob-verify', 'opsec-hygiene', 'supply-chain', 'host-post-exploit', 'netspy-recon',
    'api-attack', 'cloud-container',
  ]
  for (const name of names) {
    const skill = readLocalSkill('redteam:' + name)
    assert.ok(skill && skill.content, name + ' body must be readable')
    for (const match of skill.content.matchAll(/\x60(redteam_[a-z0-9_]+)(?:\([^`\n]*\))?\x60/g)) {
      assert.ok(registered.has(match[1]), name + ' references unregistered tool ' + match[1])
    }
    assert.doesNotMatch(skill.content, /\x60redteam_(?:data_proof|cleanup|pivot_probe)\x60/,
      name + ' must not claim unsupported upstream-only tools')
  }
})
