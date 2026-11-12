import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const updater = readFileSync(new URL('../scripts/update-desktop-fork.ps1', import.meta.url), 'utf8')

test('published zip has a checksum generated from exactly the uploaded file', () => {
  assert.match(workflow, /sha256sum "\$zip" > SHA256SUMS\.txt/)
  assert.match(workflow, /gh release upload "\$tag" "\$zip" SHA256SUMS\.txt --clobber/)
})

test('fork only permits manual release dispatch on master or beta', () => {
  assert.ok(workflow.includes("github.repository == 'wxcvm/dsh-purge' && github.event_name == 'workflow_dispatch' && (github.ref == 'refs/heads/master' || github.ref == 'refs/heads/beta')"))
  assert.ok(workflow.includes('beta branch requires beta version'))
  assert.ok(workflow.includes('beta version cannot be published from master'))
  assert.ok(workflow.includes('Existing beta tag points at a different commit'))
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.head_commit\.message/)
})

test('fork release archive and installed profile require the same ARTEX knowledge and environment modules', () => {
  for (const file of [
    'lib/artex-knowledge.js',
    'lib/redteam/tools.js',
    'lib/redteam/task-context.js',
    'lib/redteam/adapters/wsl.js',
    'lib/redteam/adapters/ssh-kali.js',
  ]) {
    assert.ok(workflow.includes(file), 'release ZIP must include ' + file)
    assert.ok(updater.includes(file.replaceAll('/', '\\')), 'desktop upgrade verification must include ' + file)
  }
})


test('beta archive contains runtime dependencies and independent recovery tool', () => {
  for (const file of ['lib/update-payload.js', 'scripts/recover-update.mjs', 'scripts/vps-admin-check.mjs', 'scripts/ensure-profile-bundle.mjs', 'docs/UPDATE_RECOVERY.zh-CN.md']) {
    assert.ok(workflow.includes(file), 'beta ZIP must include ' + file)
  }
})
