#!/usr/bin/env node
/**
 * On-demand Yaklang skill packs for Purge's existing read-only skill catalog.
 * Does not run on plugin startup, does not load plugins or execute skill files.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const PACKS = Object.freeze({
  'hack-skills': 'https://github.com/yaklang/hack-skills.git',
  'yak-skills': 'https://github.com/yaklang/yak-skills.git',
})
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/install-community-skills.mjs [--source hack-skills|yak-skills|all] [--home DSH_HOME] [--update]')
  console.log('Default: install both packs once, leaving already installed directories unchanged.')
  process.exit(0)
}
const valueAfter = key => {
  const index = args.indexOf(key)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(key + ' requires a value')
  return value
}
const source = valueAfter('--source') || 'all'
if (source !== 'all' && !Object.hasOwn(PACKS, source)) throw new Error('unknown skill source: ' + source)
const selected = source === 'all' ? Object.keys(PACKS) : [source]
const home = resolve(valueAfter('--home') || process.env.DSH_HOME || join(homedir(), '.dsh'))
const root = join(home, 'redteam', 'external-skills', 'community')
const update = args.includes('--update')

function git(argv) {
  const result = spawnSync('git', argv, { stdio: 'inherit', windowsHide: true, shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('git failed (' + result.status + ')')
}
function countSkills(folder) {
  const pending = [folder]
  let found = 0
  while (pending.length) {
    let entries
    const dir = pending.pop()
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(join(dir, entry.name))
      else if (entry.isFile() && entry.name === 'SKILL.md') found += 1
    }
  }
  return found
}

mkdirSync(root, { recursive: true })
for (const name of selected) {
  const target = join(root, name)
  const skills = join(target, 'skills')
  if (update) {
    if (!existsSync(join(target, '.git'))) throw new Error(name + ' is not an installed Git checkout')
    git(['-C', target, 'pull', '--ff-only'])
    git(['-C', target, 'sparse-checkout', 'set', 'skills'])
  } else if (existsSync(target)) {
    console.log(name + ': already present; use --update to refresh')
    continue
  } else {
    const stage = target + '.install-' + process.pid
    try {
      git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'main', PACKS[name], stage])
      git(['-C', stage, 'sparse-checkout', 'set', 'skills'])
      if (!countSkills(join(stage, 'skills'))) throw new Error(name + ' has no SKILL.md')
      renameSync(stage, target)
    } catch (error) {
      rmSync(stage, { recursive: true, force: true })
      throw error
    }
  }
  const total = countSkills(skills)
  if (!total) throw new Error(name + ': no SKILL.md found after checkout')
  console.log(name + ': ' + total + ' skills ready at ' + skills)
}
console.log('The existing redteam_skill_search / redteam_skill_read tools discover these files on the next request.')
