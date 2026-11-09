import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { aboutSecurityDir } from '../lib/redteam/skill-catalog.js'
import { aboutSecurityStatus, startAboutSecurity } from '../lib/redteam/aboutsecurity-manager.js'
import { handleAboutSecurityOp, handleSkillOp } from '../lib/redteam/ui.js'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'purge-aboutsecurity-ui-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    rmSync(home, { recursive: true, force: true })
  })
  return home
}
function putSkill(root) {
  const skill = join(root, 'recon', 'passive-recon', 'SKILL.md')
  mkdirSync(dirname(skill), { recursive: true })
  writeFileSync(skill, '---\nname: passive-recon\ndescription: "被动 OSINT"\n---\n# 被动检索')
}
test('AboutSecurity absent: status is read-only and builtin skill directory remains visible', async (t) => {
  const home = fixture(t)
  const snap = handleAboutSecurityOp({ op: 'aboutSecurityStatus' })
  assert.equal(snap.ok, true)
  assert.equal(snap.installed, false)
  assert.equal(snap.skills, 0)
  assert.equal(aboutSecurityStatus({ home }).busy, false)
  const catalog = await handleSkillOp({}, { op: 'skillCatalog' })
  assert.equal(catalog.ok, true)
  assert.ok(catalog.items.some((x) => x.library === 'redteam'))
  assert.equal(catalog.libraries.aboutsecurity, 0)
})

test('existing AboutSecurity skills show separately, with a readable body and no false native registry claim', async (t) => {
  const home = fixture(t)
  const root = aboutSecurityDir(home)
  mkdirSync(join(dirname(root), '.git'), { recursive: true })
  putSkill(root)
  const snap = handleAboutSecurityOp({ op: 'aboutSecurityStatus' })
  assert.equal(snap.installed, true)
  assert.equal(snap.skills, 1)
  const catalog = await handleSkillOp({}, { op: 'skillCatalog' })
  const item = catalog.items.find((x) => x.library === 'aboutsecurity' && x.name === 'recon/passive-recon')
  assert.ok(item, 'external skill should appear in catalog')
  assert.equal(item.hostListed, false)
  assert.equal(catalog.items.filter((x) => x.library === 'aboutsecurity').length, 1)
  const detail = await handleSkillOp({}, { op: 'skillRead', library: item.library, name: item.name })
  assert.equal(detail.ok, true)
  assert.ok(detail.content.includes('被动检索'))
  await assert.rejects(() => handleSkillOp({}, { op: 'skillRead', library: 'aboutsecurity', name: '../../outside' }), /not found/)
})

test('explicit install is asynchronous, updates status and does not start automatically', async (t) => {
  const home = fixture(t)
  const commands = []
  const start = startAboutSecurity({ home, runGit: async (argv) => {
    commands.push(argv)
    if (argv[0] === 'clone') {
      mkdirSync(join(argv.at(-1), '.git'), { recursive: true })
      putSkill(join(argv.at(-1), 'skills'))
    }
  } })
  assert.equal(start.ok, true)
  assert.equal(start.busy, true)
  for (let i = 0; i < 30 && aboutSecurityStatus({ home }).busy; i++) await delay(10)
  const ready = aboutSecurityStatus({ home })
  assert.equal(ready.busy, false)
  assert.equal(ready.installed, true)
  assert.equal(ready.skills, 1)
  assert.equal(commands[0][0], 'clone')
  assert.equal(commands[1][2], 'sparse-checkout')
  const again = startAboutSecurity({ home, runGit: async () => { throw new Error('should not run') } })
  assert.equal(again.ok, false)
  assert.equal(again.installed, true)
})
