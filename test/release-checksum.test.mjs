import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const updater = readFileSync(new URL('../scripts/update-desktop-fork.ps1', import.meta.url), 'utf8')

test('published zip has a checksum generated from exactly the uploaded file', () => {
  assert.match(workflow, /sha256sum "\$zip" > SHA256SUMS\.txt/)
  assert.match(workflow, /gh release upload "\$tag" "\$zip" SHA256SUMS\.txt --clobber/)
})

test('fork permits manual master dispatch or a version-matched release branch pinned to master', () => {
  assert.match(workflow, /github\.repository == 'wxcvm\/dsh-purge' && \(\(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/master'/)
  assert.match(workflow, /github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/heads\/release\/v'\)/)
  assert.match(workflow, /expected_branch="release\/\$tag"/)
  assert.match(workflow, /"\$GITHUB_REF_NAME" != "\$expected_branch"/)
  assert.match(workflow, /"\$master_commit" != "\$commit"/)
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


test('stable fork versions are not marked prerelease just because they carry the fork suffix', () => {
  assert.match(workflow, /\*beta\*\|\*alpha\*\|\*rc\*\)/)
  assert.doesNotMatch(workflow, /\*wxcvm\*\)/)
  assert.match(workflow, /Install declared dependencies without lifecycle scripts/)
})
