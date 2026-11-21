import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const workflow = parse(readFileSync(new URL('../.github/workflows/compatibility.yml', import.meta.url), 'utf8'))
const steps = workflow.jobs['api-contracts'].steps
const byName = name => steps.find(step => step.name === name)

test('Windows optional artifact transport failures are visible without weakening the compile/test gates', () => {
  const build = byName('Compile optional Windows injection switch')
  const upload = byName('Attach optional Windows switch executable')
  const warning = byName('Report optional Windows artifact delivery failure')
  const contracts = byName('Run unit and public API contract tests')
  const pack = byName('Smoke-test actual npm tarball in disposable DSH_HOME')
  const updater = byName('Smoke-test Desktop updater and simulated rollback')

  assert.equal(build?.if, "runner.os == 'Windows'")
  assert.match(build?.run ?? '', /maintenance\\/inject-switch\\/Build\\.ps1/)
  assert.notEqual(build['continue-on-error'], true, 'native compilation failures must still fail CI')
  assert.equal(upload?.id, 'windows-switch-artifact')
  assert.equal(upload?.if, "runner.os == 'Windows'")
  assert.equal(upload['continue-on-error'], true, 'only artifact delivery is best effort')
  assert.equal(upload.uses, 'actions/upload-artifact@v4')
  assert.equal(upload.with['if-no-files-found'], 'error', 'a missing compiled exe remains a visible upload failure')
  assert.match(upload.with.path, /maintenance\\/inject-switch\\/dist\\/dsh-inject-switch\\.exe/)
  assert.match(warning?.if ?? '', /always\\(\\)/)
  assert.match(warning?.if ?? '', /steps\\.windows-switch-artifact\\.outcome == 'failure'/)
  assert.match(warning?.run ?? '', /::warning/)
  assert.match(warning?.run ?? '', /GITHUB_STEP_SUMMARY/)
  for (const step of [contracts, pack, updater]) {
    assert.ok(step, 'required compatibility step must exist')
    assert.notEqual(step['continue-on-error'], true, step.name + ' must remain release-gating')
  }
})
