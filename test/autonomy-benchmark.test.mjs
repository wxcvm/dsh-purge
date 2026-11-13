import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseOptions, summarizeRun, benchmarkPassed } from '../scripts/benchmark-autonomy-headless.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-bench-judge-'))
  const data = join(root, 'data')
  mkdirSync(data)
  const dbPath = join(data, 'facts.db'), db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE http_evidence(asset_id INTEGER,request TEXT,response TEXT); CREATE TABLE task_attempt(status TEXT)')
  db.close()
  const allowed = ['redteam_http_evidence_add']
  writeFileSync(join(data, 'fixture.json'), JSON.stringify({ dbPath }))
  writeFileSync(join(data, 'ready.json'), JSON.stringify({ allowed, knowledgeScope: 'synthetic-only' }))
  writeFileSync(join(data, 'catalog.json'), JSON.stringify(allowed))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, data, dbPath }
}
const output = events => ({ status: 0, stdout: events.map(row => JSON.stringify(row)).join('\n') })

test('benchmark is opt-in and validates paths, repeat budgets and profile names without starting a model', () => {
  assert.throws(() => parseOptions([]), /existing absolute path/)
  const args = ['--exe', process.execPath, '--cli', process.execPath, '--dsh-home', tmpdir()]
  assert.equal(parseOptions(args).repeats, 1)
  assert.throws(() => parseOptions([...args, '--repeats', '4']), /repeats/)
  assert.throws(() => parseOptions([...args, '--profile', '../desktop']), /profile/)
  assert.throws(() => parseOptions([...args, '--timeout', '1']), /timeout/)
})

test('a final success marker alone cannot pass the external artifact judge', t => {
  const { root } = fixture(t)
  const report = summarizeRun(output([{ type: 'final', text: 'BENCH_DONE', reason: { kind: 'completed' } }]), root, 5)
  assert.equal(report.valid, true)
  assert.equal(report.artifactPass, false)
  assert.equal(report.markerWithoutArtifact, true)
})

test('record artifacts and candidate-specific accepted delivery are measured separately', t => {
  const { root, dbPath } = fixture(t)
  const db = new DatabaseSync(dbPath)
  db.exec("INSERT INTO http_evidence VALUES(1,'GET /fixture HTTP/1.1','HTTP/1.1 200 OK')")
  db.close()
  const report = summarizeRun(output([{ type: 'final', text: 'BENCH_DONE' }]), root, 5)
  assert.equal(report.artifactPass, true)
  assert.equal(report.verifiedDelivery, false, 'baseline artifact success does not require a candidate-only table row')
  assert.equal(report.markerWithoutArtifact, false)
})

test('model schema errors do not invalidate an otherwise isolated run and raw content is omitted', t => {
  const { root } = fixture(t)
  const result = output([
    { type: 'thinking', text: 'PRIVATE_REASONING' },
    { type: 'tool_call', tool: 'redteam_http_evidence_add', input: { request: 'PRIVATE_ARGUMENT' } },
    { type: 'status', usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 } },
    { type: 'final', text: 'not complete' },
  ])
  const report = summarizeRun(result, root, 8)
  assert.equal(report.valid, true)
  assert.equal(report.dispatchTraceAligned, false)
  assert.equal(report.usage.totalTokens, 16)
  assert.ok(!JSON.stringify(report).includes('PRIVATE_'))
})

test('missing or excessive catalog scope invalidates a case before it is counted as a comparison', t => {
  const { root, data } = fixture(t)
  writeFileSync(join(data, 'catalog.json'), JSON.stringify(['redteam_http_evidence_add', 'pwsh']))
  assert.equal(summarizeRun(output([]), root, 0).valid, false)
  writeFileSync(join(data, 'catalog.json'), JSON.stringify([]))
  assert.equal(summarizeRun(output([]), root, 0).valid, false)
})

test('benchmark gate rejects missing, invalid or unaccepted candidate runs, not baseline capability gaps', () => {
  const baseline = { arm: 'baseline', valid: true, exit: 0, timeout: false, artifactPass: true, verifiedDelivery: false }
  const candidate = { ...baseline, arm: 'candidate', verifiedDelivery: true }
  assert.equal(benchmarkPassed({ runtimeStable: true, runs: [baseline, candidate] }, 2), true)
  assert.equal(benchmarkPassed({ runtimeStable: true, runs: [baseline, { ...candidate, verifiedDelivery: false }] }, 2), false)
  assert.equal(benchmarkPassed({ runtimeStable: false, runs: [baseline, candidate] }, 2), false)
  assert.equal(benchmarkPassed({ runtimeStable: true, runs: [baseline] }, 2), false)
})
