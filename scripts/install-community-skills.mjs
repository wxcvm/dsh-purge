#!/usr/bin/env node
/** Explicit CLI for the same community skills manager used by Purge's panel. */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { communityPacks, communitySkillStatus, installCommunitySkillPack } from '../lib/redteam/community-skills-manager.js'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/install-community-skills.mjs [--source hack-skills|yak-skills|all] [--home DSH_HOME] [--update]')
  console.log('Default: install both packs once; use --update to refresh existing Git checkouts.')
  process.exit(0)
}
const valueAfter = flag => {
  const index = args.indexOf(flag)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(flag + ' requires a value')
  return value
}
const source = valueAfter('--source') || 'all'
if (source !== 'all' && !Object.hasOwn(communityPacks, source)) throw new Error('unknown skill source: ' + source)
const home = resolve(valueAfter('--home') || process.env.DSH_HOME || join(homedir(), '.dsh'))
const packs = source === 'all' ? Object.keys(communityPacks) : [source]
for (const pack of packs) {
  const existing = communitySkillStatus({ home }).packs.find(p => p.id === pack)
  if (existing.installed && !args.includes('--update')) {
    console.log(pack + ': already installed; use --update to refresh')
    continue
  }
  const result = await installCommunitySkillPack({ pack, home, update: args.includes('--update') })
  if (!result.ok) {
    console.error(pack + ': ' + (result.error || 'installation failed'))
    process.exitCode = 1
    continue
  }
  const item = result.packs.find(p => p.id === pack)
  console.log(pack + ': ' + item.skills + ' skills ready')
}
console.log('Community packs can be searched and opened in the existing Purge skills panel.')
