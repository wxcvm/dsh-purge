import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const workflow = parse(readFileSync(new URL('../.github/workflows/recover-purge-10-assets.yml', import.meta.url), 'utf8'))
const step = workflow.jobs.upload.steps.find(entry => entry.name === 'Rebuild and upload immutable .10 release assets')

test('historical .10 recovery cannot overwrite already published ZIP or checksum assets', () => {
  assert.equal(typeof step?.run, 'string')
  assert.match(step.run, /tag=v1\.1\.92-wxcvm\.10/)
  assert.match(step.run, /expected_commit=66ddb75e6303c723f1e970c1c31f26a66497bbbf/)
  assert.match(step.run, /existing_assets="\$\(gh release view "\$tag" --json assets --jq '\.assets\[\]\.name'\)"/)
  assert.match(step.run, /printf '%s\\n' "\$existing_assets" \| grep -Fxq "\$zip"/)
  assert.match(step.run, /printf '%s\\n' "\$existing_assets" \| grep -Fxq SHA256SUMS\.txt/)
  assert.match(step.run, /Existing \.10 release assets are immutable/)
  assert.match(step.run, /gh release upload "\$tag" "\$zip" SHA256SUMS\.txt; then/)
  assert.doesNotMatch(step.run, /--clobber/)
})
