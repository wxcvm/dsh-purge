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

test('privacy status host and source/embedded UI agree about metadata-only coverage', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(host, /state\.vault = active/)
  assert.match(host, /store\.secretVaultStatus\(active\)/)
  for (const body of [source, bundle]) {
    assert.match(body, /凭据加密覆盖情况/)
    assert.match(body, /protection\.vault\.credential\.encrypted/)
    assert.match(body, /protection\.vault\.webshell\.plaintext/)
    assert.match(body, /不自动迁移/)
  }
})
