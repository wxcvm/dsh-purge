import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Purge release accepts only versioned release branches pinned to master while retaining manual dry-run', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /branches: \["release\/v\*"\]/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/master'/)
  assert.match(workflow, /startsWith\(github\.ref, 'refs\/heads\/release\/v'\)/)
  assert.match(workflow, /expected_branch="release\/\$tag"/)
  assert.match(workflow, /"\$GITHUB_REF_NAME" != "\$expected_branch"/)
  assert.match(workflow, /master_commit="\$\(git rev-parse refs\/remotes\/origin\/master\)"/)
  assert.match(workflow, /"\$master_commit" != "\$commit"/)
  assert.match(workflow, /if \[ "\$DRY_RUN" = "true" \]/)
})
