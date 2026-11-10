/**
 * Optional application-layer at-rest encryption for Purge credential fields.
 *
 * A 32-byte operator-supplied key is required. No local key is generated or
 * stored alongside the SQLite database. Legacy plaintext remains readable.
 * Encrypted values without the key fail closed instead of returning ciphertext
 * to callers or overwriting records.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'dshp:vault:v1:'
const NONCE_BYTES = 12
const TAG_BYTES = 16

export class SecretVault {
  constructor(keyHex = '') {
    const input = String(keyHex || '')
    if (input && !/^[\da-fA-F]{64}$/.test(input)) {
      throw new Error('DSH_PURGE_SECRET_KEY must be exactly 64 hexadecimal characters (32 bytes)')
    }
    this.key = input ? Buffer.from(input, 'hex') : null
  }

  get enabled() { return this.key !== null }

  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX)
  }

  encrypt(value, field) {
    if (value === null || value === undefined || value === '') return value
    const plain = String(value)
    if (this.isEncrypted(plain)) {
      // Do not encrypt ciphertext twice. Validate before accepting it.
      this.decrypt(plain, field)
      return plain
    }
    if (!this.key) return plain
    const iv = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(field))
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
  }

  decrypt(value, field) {
    if (!this.isEncrypted(value)) return value
    if (!this.key) {
      throw new Error('Encrypted Purge secret requires DSH_PURGE_SECRET_KEY; no plaintext fallback was used')
    }
    try {
      const buf = Buffer.from(value.slice(PREFIX.length), 'base64url')
      if (buf.length < NONCE_BYTES + TAG_BYTES + 1) throw new Error('short encrypted secret')
      const iv = buf.subarray(0, NONCE_BYTES)
      const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES)
      const body = buf.subarray(NONCE_BYTES + TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
      decipher.setAAD(Buffer.from(field))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    } catch {
      throw new Error('Cannot decrypt Purge secret: wrong DSH_PURGE_SECRET_KEY or corrupted ciphertext')
    }
  }
}
