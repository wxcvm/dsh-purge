#!/usr/bin/env node
/**
 * Explicit offline migration of legacy credential fields to AES-256-GCM.
 * Preview is the default; --apply performs per-workspace SQLite transactions.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

const args = process.argv.slice(2)
let apply = false
let root = process.env.REDTEAM_HOME
  || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'redteam')
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apply') apply = true
  else if (args[i] === '--root' && args[i + 1]) root = args[++i]
  else throw new Error('Usage: node scripts/secret-vault.mjs [--root PATH] [--apply]')
}
root = resolve(root)
if (!existsSync(join(root, 'engagements'))) {
  throw new Error('Purge red-team workspace does not exist: ' + root)
}
const store = new RedteamStore(root)
try {
  if (apply && !store.secretVault.enabled) {
    throw new Error('Set DSH_PURGE_SECRET_KEY (64 hex digits) before --apply')
  }
  const engagements = store.listEngagements()
    .filter(e => existsSync(store.dbPathOf(e.id)))
  console.log('Purge secret vault: ' + (apply ? 'APPLY' : 'PREVIEW')
    + ' / workspaces: ' + engagements.length)
  for (const item of engagements) {
    const before = store.secretVaultStatus(item.id)
    console.log(JSON.stringify({ id: item.id, before }))
    if (apply) {
      const changed = store.encryptExistingSecrets(item.id)
      console.log(JSON.stringify({ id: item.id, migrated: changed,
        after: store.secretVaultStatus(item.id) }))
    }
  }
  if (!apply) console.log('No files changed. Stop DSH, preserve your key and database backups, then use --apply to encrypt legacy fields.')
} finally {
  store.close()
}
