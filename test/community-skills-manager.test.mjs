import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { communitySkillsDir } from '../lib/redteam/skill-catalog.js'
import {
  communitySkillStatus, startCommunitySkillPack, installCommunitySkillPack, removeCommunitySkillPack,
} from '../lib/redteam/community-skills-manager.js'
import { handleCommunitySkillOp } from '../lib/redteam/ui.js'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'purge-community-manager-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
const putSkill = folder => {
  const path = join(folder, 'skills', 'yaklang-syntax')
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'SKILL.md'), '# Yaklang\nExample')
}

test('status is read-only; unknown pack does not start any checkout', async t => {
  const home = fixture(t)
  const status = communitySkillStatus({ home })
  assert.equal(status.ok, true)
  assert.equal(status.busy, false)
  assert.deepEqual(status.packs.map(p => p.id), ['hack-skills', 'yak-skills'])
  assert.equal(existsSync(communitySkillsDir(home)), false)
  const result = await installCommunitySkillPack({ home, pack: '../../outside' })
  assert.equal(result.ok, false)
  assert.equal(existsSync(communitySkillsDir(home)), false)
})

test('explicit checkout installs, becomes readable, and cannot silently overwrite', async t => {
  const home = fixture(t)
  const calls = []
  const runGit = async argv => {
    calls.push(argv)
    if (argv[0] === 'clone') {
      mkdirSync(join(argv.at(-1), '.git'), { recursive: true })
      putSkill(argv.at(-1))
    }
  }
  const result = await installCommunitySkillPack({ home, pack: 'yak-skills', runGit })
  assert.equal(result.ok, true)
  assert.equal(result.packs.find(p => p.id === 'yak-skills').skills, 1)
  assert.equal(calls[0][0], 'clone')
  assert.ok(calls[0].includes('https://github.com/yaklang/yak-skills.git'))
  assert.equal(calls[1][2], 'sparse-checkout')
  const again = await installCommunitySkillPack({ home, pack: 'yak-skills', runGit: async () => { throw Error('should not clone') } })
  assert.equal(again.ok, false)
  assert.equal(communitySkillStatus({ home }).packs.find(p => p.id === 'yak-skills').installed, true)
})

test('update uses same checkout and no new clone', async t => {
  const home = fixture(t)
  const target = join(communitySkillsDir(home), 'hack-skills')
  mkdirSync(join(target, '.git'), { recursive: true })
  putSkill(target)
  const commands = []
  const result = await installCommunitySkillPack({ home, pack: 'hack-skills', update: true, runGit: async argv => { commands.push(argv) } })
  assert.equal(result.ok, true)
  assert.equal(commands[0][0], '-C')
  assert.equal(commands[0][2], 'pull')
  assert.equal(commands[1][2], 'sparse-checkout')
  assert.equal(existsSync(join(target, 'skills', 'yaklang-syntax', 'SKILL.md')), true)
})

test('failed clone cleans staged folder and returns visible error', async t => {
  const home = fixture(t)
  const result = await installCommunitySkillPack({ home, pack: 'hack-skills',
    runGit: async () => { throw Error('simulated connection failure') } })
  assert.equal(result.ok, false)
  assert.match(result.error, /simulated connection failure/)
  assert.equal(communitySkillStatus({ home }).packs.find(p => p.id === 'hack-skills').busy, false)
  assert.equal(existsSync(join(communitySkillsDir(home), 'hack-skills')), false)
})

test('panel operations expose explicit status and reject invalid install', t => {
  const home = fixture(t)
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved })
  assert.equal(handleCommunitySkillOp({ op: 'communitySkillStatus' }).packs.length, 2)
  assert.equal(handleCommunitySkillOp({ op: 'communitySkillInstall', pack: '../../elsewhere' }).ok, false)
  assert.equal(handleCommunitySkillOp({ op: 'notACommunitySkillOp' }), undefined)
})

test('uninstall removes only selected Git checkout, leaves other packs and user folder untouched', t => {
  const home = fixture(t)
  const root = communitySkillsDir(home)
  const hack = join(root, 'hack-skills'), yak = join(root, 'yak-skills')
  mkdirSync(join(hack, '.git'), { recursive: true })
  mkdirSync(join(yak, '.git'), { recursive: true })
  putSkill(hack)
  putSkill(yak)
  const removed = removeCommunitySkillPack({ home, pack: 'hack-skills' })
  assert.equal(removed.ok, true)
  assert.equal(removed.removed, true)
  assert.equal(existsSync(hack), false)
  assert.equal(existsSync(yak), true)
  const invalid = removeCommunitySkillPack({ home, pack: '../elsewhere' })
  assert.equal(invalid.ok, false)
  const custom = join(root, 'hack-skills')
  mkdirSync(custom, { recursive: true })
  writeFileSync(join(custom, 'user-notes.md'), 'keep me')
  const protectedResult = removeCommunitySkillPack({ home, pack: 'hack-skills' })
  assert.equal(protectedResult.ok, false)
  assert.equal(existsSync(join(custom, 'user-notes.md')), true)
})

test('panel removal requires explicit confirmation', t => {
  const home = fixture(t)
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old })
  const target = join(communitySkillsDir(home), 'yak-skills')
  mkdirSync(join(target, '.git'), { recursive: true })
  putSkill(target)
  assert.equal(handleCommunitySkillOp({ op: 'communitySkillRemove', pack: 'yak-skills' }).ok, false)
  assert.equal(existsSync(target), true)
  assert.equal(handleCommunitySkillOp({ op: 'communitySkillRemove', pack: 'yak-skills', confirm: true }).removed, true)
  assert.equal(existsSync(target), false)
})
