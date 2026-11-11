import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { diagnoseEnvironmentTopology } from '../lib/redteam/environment-diagnostics.js'

test('topology combines local paths and provider inventory without treating discovery as execution', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'purge-topology-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nmap = join(root, 'tools', 'nmap')
  mkdirSync(dirname(nmap), { recursive: true })
  writeFileSync(nmap, 'fixture')
  let dockerCalls = 0
  const result = await diagnoseEnvironmentTopology({
    root, platform: 'linux', env: { PATH: '', ARTEX_TOOL_DIRS: join(root, 'artex-missing') },
    config: { platform: 'linux', tools: { nmap }, toolkitDir: join(root, 'absent'), binDirs: [] },
    execFileFn: () => { throw Error('WSL must not run on Linux') },
    dockerExecFileFn: (cmd, args, opts, done) => {
      dockerCalls++
      assert.equal(cmd, 'docker')
      assert.equal(args[0], 'ps')
      assert.equal(opts.shell, false)
      done(null, '', '')
    },
  })
  assert.equal(dockerCalls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.topology.discoveredEnvironments, 1)
  assert.equal(result.topology.localTotal, 23)
  assert.equal(result.topology.localLocated, 1)
  assert.equal(result.providers.docker.state, 'empty')
  assert.equal(result.providers.artex.state, 'absent')
  assert.equal(result.topology.versionProbeState, 'not-checked')
  assert.equal(result.topology.dependencyState, 'not-checked')
  assert.equal(result.topology.taskExecutionState, 'not-checked')
  assert.equal(result.localDiagnostics.summary.capabilityVerified, 0)
  assert.equal(result.localDiagnostics.summary.executed, 0)
  assert.equal(result.localDiagnostics.capabilities.find(x => x.toolId === 'nmap').status, 'located')
})

test('existing environmentDiscover API and both UI surfaces expose factual topology', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /op === 'environmentDiscover'\) return diagnoseEnvironmentTopology/)
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /跨环境状态 · 只读诊断/)
    assert.match(source, /environmentSnapshot\.topology\.providers/)
    assert.match(source, /版本 \/ 依赖 \/ 任务执行：本次只读发现均未检查/)
  }
})
