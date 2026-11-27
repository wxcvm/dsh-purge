import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { runInNewContext } from 'node:vm'

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
  assert.ok((build?.run ?? '').includes('maintenance/inject-switch/Build.ps1'))
  assert.notEqual(build['continue-on-error'], true, 'native compilation failures must still fail CI')
  assert.equal(upload?.id, 'windows-switch-artifact')
  assert.equal(upload?.if, "runner.os == 'Windows'")
  assert.equal(upload['continue-on-error'], true, 'only artifact delivery is best effort')
  assert.equal(upload.uses, 'actions/upload-artifact@v4')
  assert.equal(upload.with['if-no-files-found'], 'error', 'a missing compiled exe remains a visible upload failure')
  assert.equal(upload.with.path, 'maintenance/inject-switch/dist/dsh-inject-switch.exe')
  assert.ok((warning?.if ?? '').includes('always()'))
  assert.ok((warning?.if ?? '').includes("steps.windows-switch-artifact.outcome == 'failure'"))
  assert.match(warning?.run ?? '', /::warning/)
  assert.match(warning?.run ?? '', /GITHUB_STEP_SUMMARY/)
  for (const step of [contracts, pack, updater]) {
    assert.ok(step, 'required compatibility step must exist')
    assert.notEqual(step['continue-on-error'], true, step.name + ' must remain release-gating')
  }
})

test('compatibility test workers respect the runner environment and explicit budget', () => {
  const step = byName('Run unit and public API contract tests')
  assert.equal(step.env.PURGE_CI_RUNNER_ENVIRONMENT, '${{ runner.environment }}')
  assert.equal(step.env.PURGE_CI_TEST_CONCURRENCY, '${{ vars.PURGE_CI_TEST_CONCURRENCY }}')
  const match = /^node -e "([^\n]+)"$/.exec(step.run.trim())
  assert.ok(match, 'expected the actual workflow Node command')
  const run = (environment, available, override = '', status = 0) => {
    let args
    const process = {
      env: { PURGE_CI_RUNNER_ENVIRONMENT: environment, PURGE_CI_TEST_CONCURRENCY: override },
      execPath: 'node',
    }
    const require = name => {
      if (name === 'node:os') return { availableParallelism: () => available }
      if (name === 'node:child_process') return {
        spawnSync(executable, argv) {
          assert.equal(executable, 'node')
          args = Array.from(argv)
          return { status }
        },
      }
      throw new Error('unexpected module: ' + name)
    }
    runInNewContext(match[1], { process, require })
    return { args, exitCode: process.exitCode }
  }
  for (const [environment, available, override, expected] of [
    ['self-hosted', 16, '', 4],
    ['self-hosted', 2, '', 2],
    ['github-hosted', 16, '', 16],
    ['self-hosted', 16, '2', 2],
  ]) {
    assert.deepEqual(run(environment, available, override), {
      args: ['--test', '--test-concurrency=' + expected, 'test/*.test.*',
        'maintenance/*.test.mjs', 'maintenance/desktop-tools/*.test.mjs'],
      exitCode: 0,
    })
  }
  assert.equal(run('self-hosted', 8, '', 7).exitCode, 7)
  assert.throws(() => run('self-hosted', 8, '0'), /Invalid test concurrency/)
})
