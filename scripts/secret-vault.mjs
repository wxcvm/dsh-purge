#!/usr/bin/env node
/**
 * Explicit offline migration of legacy credential fields to AES-256-GCM.
 * Default preview uses read-only SQLite and cannot write to workspaces.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
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
const base = join(root, 'engagements')
if (!existsSync(base) || !lstatSync(base).isDirectory() || lstatSync(base).isSymbolicLink()) {
  throw new Error('Purge red-team workspace directory does not exist or is not a real directory: ' + base)
}

const targets = readdirSync(base, { withFileTypes: true })
  .filter(item => item.isDirectory() && !item.isSymbolicLink())
  .map(item => ({ id: item.name, file: join(base, item.name, 'assets.db') }))
  .filter(item => existsSync(item.file) && lstatSync(item.file).isFile() && !lstatSync(item.file).isSymbolicLink())

function preview(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const output = { credential: { plaintext: 0, encrypted: 0 }, webshell: { plaintext: 0, encrypted: 0 } }
    for (const [table, field] of [['credential', 'secret_value'], ['webshell', 'pass_key']]) {
      for (const { value } of db.prepare(`SELECT ${field} AS value FROM ${table} WHERE ${field} IS NOT NULL AND ${field} <> ''`).all()) {
        output[table][value.startsWith('dshp:vault:v1:') ? 'encrypted' : 'plaintext']++
      }
    }
    return output
  } finally {
    db.close()
  }
}

if (!apply) {
  console.log('Purge secret vault: PREVIEW / workspaces: ' + targets.length)
  for (const target of targets) console.log(JSON.stringify({ id: target.id, before: preview(target.file) }))
  console.log('Preview used read-only databases; no files changed. Back up the key and stop DSH before --apply.')
} else {
  const store = new RedteamStore(root)
  try {
    if (!store.secretVault.enabled) throw new Error('Set DSH_PURGE_SECRET_KEY (64 hex digits) before --apply')
    console.log('Purge secret vault: APPLY / workspaces: ' + targets.length)
    for (const item of targets) {
      const before = store.secretVaultStatus(item.id)
      const changed = store.encryptExistingSecrets(item.id)
      console.log(JSON.stringify({ id: item.id, before, migrated: changed,
        after: store.secretVaultStatus(item.id) }))
    }
  } finally {
    store.close()
  }
}
