/** Encrypted host-level credentials, separate from the general platform config. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'
import { privateDirectory, privateFile } from './private-storage.js'
import { SecretVault, SECRET_VAULT_PREFIX } from './secret-vault.js'

const FILE_NAME = 'platform-secrets.json'
const FIELDS = Object.freeze({
  censysPat: 'platform.censysPat',
  shodanApiKey: 'platform.shodanApiKey',
})
const MAX_TOKEN_LENGTH = 4096

function rootOf(root) {
  return typeof root === 'string' && root.trim()
    ? root
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'redteam')
}

function emptyRecord() {
  return { version: 1, censysPat: '', shodanApiKey: '' }
}

function readStored(root) {
  const file = join(rootOf(root), FILE_NAME)
  if (!existsSync(file)) return emptyRecord()
  try {
    privateFile(file)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (!record || record.version !== 1 || typeof record.censysPat !== 'string' ||
        (record.shodanApiKey !== undefined && typeof record.shodanApiKey !== 'string')) {
      throw new Error('invalid')
    }
    // Version 1 files created before Shodan support contain only censysPat.
    return { version: 1, censysPat: record.censysPat, shodanApiKey: record.shodanApiKey || '' }
  } catch {
    throw new Error('本机平台凭据文件无法读取或格式无效')
  }
}

function writeStored(root, record) {
  const dir = rootOf(root)
  privateDirectory(dir)
  const file = join(dir, FILE_NAME)
  atomicWriteFileSync(file, JSON.stringify({
    version: 1,
    censysPat: record.censysPat || '',
    shodanApiKey: record.shodanApiKey || '',
  }, null, 2))
  privateFile(file)
}

function storageStatus(field, root) {
  const file = join(rootOf(root), FILE_NAME)
  try {
    const record = readStored(root)
    const value = record[field]
    return {
      configured: !!value,
      protectedAtRest: !!value && value.startsWith(SECRET_VAULT_PREFIX),
      vaultEnabled: platformSecretVaultEnabled(),
      error: false,
    }
  } catch {
    return {
      configured: existsSync(file),
      protectedAtRest: false,
      vaultEnabled: platformSecretVaultEnabled(),
      error: true,
    }
  }
}

export function platformSecretVaultEnabled() {
  try { return new SecretVault(process.env.DSH_PURGE_SECRET_KEY).enabled }
  catch { return false }
}

/** Metadata only; never returns ciphertext or plaintext. */
export function censysPatStorageStatus(root) {
  return storageStatus('censysPat', root)
}

/** Metadata only; never returns ciphertext or plaintext. */
export function shodanApiKeyStorageStatus(root) {
  return storageStatus('shodanApiKey', root)
}

function loadSecret(field, root, label) {
  const stored = readStored(root)[field]
  if (!stored) return ''
  if (!stored.startsWith(SECRET_VAULT_PREFIX)) {
    throw new Error('本机 ' + label + ' 凭据未加密；请在设置页重新保存')
  }
  const vault = new SecretVault(process.env.DSH_PURGE_SECRET_KEY)
  return vault.decrypt(stored, FIELDS[field])
}

function saveSecret(value, root, field, label) {
  const token = String(value || '')
  if (token.length > MAX_TOKEN_LENGTH || /[\r\n]/.test(token)) {
    throw new Error(label + ' 格式无效')
  }
  const record = readStored(root)
  let stored = ''
  if (token) {
    const vault = new SecretVault(process.env.DSH_PURGE_SECRET_KEY)
    if (!vault.enabled) {
      throw new Error('保存 ' + label + ' 前请先设置 DSH_PURGE_SECRET_KEY（64 位十六进制字符）；也可通过进程环境变量临时提供')
    }
    // Preserve other credentials only when the current vault key can still unlock them.
    for (const other of Object.keys(FIELDS)) {
      if (other === field || !record[other]) continue
      if (!vault.isEncrypted(record[other])) {
        throw new Error('现有本机平台凭据未加密；请先完成迁移')
      }
      vault.decrypt(record[other], FIELDS[other])
    }
    stored = vault.encrypt(token, FIELDS[field])
  }
  record[field] = stored
  writeStored(root, record)
  return storageStatus(field, root)
}

export function loadCensysPat(root) {
  return loadSecret('censysPat', root, 'Censys')
}

export function saveCensysPat(value, root) {
  return saveSecret(value, root, 'Censys PAT')
}

export function loadShodanApiKey(root) {
  return loadSecret('shodanApiKey', root, 'Shodan')
}

export function saveShodanApiKey(value, root) {
  return saveSecret(value, root, 'Shodan API Key')
}
