// Runs the upstream, deterministic Agent Teams fixture on pinned official npm
// binaries. Do not run against the active Desktop/profile or use any credentials.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { listWorkItems } from '../lib/redteam/agent-work-items.js'
import { reconcileWorkItemRegistry } from '../lib/redteam/agent-status.js'

const release = '0.2.2-rc.5'
const upstream = '2e39e70496aa02986ca6a820c5d497e816b69d7e'
const fixtureSHA = 'd1f21494da0bd31b2719c2288f6804b0c09b2898e8313e7fdcc510c5d9fda3de'
const officialIntegrity = 'sha512-cNbp12tLYLUTXaVli7zwwMjzmmEVCD1PRldg4oKtXM4+lFYckcaliMS2PU/FoThB4iAN/fKOSID0nrtRZU4Gjw=='
const loadJson = path => JSON.parse(readFileSync(path, 'utf8'))

function run(npmDir, fixture) {
  const root = resolve(npmDir)
  const lock = loadJson(join(root, 'package-lock.json'))
  for (const name of ['dsh', 'dsh-base', 'dsh-headless']) {
    const path = 'node_modules/@deepseek-ai/' + name
    assert.equal(loadJson(join(root, path, 'package.json')).version, release, name + ' version')
    assert.equal(lock.packages?.[path]?.version, release, name + ' lock version')
    assert.match(lock.packages?.[path]?.resolved ?? '', /^https:\/\/registry\.npmjs\.org\/@deepseek-ai\//)
  }
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh'].integrity, officialIntegrity)
  assert.equal(createHash('sha256').update(readFileSync(fixture)).digest('hex'), fixtureSHA,
    'fixture must match the pinned official source bytes')

  const cwd = mkdtempSync(join(root, 'team-run-'))
  const home = join(cwd, '.dsh')
  const profile = join(home, 'profiles', 'headless')
  const sessions = join(home, 'sessions')
  const ledger = join(cwd, 'work-ledger.sqlite')
  const observer = new URL('../test/fixtures/stock-team-ledger-observer.mjs', import.meta.url)
  mkdirSync(profile, { recursive: true })
  const fixtureCopy = join(cwd, 'team-llm.mjs')
  copyFileSync(fixture, fixtureCopy)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-headless', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
  }))
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: llm-deepseek', '  disabled: true',
    '- id: session-persistence-jsonl', '  config:', '    root: ' + JSON.stringify(sessions), '    compression: none',
    '- insert:', '    - id: team-fixture-llm', '      name: ' + JSON.stringify(pathToFileURL(fixtureCopy).href),
    '    - id: stock-team-ledger-observer', '      name: ' + JSON.stringify(observer.href),
    '',
  ].join('\n'))

  const cli = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const osHome = join(cwd, 'user')
  mkdirSync(osHome)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_ALL)$/i.test(key)))
  Object.assign(env, { HOME: osHome, USERPROFILE: osHome, APPDATA: join(osHome, 'appdata'),
    LOCALAPPDATA: join(osHome, 'localappdata'), XDG_CONFIG_HOME: join(osHome, 'config'),
    DSH_HOME: home, DSH_AGENTS_HOME: join(cwd, '.agents'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '',
    PURGE_STOCK_TEAM_LEDGER: ledger })

  const invoke = (args, timeout) => spawnSync(process.execPath, [cli, '--profile', 'headless', ...args],
    { cwd, env, input: '', encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
  const config = invoke(['--dump-config'], 20000)
  assert.equal(config.status, 0, 'stock config did not compose: ' + (config.stderr || config.error?.message || '').slice(0, 2000))
  assert.ok(!/dsh-purge|anchor-gate|hooksDenyBypass|redteam/i.test(config.stdout), 'non-stock profile markers found; did not run')
  const result = invoke(['Use the official deterministic Teams fixture; combine two ordinary synthetic work items.'], 90000)
  if (result.status !== 0 || !result.stdout?.includes('TEAM_WORKFLOW_OK')) {
    throw Error('official runtime did not complete the fixture: ' + (result.stderr || result.error?.message || '').slice(0, 2500))
  }
  const files = readdirSync(sessions, { recursive: true }).filter(name => name.endsWith('.jsonl'))
  assert.equal(files.length, 4, 'fixture must create the root, a workflow child and both teammates')
  const logs = files.map(name => readFileSync(join(sessions, name), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)))
  const main = logs.find(rows => rows[0]?.type === 'session' && typeof rows[0].parentSession !== 'string')
  assert.ok(main, 'root session missing')
  const tasks = main.filter(row => row.type === 'team/task').map(row => row.data?.task).filter(Boolean)
  const completed = tasks.filter(task => task.status === 'completed')
  assert.equal(completed.length, 2, 'both real Team tasks must complete')
  const dependency = tasks.findIndex(task => task.id === 'task-1' && task.status === 'completed')
  const claim = tasks.findIndex(task => task.id === 'task-2' && task.status === 'in_progress' && task.blockedBy?.includes('task-1'))
  assert.ok(dependency >= 0 && claim > dependency, 'dependent task was not claimed after its dependency')
  const messages = logs.flat().filter(row => row.type === 'user/message' && row.data?.source?.kind === 'agent-message'
    && row.data.source.senderSessionId !== main[0]?.id)
  assert.equal(messages.length, 2, 'peer message delivery must appear in the native session journals')
  assert.ok(main.some(row => row.type === 'tool-workflow/run-end' && row.data.stopReason === 'completed'))
  const db = new DatabaseSync(ledger, { readOnly: true })
  let ledgerEvidence
  try {
    // Reopen the same SQLite after the real host exits and project the status
    // used by the WorkItemsPanel, independent of the host's stdout.
    const listing = listWorkItems(db)
    const projected = reconcileWorkItemRegistry(listing, { available: false, running: [] })
    const observed = projected.items.filter(item => item.task_key.startsWith('observed-'))
    const other = projected.items.filter(item => item.task_key.startsWith('other-run-'))
    assert.equal(observed.length, 3, 'every native child activation must have a fixture binding')
    assert.equal(other.length, 3, 'same-session/different-run controls')
    for (const item of observed) {
      assert.equal(item.status, 'running', 'observation must not settle a task')
      assert.equal(item.assignment.finished_at, null)
      assert.equal(item.assignment.host_stop_reason, 'completed')
      assert.equal(item.registry_activity.state, 'exact-run-end-observed')
      assert.equal(item.needs_settlement, true)
    }
    for (const item of other) {
      assert.equal(item.assignment.host_end_at, null, 'never observe a different run from the same session')
      assert.equal(item.registry_activity.exact_run_verified, false)
      assert.equal(item.assignment.finished_at, null)
    }
    ledgerEvidence = { exactHostEnds: observed.length, untouchedDifferentRuns: other.length, automaticSettlements: 0 }
  } finally { db.close() }
  return { release, upstream, isolation: 'temporary-profile', model: 'upstream-keyless-fixture', desktop: false, providerRequests: false,
    currentProfileChanged: false, sessions: files.length, completedTeamTasks: completed.length, peerMessages: messages.length,
    dependencyOrderVerified: true, ledgerEvidence, artifactDir: relative(root, cwd) }
}

if (process.argv.length !== 4) {
  throw Error('Usage: node scripts/verify-stock-harness-teams.mjs <official npm install directory> <pinned team-llm.mjs>')
}
console.log(JSON.stringify(run(process.argv[2], process.argv[3])))