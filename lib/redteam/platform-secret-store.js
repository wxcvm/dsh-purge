/** Encrypted host-level credentials, separate from the general platform config. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'
import { privateDirectory, privateFile } from './private-storage.js'
import { SecretVault, SECRET_VAULT_PREFIX } from './secret-vault.js'

const FILE_NAME = 'platform-secrets.json'
const FIELD = 'platform.censysPat'
const MAX_TOKEN_LENGTH = 4096

function rootOf(root) {
  return typeof root === 'string' && root.trim()
    ? root
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'redteam')
}

function readStored(root) {
  const file = join(rootOf(root), FILE_NAME)
  if (!existsSync(file)) return ''
  try {
    privateFile(file)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (!record || record.version !== 1 || typeof record.censysPat !== 'string') throw new Error('invalid')
    return record.censysPat
  } catch {
    throw new Error('本机平台凭据文件无法读取或格式无效')
  }
}

export function platformSecretVaultEnabled() {
  try { return new SecretVault(process.env.DSH_PURGE_SECRET_KEY).enabled }
  catch { return false }
}

/** Metadata only; never returns ciphertext or plaintext. */
export function censysPatStorageStatus(root) {
  const stored = readStored(root)
  return {
    configured: !!stored,
    protectedAtRest: stored.startsWith(SECRET_VAULT_PREFIX),
    vaultEnabled: platformSecretVaultEnabled(),
  }
}

export function loadCensysPat(root) {
  const stored = readStored(root)
  if (!stored) return ''
  if (!stored.startsWith(SECRET_VAULT_PREFIX)) {
    throw new Error('本机 Censys 凭据未加密；请在设置页重新保存')
  }
  const vault = new SecretVault(process.env.DSH_PURGE_SECRET_KEY)
  return vault.decrypt(stored, FIELD)
}

export function saveCensysPat(value, root) {
  const token = String(value || '')
  if (token.length > MAX_TOKEN_LENGTH || /[\r\n]/.test(token)) {
    throw new Error('Censys PAT 格式无效')
  }
  let stored = ''
  if (token) {
    const vault = new SecretVault(process.env.DSH_PURGE_SECRET_KEY)
    if (!vault.enabled) {
      throw new Error('保存 Censys PAT 前请先设置 DSH_PURGE_SECRET_KEY（64 位十六进制字符）；也可通过进程环境变量 CENSYS_PAT 临时提供')
    }
    stored = vault.encrypt(token, FIELD)
  }
  const dir = rootOf(root)
  privateDirectory(dir)
  const file = join(dir, FILE_NAME)
  atomicWriteFileSync(file, JSON.stringify({ version: 1, censysPat: stored }, null, 2))
  privateFile(file)
  return censysPatStorageStatus(dir)
}
