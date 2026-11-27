import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const clientPackages = manifest.dsh.client.inject

test('rc.5 client module graph does not wait for removed runtime or slots packages', () => {
  assert.equal(new Set(clientPackages).size, clientPackages.length)
  for (const removed of [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-slots',
  ]) assert.ok(!clientPackages.includes(removed), removed + ' has no rc.5 client provider')
  for (const required of [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
  ]) assert.ok(clientPackages.includes(required), required + ' must remain available')
})

test('conversation module remains declared while the bundled UI requires uiConversation', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /const inject = \["slots", "locale", "uiConversation"\]/)
  assert.ok(clientPackages.includes('@deepseek-ai/dsh-client-ui-conversation'))
})
