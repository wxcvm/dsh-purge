import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretVault } from '../lib/redteam/secret-vault.js'
import { RedteamStore } from '../lib/redteam/store-core.js'

const KEY = randomBytes(32).toString('hex')
const WRONG_KEY = randomBytes(32).toString('hex')

function fixture(t, secretKey = '') {
  const root = mkdtempSync(join(tmpdir(), 'purge-vault-'))
  const store = new RedteamStore(root, { secretKey })
  const stores = [store]
  t.after(() => {
    for (const current of stores.reverse()) current.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, store, track: (other) => { stores.push(other); return other } }
}

test('vault uses random AEAD ciphertext and authenticates field context', () => {
  const vault = new SecretVault(KEY)
  const one = vault.encrypt('测试口令:🪶', 'credential.secret_value')
  const two = vault.encrypt('测试口令:🪶', 'credential.secret_value')
  assert.notEqual(one, two, 'random GCM nonces must vary')
  assert.ok(!one.includes('测试口令'))
  assert.equal(vault.decrypt(one, 'credential.secret_value'), '测试口令:🪶')
  assert.throws(() => vault.decrypt(one, 'webshell.pass_key'), /Cannot decrypt/)
  assert.throws(() => new SecretVault(WRONG_KEY).decrypt(one, 'credential.secret_value'), /Cannot decrypt/)
  assert.throws(() => new SecretVault().decrypt(one, 'credential.secret_value'), /requires DSH_PURGE_SECRET_KEY/)
  assert.equal(new SecretVault().decrypt('legacy plaintext', 'credential.secret_value'), 'legacy plaintext')
  assert.throws(() => new SecretVault('short key'), /64 hexadecimal/)
})

test('new credentials and WebShell keys are encrypted in SQLite but usable through store', (t) => {
  const { store } = fixture(t, KEY)
  const id = store.openEngagement('vault-demo').id
  store.addCredential(id, { host: 'example.test', username: 'admin', secret_value: 'opaque-credential' })
  const first = store.addWebshell(id, { url: 'https://example.test/shell', pass_key: 'opaque-shell-key', shell_type: 'behinder' })
  const second = store.addWebshell(id, { url: 'https://example.test/shell', pass_key: 'opaque-shell-key', shell_type: 'behinder' })
  assert.equal(first.id, second.id)
  assert.equal(second.updated, true)
  const db = store.db(id)
  const credRaw = db.prepare('SELECT secret_value FROM credential').get().secret_value
  const shellRaw = db.prepare('SELECT pass_key FROM webshell').get().pass_key
  assert.match(credRaw, /^dshp:vault:v1:/)
  assert.match(shellRaw, /^dshp:vault:v1:/)
  assert.ok(!credRaw.includes('opaque-credential'))
  assert.ok(!shellRaw.includes('opaque-shell-key'))
  assert.equal(store.listCredentials(id)[0].secret_value, 'opaque-credential')
  assert.equal(store.listWebshells(id)[0].pass_key, 'opaque-shell-key')
  assert.equal(store.sessionSummary(id).webshells[0].pass_key, 'opaque-shell-key')
  assert.equal(store.secretVaultStatus(id).credential.encrypted, 1)
  assert.equal(store.secretVaultStatus(id).webshell.encrypted, 1)
})

test('existing plaintext remains usable; explicit migration encrypts it atomically', (t) => {
  const { root, store: legacy, track } = fixture(t)
  const id = legacy.openEngagement('old-project').id
  legacy.addCredential(id, { host: 'legacy.test', username: 'u', secret_value: 'legacy-password' })
  legacy.addWebshell(id, { url: 'https://legacy.test/shell', pass_key: 'legacy-key' })
  legacy.close()
  const secured = track(new RedteamStore(root, { secretKey: KEY }))
  assert.deepEqual(secured.secretVaultStatus(id).credential, { plaintext: 1, encrypted: 0 })
  assert.equal(secured.listCredentials(id)[0].secret_value, 'legacy-password')
  assert.deepEqual(secured.encryptExistingSecrets(id), { credential: 1, webshell: 1 })
  assert.deepEqual(secured.encryptExistingSecrets(id), { credential: 0, webshell: 0 })
  assert.equal(secured.listCredentials(id)[0].secret_value, 'legacy-password')
  assert.equal(secured.listWebshells(id)[0].pass_key, 'legacy-key')
  secured.close()
  const missingKey = track(new RedteamStore(root, { secretKey: '' }))
  assert.throws(() => missingKey.listCredentials(id), /requires DSH_PURGE_SECRET_KEY/)
  assert.throws(() => missingKey.sessionSummary(id), /requires DSH_PURGE_SECRET_KEY/)
  assert.throws(() => missingKey.addCredential(id, { host: 'other.test', secret_value: 'should-not-write' }), /requires DSH_PURGE_SECRET_KEY/)
  assert.equal(missingKey.db(id).prepare('SELECT COUNT(*) AS n FROM credential').get().n, 1)
})

test('incorrect key is rejected before data-changing writes or migration', (t) => {
  const { root, store, track } = fixture(t, KEY)
  const id = store.openEngagement('locked').id
  store.addCredential(id, { host: 'x.test', username: 'u', secret_value: 'locked' })
  store.addWebshell(id, { url: 'https://x.test/shell', pass_key: 'locked-shell' })
  store.close()
  const wrong = track(new RedteamStore(root, { secretKey: WRONG_KEY }))
  assert.throws(() => wrong.listCredentials(id), /Cannot decrypt/)
  assert.throws(() => wrong.sessionSummary(id), /Cannot decrypt/)
  assert.throws(() => wrong.addCredential(id, { host: 'z.test', secret_value: 'danger' }), /Cannot decrypt/)
  assert.throws(() => wrong.encryptExistingSecrets(id), /Cannot decrypt/)
  assert.equal(wrong.db(id).prepare('SELECT COUNT(*) AS n FROM credential').get().n, 1)
})

test('no key preserves existing plaintext behavior', (t) => {
  const { store } = fixture(t)
  const id = store.openEngagement('original').id
  store.addCredential(id, { host: 'x.test', secret_value: 'plain' })
  assert.equal(store.db(id).prepare('SELECT secret_value FROM credential').get().secret_value, 'plain')
  assert.equal(store.listCredentials(id)[0].secret_value, 'plain')
  store.addWebshell(id, { url: 'https://x.test/shell', pass_key: 'plain-shell' })
  assert.equal(store.sessionSummary(id).webshells[0].pass_key, 'plain-shell')
  assert.throws(() => store.encryptExistingSecrets(id), /Set DSH_PURGE_SECRET_KEY/)
})
