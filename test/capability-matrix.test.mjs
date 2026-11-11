import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { TOOL_CATALOG } from '../lib/redteam/platform-config.js'
import { composeCapabilityMatrix, environmentCapabilityMatrix } from '../lib/redteam/capability-matrix.js'

const fixtures = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-capability-matrix-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('local paths and remote unchecked states stay separate; ARTEX remains a source', () => {
  const discovery = {
    environments: [
      { id: 'local', kind: 'local', label: 'Windows' },
      { id: 'wsl:kali-linux', kind: 'wsl', distro: 'kali-linux', label: 'Kali WSL' },
      { id: 'ssh:kali-vm', kind: 'ssh', label: 'Kali VM', state: 'configured' },
      { id: 'docker:' + 'a'.repeat(64), kind: 'docker', label: 'Docker kali', state: 'running' },
    ],
    providers: {
      artex: { id: 'artex:local', kind: 'binary-source', state: 'located' },
    },
  }
  const matrix = composeCapabilityMatrix(discovery, [
    { toolId: 'nmap', status: 'located', path: '/local/nmap', source: 'path' },
    { toolId: 'katana', status: 'located', path: '/artex/katana',
      source: 'artex', sourceProviderId: 'artex:local' },
  ], { checkedAt: '2026-11-11T00:00:00Z' })
  assert.equal(matrix.ok, true)
  assert.equal(matrix.environments.length, 4)
  assert.equal(matrix.rows.length, TOOL_CATALOG.length)
  assert.equal(matrix.summary.localLocated, 2)
  assert.equal(matrix.summary.remoteUnchecked, TOOL_CATALOG.length * 3)
  assert.equal(matrix.summary.probeVerified, 0)
  assert.equal(matrix.summary.capabilityVerified, 0)
  assert.equal(matrix.summary.executed, 0)
  const nmap = matrix.rows.find((row) => row.toolId === 'nmap')
  assert.equal(nmap.cells.length, 4)
  assert.equal(nmap.cells[0].status, 'located')
  assert.equal(nmap.cells[0].path, '/local/nmap')
  for (const cell of nmap.cells.slice(1)) {
    assert.equal(cell.status, 'not-checked')
    assert.equal(cell.path, null)
    assert.equal(cell.probeStatus, 'not-run')
    assert.equal(cell.capabilityVerified, false)
    assert.equal(cell.executionStatus, 'not-run')
    assert.equal(cell.dependencyStatus, 'not-checked')
  }
  const katana = matrix.rows.find((row) => row.toolId === 'katana')
  assert.equal(katana.cells[0].sourceProviderId, 'artex:local')
  assert.equal(matrix.environments.some((environment) => environment.id === 'artex:local'), false)
})

test('matrix discovery is read-only and never runs any remote tool version check', async (t) => {
  const root = fixtures(t)
  const binary = join(root, 'tools', 'katana')
  mkdirSync(dirname(binary), { recursive: true })
  writeFileSync(binary, 'fixture')
  let commandCount = 0
  const dockerPs = JSON.stringify({
    ID: 'a'.repeat(64), Names: 'dev-kali', Image: 'kali:test', State: 'running', Status: 'Up',
  }) + '\n'
  const matrix = await environmentCapabilityMatrix({
    root, platform: 'linux', env: { PATH: '' },
    config: { platform: 'linux', toolkitDir: join(root, 'empty'), binDirs: [],
      tools: { katana: binary }, kaliVm: { host: '', user: 'kali', port: 22 } },
    dockerExecFileFn: (command, args, opts, done) => {
      commandCount++
      assert.equal(command, 'docker')
      assert.deepEqual(args, ['ps', '--no-trunc', '--filter', 'status=running', '--format', '{{json .}}'])
      assert.equal(opts.shell, false)
      done(null, dockerPs, '')
    },
    execFileFn: () => { throw new Error('unexpected version probe or task') },
  })
  assert.equal(commandCount, 1)
  assert.deepEqual(matrix.environments.map((item) => item.kind), ['local', 'docker'])
  const katana = matrix.rows.find((row) => row.toolId === 'katana')
  assert.equal(katana.cells[0].status, 'located')
  assert.equal(katana.cells[1].status, 'not-checked')
  assert.equal(matrix.summary.localLocated, 1)
  assert.equal(matrix.summary.executed, 0)
})

test('an empty environment inventory never manufactures an execution environment', () => {
  const matrix = composeCapabilityMatrix({ environments: [], providers: {} }, [])
  assert.equal(matrix.environments.length, 0)
  assert.equal(matrix.rows.length, TOOL_CATALOG.length)
  assert.equal(matrix.summary.localLocated, 0)
  assert.equal(matrix.summary.remoteUnchecked, 0)
  assert.deepEqual(matrix.rows.find((row) => row.toolId === 'nmap').cells, [])
})

test('host and both browser clients expose matrix, without silent auto-probing', () => {
  const host = readFileSync(new URL('../lib/redteam/ui.js', import.meta.url), 'utf8')
  assert.match(host, /op === 'environmentCapabilityMatrix'/)
  assert.match(host, /return environmentCapabilityMatrix\(\{ root \}\)/)
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const ui = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(ui, /跨环境工具能力矩阵/)
    assert.match(ui, /op: 'environmentCapabilityMatrix'/)
    assert.match(ui, /生成 \/ 刷新能力矩阵/)
    assert.match(ui, /matrixCellStatus\(cell\)/)
    assert.match(ui, /kaliProbeResults\[cell\.toolId\]/)
    assert.match(ui, /setKaliProbeResults\(\(prev\)/)
    assert.match(ui, /已定位 ≠ 可运行/)
    assert.match(ui, /setCapabilityMatrix\(null\)/)
  }
})
