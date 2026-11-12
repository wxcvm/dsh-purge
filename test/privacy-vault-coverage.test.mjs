import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('privacy vault coverage counts encrypted and legacy records without disclosing secret values', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-privacy-vault-'))
  const key = randomBytes(32).toString('hex')
  const store = new RedteamStore(root, { secretKey: key })
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const id = store.openEngagement('coverage').id
  store.addCredential(id, { host: 'a.example.test', secret_value: 'private-credential-value' })
  store.addWebshell(id, { url: 'https://a.example.test/shell', pass_key: 'private-webshell-value' })
  const db = store.db(id)
  db.prepare('INSERT INTO credential(host, username, secret_type, secret_value) VALUES(?,?,?,?)')
    .run('legacy.example.test', 'u', 'password', 'old-private-value')
  const status = store.secretVaultStatus(id)
  assert.deepEqual(status, {
    enabled: true,
    credential: { plaintext: 1, encrypted: 1 },
    webshell: { plaintext: 0, encrypted: 1 },
  })
  const json = JSON.stringify(status)
  for (const secret of ['private-credential-value', 'private-webshell-value', 'old-private-value', key]) {
    assert.equal(json.includes(secret), false)
  }
})

test('vault integrity verifies authenticated ciphertext and distinguishes wrong or missing keys', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-privacy-integrity-'))
  const key = randomBytes(32).toString('hex')
  let current = new RedteamStore(root, { secretKey: key })
  t.after(() => { current.close(); rmSync(root, { recursive: true, force: true }) })
  const id = current.openEngagement('integrity').id
  current.addCredential(id, { host: 'valid.example.test', secret_value: 'synthetic-private-credential' })
  current.addWebshell(id, { url: 'https://valid.example.test/shell', pass_key: 'synthetic-private-passkey' })
  let db = current.db(id)
  db.prepare('INSERT INTO credential(host, username, secret_type, secret_value) VALUES(?,?,?,?)')
    .run('legacy.example.test', 'u', 'password', 'synthetic-legacy-plaintext')
  db.prepare('INSERT INTO credential(host, username, secret_type, secret_value) VALUES(?,?,?,?)')
    .run('damaged.example.test', 'u', 'password', 'dshp:vault:v1:broken')
  const rawBefore = db.prepare('SELECT id, secret_value FROM credential ORDER BY id').all()
  const valid = current.secretVaultStatus(id, { verify: true })
  assert.deepEqual(valid.credential, { plaintext: 1, encrypted: 2 })
  assert.deepEqual(valid.webshell, { plaintext: 0, encrypted: 1 })
  assert.deepEqual(valid.integrity, {
    credential: { verified: 1, failed: 1, unchecked: 0 },
    webshell: { verified: 1, failed: 0, unchecked: 0 },
  })
  for (const secret of ['synthetic-private-credential', 'synthetic-private-passkey', 'synthetic-legacy-plaintext', 'dshp:vault:v1:broken', key]) {
    assert.equal(JSON.stringify(valid).includes(secret), false)
  }
  for (const row of rawBefore) assert.equal(JSON.stringify(valid).includes(row.secret_value), false)
  assert.deepEqual(db.prepare('SELECT id, secret_value FROM credential ORDER BY id').all(), rawBefore)

  current.close()
  current = new RedteamStore(root, { secretKey: randomBytes(32).toString('hex') })
  const wrong = current.secretVaultStatus(id, { verify: true })
  assert.deepEqual(wrong.integrity.credential, { verified: 0, failed: 2, unchecked: 0 })
  assert.deepEqual(wrong.integrity.webshell, { verified: 0, failed: 1, unchecked: 0 })

  current.close()
  current = new RedteamStore(root, { secretKey: '' })
  const missing = current.secretVaultStatus(id, { verify: true })
  assert.equal(missing.enabled, false)
  assert.deepEqual(missing.integrity.credential, { verified: 0, failed: 0, unchecked: 2 })
  assert.deepEqual(missing.integrity.webshell, { verified: 0, failed: 0, unchecked: 1 })
  assert.deepEqual(current.db(id).prepare('SELECT id, secret_value FROM credential ORDER BY id').all(), rawBefore)
  assert.deepEqual(current.secretVaultStatus(id), {
    enabled: false,
    credential: { plaintext: 1, encrypted: 2 },
    webshell: { plaintext: 0, encrypted: 1 },
  })
})

test('privacy status host and source/embedded UI agree about metadata-only coverage', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(host, /state\.vault = active/)
  assert.match(host, /store\.secretVaultStatus\(active, \{ verify: true \}\)/)
  for (const body of [source, bundle]) {
    assert.match(body, /凭据加密覆盖情况/)
    assert.match(body, /protection\.vault\.credential\.encrypted/)
    assert.match(body, /protection\.vault\.webshell\.plaintext/)
    assert.match(body, /不自动迁移/)
    assert.match(body, /当前密钥完整性校验/)
    assert.match(body, /protection\.vault\.integrity\.credential\.verified/)
    assert.match(body, /protection\.vault\.integrity\.webshell\.unchecked/)
  }
})
