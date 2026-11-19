import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleSkillOp } from '../lib/redteam/ui.js'
import { communitySkillsDir } from '../lib/redteam/skill-catalog.js'

test('existing skills panel can list and read a community skill without native registry', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'purge-community-panel-'))
  const prior = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (prior === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prior
    rmSync(home, { recursive: true, force: true })
  })
  const folder = join(communitySkillsDir(home), 'yak-skills', 'skills', 'yaklang-syntax')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), '---\nname: yaklang-syntax\ndescription: "Yaklang syntax reference"\n---\n# Yaklang\nYAK_SYNTAX')
  const catalog = await handleSkillOp(null, { op: 'skillCatalog' })
  assert.equal(catalog.ok, true)
  assert.ok(catalog.items.some((item) => item.name === 'web-injection' && item.library === 'redteam'))
  const skill = catalog.items.find(item => item.name === 'community/yak-skills/yaklang-syntax')
  assert.ok(skill)
  assert.equal(skill.library, 'redteam')
  assert.equal(skill.source, 'yaklang/yak-skills')
  assert.equal(skill.fromPlugin, false)
  assert.equal(skill.hostListed, false)
  assert.equal(skill.availability, 'available')
  assert.ok(catalog.libraries.redteam >= 47)
  const detail = await handleSkillOp(null, { op: 'skillRead', library: 'redteam', name: skill.name })
  assert.equal(detail.ok, true)
  assert.equal(detail.name, skill.name)
  assert.match(detail.content, /YAK_SYNTAX/)
  const missing = await handleSkillOp(null, { op: 'skillRead', library: 'redteam', name: 'community/yak-skills/../sensitive' })
  assert.equal(missing.ok, false)
})
