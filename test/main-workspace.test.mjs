import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('Purge uses the native main panel and matching global sidebar entry', () => {
  assert.match(client, /name: "main", key: PURGE_PANEL_ID/)
  assert.match(client, /name: "sidebar.panellist", id: PURGE_PANEL_ID/)
  assert.match(client, /layout\.selectPanel\(PURGE_PANEL_ID\)/)
  assert.match(client, /layout\.selectPanel\(null\)/)
})

test('the main page reuses real clean and redteam components instead of a mockup', () => {
  assert.match(client, /page === "clean" \? h\(SettingsRoot, \{ t \}\) : h\(__dshPurgeDrill\.Panel, \{ embedded: true \}\)/)
  assert.match(client, /"data-workspace": page === "clean" \? "clean" : "redteam"/)
  assert.match(client, /uiTag\.textContent = PURGE_CSS \+ PURGE_WORKSPACE_CSS/)
  assert.match(client, /showPurgeWorkspace\("drill"\)/)
  assert.match(client, /showPurgeWorkspace\("clean"\)/)
  assert.match(client, /setDock\(\{ open: false, authOpen: false \}\)/)
})

test('regenerating the embedded redteam component does not overwrite the main workspace', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-client.mjs', '--check'], {
    cwd: root, encoding: 'utf8',
  }), /embedded drill matches/)
  assert.match(client, /const PURGE_PANEL_ID = "dsh-purge-workspace"/)
})
