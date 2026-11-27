import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { RedteamStore, dispatch } from '../lib/redteam/store-core.js'
import { DDL, migrate } from '../lib/redteam/schema.js'
import { join } from 'node:path'

const expected = JSON.parse(readFileSync(new URL('./fixtures/tool-surface.json', import.meta.url), 'utf8'))

test('reviewed tool names match source declarations and actual registrations', async (t) => {
  const source = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  const declared = [...source.matchAll(/name:\s*'(redteam_[a-z0-9_]+)'/g)].map(match => match[1]).sort()
  assert.deepEqual(declared, expected)
  const docs = readFileSync(new URL('../docs/drill-tools-reference.md', import.meta.url), 'utf8')
  for (const name of expected) {
    assert.ok(docs.includes('`' + name + '`'), `missing documentation for ${name}`)
  }

  const home = mkdtempSync(join(tmpdir(), 'purge-tool-surface-'))
  const previousHome = process.env.DSH_HOME
  const previousKBDir = process.env.ARTEX_KB_DIR
  let redteam
  t.after(() => {
    redteam?.close()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousKBDir === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = previousKBDir
    rmSync(home, { recursive: true, force: true })
  })
  const moduleDir = join(home, 'node_modules', '@deepseek-ai', 'dsh-tools')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{}')
  writeFileSync(join(moduleDir, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","main":"index.js"}')
  writeFileSync(join(moduleDir, 'index.js'), 'exports.defineTool = spec => spec\n')
  process.env.DSH_HOME = home
  const knowledgeDir = join(home, 'artkb')
  mkdirSync(knowledgeDir, { recursive: true })
  const kb = new DatabaseSync(join(knowledgeDir, 'knowledge.db'))
  kb.exec(`
    CREATE TABLE poc (
      id INTEGER PRIMARY KEY, title TEXT, category TEXT, kind TEXT, tags TEXT,
      verified INTEGER, description TEXT, usage TEXT, content TEXT
    );
    INSERT INTO poc VALUES (
      17, 'Example system audit', 'methodology', 'markdown', 'example', 1,
      'Reference note', 'Read locally', 'No commands were executed'
    );
  `)
  kb.close()
  process.env.ARTEX_KB_DIR = knowledgeDir

  const { apply } = await import('../lib/redteam/tools.js')
  redteam = new RedteamStore(home)
  const engagement = redteam.openEngagement('fixture').id
  const otherEngagement = redteam.openEngagement('cleanup-other').id
  const legacySchemaDb = new DatabaseSync(':memory:')
  try {
    legacySchemaDb.exec(DDL)
    legacySchemaDb.exec('ALTER TABLE data_proof DROP COLUMN sample_count; ALTER TABLE data_proof ADD COLUMN sample TEXT; ALTER TABLE data_proof ADD COLUMN query TEXT;')
    migrate(legacySchemaDb)
    const legacyColumns = legacySchemaDb.prepare('PRAGMA table_info(data_proof)').all().map(column => column.name)
    assert.ok(legacyColumns.includes('sample_count'), 'existing upstream proof tables gain the safe sample-count column')
  } finally {
    legacySchemaDb.close()
  }
  redteam.dataQuality = id => ({ missing_evidence: 2, target: id })
  const registered = new Map()
  const ctx = {
    redteam,
    tools: { register(tool) {
      assert.ok(!registered.has(tool.name), `duplicate tool registration: ${tool.name}`)
      registered.set(tool.name, tool)
    } },
    on: () => () => {},
    effect: attach => { const dispose = attach(); t.after(() => dispose?.()) },
  }
  apply(ctx)
  assert.deepEqual([...registered.keys()].sort(), expected)

  const selector = registered.get('redteam_tool_select')
  const toolPlan = JSON.parse(await selector.execute({
    task: 'web', include_environments: false,
  }, {}))
  const httpxCandidate = toolPlan.candidates.find(item => item.id === 'httpx')
  assert.ok(httpxCandidate)
  assert.equal(httpxCandidate.executionAdapter, 'redteam_scan_run')
  assert.deepEqual(httpxCandidate.skillRequirements.map(item => item.key), [
    'redteam:httpx-web-inventory',
  ])
  assert.equal(httpxCandidate.automaticExecutionAllowed, false)
  assert.equal(toolPlan.skillPlan.readTool, 'redteam_skill_read')
  assert.equal(toolPlan.executionGuard.scopeReviewTool, 'redteam_scope_review')
  const passiveEngagement = redteam.openEngagement('passive-fixture', ['*.example.test']).id
  const passiveTool = registered.get('redteam_passive_recon')
  assert.ok(passiveTool)
  const passivePreview = JSON.parse(await passiveTool.execute({
    action: 'subdomains', engagement: passiveEngagement, target: 'example.test',
  }, {}))
  assert.equal(passivePreview.ok, true)
  assert.equal(passivePreview.toolStatus, 'not-requested')
  assert.equal(passivePreview.amassStatus, 'not-requested')
  assert.equal(passivePreview.names.length, 0)
  const skillReader = registered.get('redteam_skill_read')
  const passiveExec = { agent: { session: { id: 'passive-session' } } }
  const passiveRequest = {
    action: 'subdomains', engagement: passiveEngagement, target: 'example.test',
    use_subfinder: true, confirm_external: true, environment_id: 'not-a-real-environment',
  }
  const blockedPassive = JSON.parse(await passiveTool.execute(passiveRequest, passiveExec))
  assert.equal(blockedPassive.ok, false)
  assert.match(blockedPassive.error, /redteam:passive-recon/)
  const passiveSkill = JSON.parse(await skillReader.execute({ key: 'redteam:passive-recon' }, passiveExec))
  assert.equal(passiveSkill.skillReadReceipt, 'recorded-for-current-root-session')
  const passivePlanAfterRead = JSON.parse(await registered.get('redteam_tool_select').execute({
    task: 'domains',
  }, passiveExec))
  assert.equal(passivePlanAfterRead.candidates.find(item => item.id === 'subfinder')
    .skillRequirements[0].status, 'read')
  const otherSession = { agent: { session: { id: 'another-session' } } }
  const isolatedPassive = JSON.parse(await passiveTool.execute(passiveRequest, otherSession))
  assert.equal(isolatedPassive.ok, false)
  assert.match(isolatedPassive.error, /redteam:passive-recon/)
  const passiveAfterRead = JSON.parse(await passiveTool.execute(passiveRequest, passiveExec))
  assert.equal(passiveAfterRead.toolStatus, 'unsupported-environment')
  assert.equal(passiveAfterRead.toolRuns[0].attempted, false)

  const scanEngagement = redteam.openEngagement('scan-fixture', ['192.0.2.10']).id
  const scanTool = registered.get('redteam_scan_run')
  const scanExec = { agent: { session: { id: 'scan-session' } } }
  const scanRequest = {
    engagement: scanEngagement, kind: 'nmap', target: '192.0.2.10',
    environment_id: 'not-a-real-environment', commit: false,
  }
  const blockedScan = JSON.parse(await scanTool.execute(scanRequest, scanExec))
  assert.equal(blockedScan.ok, false)
  assert.match(blockedScan.error, /redteam:nmap-service-inventory/)
  const nmapSkill = JSON.parse(await skillReader.execute({
    key: 'redteam:nmap-service-inventory',
  }, scanExec))
  assert.equal(nmapSkill.skillReadReceipt, 'recorded-for-current-root-session')
  const scanPlanAfterRead = JSON.parse(await registered.get('redteam_tool_select').execute({
    task: 'services',
  }, scanExec))
  assert.equal(scanPlanAfterRead.candidates.find(item => item.id === 'nmap')
    .skillRequirements[0].status, 'read')
  const scanAfterRead = JSON.parse(await scanTool.execute(scanRequest, scanExec))
  assert.equal(scanAfterRead.status, 'unsupported-environment')
  assert.equal(scanAfterRead.execution.attempted, false)
  const quality = registered.get('redteam_data_quality')
  const read = JSON.parse(await quality.execute({ engagement: 'fixture' }, {}))
  assert.deepEqual(read, {
    ok: true, engagement: 'fixture', quality: { missing_evidence: 2, target: 'fixture' },
  })
  assert.equal(redteam.setActiveEngagement(engagement), true)
  const noTarget = JSON.parse(await quality.execute({}, {}))
  assert.equal(noTarget.ok, true)
  assert.equal(noTarget.engagement, engagement, 'unbound tool calls use the selected active engagement')

  const batchTool = registered.get('redteam_asset_batch')
  const scopedEngagement = redteam.openEngagement('manual-batch-scope',
    ['192.0.2.0/24'], { bindCurrent: false }).id
  const batchItems = [
    { ip: '192.0.2.10', provenance: 'passive', tool: 'manual-catalog',
      discovered_at: '2026-11-01T00:00:00Z',
      names: [{ name: 'host.example.test', kind: 'hostname' }],
      ports: [{ port: 443, proto: 'tcp', service: 'https', title: 'Example' }] },
    { ip: '198.51.100.10', provenance: 'active', tool: 'manual-catalog' },
  ]
  const batchPreview = JSON.parse(await batchTool.execute({
    engagement: scopedEngagement, items: batchItems,
  }, {}))
  assert.equal(batchPreview.dry_run, true)
  assert.equal(batchPreview.accepted, 1)
  assert.deepEqual(batchPreview.rejected.map(item => item.reason), ['outside-scope'])
  assert.equal(redteam.listAssets(scopedEngagement, {}).total, 0)
  const batchCommit = JSON.parse(await batchTool.execute({
    engagement: scopedEngagement, items: batchItems, commit: true,
  }, {}))
  assert.equal(batchCommit.ok, true)
  assert.equal(batchCommit.written, 1)
  assert.ok(Number.isInteger(batchCommit.results[0].asset_id))
  assert.equal(redteam.listAssets(scopedEngagement, {}).total, 1)
  const batchAsset = redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id)
  assert.equal(batchAsset.ip, '192.0.2.10')
  assert.equal(batchAsset.discovered_at, '2026-11-01T00:00:00Z')
  assert.equal(batchAsset.ports[0].port, 443)
  const coverageTool = registered.get('redteam_coverage')
  assert.equal(coverageTool.parameters.phase.required, true)
  const initialCoverage = JSON.parse(await coverageTool.execute({
    engagement: scopedEngagement, phase: 'external', action: 'status',
    asset_id: batchCommit.results[0].asset_id,
  }, {}))
  assert.equal(initialCoverage.ok, true)
  assert.deepEqual(initialCoverage.coverage.missing, ['surface', 'web', 'auth', 'cve', 'app'])
  assert.equal(redteam.db(scopedEngagement)
    .prepare('SELECT COUNT(*) AS n FROM asset_checklist').get().n, 0)
  const coverageUpdated = JSON.parse(await coverageTool.execute({
    engagement: scopedEngagement, phase: 'external', action: 'update',
    asset_id: batchCommit.results[0].asset_id,
    updates: ['surface', 'web', 'auth', 'cve', 'app']
      .map(field => ({ field, state: 'done' })),
    note: 'manual fixture review',
  }, {}))
  assert.equal(coverageUpdated.coverage.ready_to_close, true)
  assert.equal(coverageUpdated.coverage.complete, false)
  const coverageClosed = JSON.parse(await coverageTool.execute({
    engagement: scopedEngagement, phase: 'external', action: 'close',
    asset_id: batchCommit.results[0].asset_id, status: 'closed',
  }, {}))
  assert.equal(coverageClosed.coverage.complete, true)
  const coverageQueue = JSON.parse(await coverageTool.execute({
    engagement: scopedEngagement, phase: 'external', action: 'queue',
  }, {}))
  assert.equal(coverageQueue.ok, true)
  assert.equal(coverageQueue.pending_in_sample, 0)
  assert.equal(redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id).test_status,
    'untested', 'new checklist leaves legacy asset_test status alone')

  const hostEngagement = redteam.openEngagement('linked-host-tool-fixture',
    ['10.45.0.0/24'], { bindCurrent: false }).id
  redteam.importBundle(hostEngagement, {
    scan: { tool: 'fixture', argv: [] },
    assets: [{ ip: '10.45.0.8', provenance: 'passive', tool: 'fixture', state: 'live' }],
  })
  const hostAssetId = redteam.listAssets(hostEngagement, { ip: '10.45.0.8' }).items[0].id
  const hostEvidenceId = redteam.addHttpEvidence(hostEngagement, {
    asset_id: hostAssetId, label: 'sanitized host-tool fixture',
  }).id
  const recordedHostFinding = JSON.parse(await coverageTool.execute({
    engagement: hostEngagement, phase: 'internal', action: 'finding',
    asset_id: hostAssetId, kind: 'web', title: 'Manual HTTP review',
    detail: 'Only a sanitized metadata summary',
    evidence_kind: 'http_evidence', evidence_id: hostEvidenceId,
  }, {}))
  assert.equal(recordedHostFinding.ok, true)
  assert.equal(recordedHostFinding.finding.evidence_linked, true)
  const hostFindingList = JSON.parse(await coverageTool.execute({
    engagement: hostEngagement, phase: 'internal', action: 'findings',
    asset_id: hostAssetId,
  }, {}))
  assert.equal(hostFindingList.total, 1)
  assert.equal(hostFindingList.items[0].title, 'Manual HTTP review')
  assert.equal(hostFindingList.items[0].evidence_ref, 'http_evidence:' + hostEvidenceId)
  assert.equal(redteam.coverageChecklist(hostEngagement, hostAssetId, 'internal').status, 'open')
  assert.deepEqual(redteam.coverageChecklist(hostEngagement, hostAssetId, 'internal').missing,
    ['files', 'privesc', 'web', 'db', 'lateral'])
  const wrongHostEvidence = JSON.parse(await coverageTool.execute({
    engagement: hostEngagement, phase: 'internal', action: 'finding',
    asset_id: hostAssetId, kind: 'web', title: 'Non-existent evidence',
    evidence_kind: 'http_evidence', evidence_id: 9999999,
  }, {}))
  assert.equal(wrongHostEvidence.ok, false)
  assert.equal(hostFindingList.total, redteam.listHostFindings(hostEngagement, hostAssetId).total)
  const wrongHostPhase = JSON.parse(await coverageTool.execute({
    engagement: hostEngagement, phase: 'external', action: 'findings', asset_id: hostAssetId,
  }, {}))
  assert.equal(wrongHostPhase.ok, false, 'host findings only belong to internal review')

  const repeated = JSON.parse(await batchTool.execute({
    engagement: scopedEngagement, items: batchItems, commit: true,
  }, {}))
  assert.equal(repeated.written, 1)
  assert.equal(repeated.results[0].asset_id, batchCommit.results[0].asset_id)
  assert.equal(redteam.listAssets(scopedEngagement, {}).total, 1, 'upsert reuses existing asset')
  assert.equal(redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id).discovered_at,
    '2026-11-01T00:00:00Z', 'existing discovery time survives a repeat import')
  const unscopedDenied = JSON.parse(await batchTool.execute({
    engagement, items: [{ ip: '203.0.113.9', provenance: 'passive' }], commit: true,
  }, {}))
  assert.equal(unscopedDenied.written, 0)
  assert.equal(redteam.listAssets(engagement, {}).total, 0)
  const unscopedAllowed = JSON.parse(await batchTool.execute({
    engagement, items: [{ ip: '203.0.113.9', provenance: 'passive' }],
    commit: true, confirm: true,
  }, {}))
  assert.equal(unscopedAllowed.written, 1)
  assert.equal(redteam.listAssets(engagement, {}).total, 1)

  // Selective upstream "kind=assess": reuse the existing recorded-asset assessment.
  const assessInput = [
    { asset_id: batchCommit.results[0].asset_id, ip: '192.0.2.10',
      priority: 'high', reason: 'fixture manual review', potential: 'review only' },
    { ip: '198.51.100.10', priority: 'low', reason: 'not in this engagement' },
    { asset_id: batchCommit.results[0].asset_id, priority: 'low', reason: 'duplicate' },
  ]
  const beforeAssess = redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id)
  const assessPreview = JSON.parse(await batchTool.execute({
    engagement: scopedEngagement, kind: 'assess', items: assessInput,
  }, {}))
  assert.equal(assessPreview.dry_run, true)
  assert.equal(assessPreview.accepted, 1)
  assert.equal(assessPreview.assessed, 0)
  assert.deepEqual(assessPreview.rejected.map(row => row.reason),
    ['asset_not_found', 'duplicate_in_batch'])
  assert.equal(redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id).assessed_at,
    beforeAssess.assessed_at, 'preview must not write assessment timestamp')
  const assessWrite = JSON.parse(await batchTool.execute({
    engagement: scopedEngagement, kind: 'assess', items: assessInput, commit: true,
  }, {}))
  assert.equal(assessWrite.assessed, 1)
  assert.equal(assessWrite.partial, true)
  assert.equal(assessWrite.results[0].asset_id, batchCommit.results[0].asset_id)
  assert.equal(redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id).priority, 'high')
  assert.equal(redteam.getAsset(scopedEngagement, batchCommit.results[0].asset_id).assess_reason,
    'fixture manual review')
  assert.equal(redteam.listAssets(scopedEngagement, {}).total, 1)
  const noConfirm = JSON.parse(await batchTool.execute({
    engagement, kind: 'assess', commit: true,
    items: [{ ip: '203.0.113.9', priority: 'medium', reason: 'existing asset' }],
  }, {}))
  assert.equal(noConfirm.assessed, 0)
  assert.deepEqual(noConfirm.rejected.map(row => row.reason), ['scope-empty-needs-confirm'])
  const withConfirm = JSON.parse(await batchTool.execute({
    engagement, kind: 'assess', commit: true, confirm: true,
    items: [{ ip: '203.0.113.9', priority: 'medium', reason: 'existing asset' }],
  }, {}))
  assert.equal(withConfirm.assessed, 1)

  // Selective upstream per-target scope check, entirely offline/read-only.
  const scopeTool = registered.get('redteam_scope_review')
  const targetCheck = JSON.parse(await scopeTool.execute({
    engagement: scopedEngagement, targets: ['192.0.2.10', '198.51.100.10'],
  }, {}))
  assert.equal(targetCheck.mode, 'target-check')
  assert.deepEqual(targetCheck.items.map(row => row.status), ['in-scope', 'out-of-scope'])
  assert.equal(targetCheck.items[0].rule, '192.0.2.0/24')
  const noScope = JSON.parse(await scopeTool.execute({
    engagement, target: '203.0.113.9',
  }, {}))
  assert.equal(noScope.items[0].status, 'unscoped')
  const inventoryScope = JSON.parse(await scopeTool.execute({
    engagement: scopedEngagement, allowed: '192.0.2.0/24',
  }, {}))
  assert.equal(inventoryScope.total_assets, 1, 'existing inventory-audit mode is preserved')

  const cleanupTool = registered.get('redteam_cleanup')
  const marker = join(home, 'cleanup-marker.txt')
  writeFileSync(marker, 'synthetic cleanup ledger fixture')
  const added = JSON.parse(await cleanupTool.execute({ op: 'add', engagement, kind: 'file', target: 'fixture-host',
    location: marker, detail: 'synthetic marker only' }, {}))
  assert.equal(added.ok, true)
  assert.equal(added.item.status, 'open')
  const pending = JSON.parse(await cleanupTool.execute({ op: 'list', engagement }, {}))
  assert.equal(pending.total, 1)
  assert.equal(pending.items[0].kind, 'file')
  const isolated = JSON.parse(await cleanupTool.execute({ op: 'list', engagement: otherEngagement }, {}))
  assert.equal(isolated.total, 0)
  const kept = JSON.parse(await cleanupTool.execute({ op: 'update', engagement, id: added.item.id,
    status: 'kept', detail: 'user requested retention' }, {}))
  assert.equal(kept.item.status, 'kept')
  assert.equal(JSON.parse(await cleanupTool.execute({ op: 'list', engagement }, {})).total, 0)
  const invalidOp = JSON.parse(await cleanupTool.execute({ op: 'delete', engagement }, {}))
  assert.equal(invalidOp.ok, false, 'unknown operations must not fall through to add')
  assert.equal(invalidOp.error_kind, 'bad_input')
  const dispatchedAdd = dispatch(redteam, { op: 'addCleanup', engagement,
    item: { kind: 'task', target: 'fixture-host', location: 'synthetic task', detail: 'dispatch fixture' } })
  assert.equal(dispatchedAdd.ok, true)
  const dispatchedUpdate = dispatch(redteam, { op: 'updateCleanup', engagement,
    item: { id: dispatchedAdd.id, status: 'done' } })
  assert.equal(dispatchedUpdate.ok, true)
  assert.equal(dispatchedUpdate.status, 'done')
  const all = JSON.parse(await cleanupTool.execute({ op: 'list', engagement, status: 'all' }, {}))
  assert.equal(all.total, 2)
  assert.equal(all.items[0].detail, 'dispatch fixture')
  assert.equal(all.items[1].detail, 'user requested retention')
  assert.equal(existsSync(marker), true, 'cleanup ledger records state but never deletes the resource')
  const dispatched = dispatch(redteam, { op: 'cleanup', engagement, status: 'all', limit: 0.5 })
  assert.equal(dispatched.ok, true)
  assert.equal(dispatched.total, 2)
  assert.equal(dispatched.items.length, 1, 'fractional limits clamp to one result')

  const dataProofTool = registered.get('redteam_data_proof')
  assert.equal(Object.hasOwn(dataProofTool.parameters, 'sample'), false)
  assert.equal(Object.hasOwn(dataProofTool.parameters, 'query'), false)
  const proof = JSON.parse(await dataProofTool.execute({ op: 'add', engagement, target: 'fixture-host',
    source: 'db', interface: 'users', fields: ['name', 'phone', 'name'], row_count: 12000,
    sample_count: 2, evidence_ref: 'evidence://redacted/001', pii_type: 'pii', note: 'synthetic metadata only' }, {}))
  assert.equal(proof.ok, true)
  assert.deepEqual(proof.proof.fields, ['name', 'phone'])
  assert.equal(proof.proof.sample_count, 2)
  assert.equal(Object.hasOwn(proof.proof, 'meets_threshold'), false, 'data proof must not invent a score threshold')
  const proofList = JSON.parse(await dataProofTool.execute({ op: 'list', engagement }, {}))
  assert.equal(proofList.total, 1)
  assert.equal(proofList.items[0].fields.length, 2)
  assert.equal(Object.hasOwn(proofList.items[0], 'sample'), false)
  assert.equal(Object.hasOwn(proofList.items[0], 'query'), false)
  const isolatedProofs = JSON.parse(await dataProofTool.execute({ op: 'list', engagement: otherEngagement }, {}))
  assert.equal(isolatedProofs.total, 0)
  const rawRejected = JSON.parse(await dataProofTool.execute({ op: 'add', engagement, target: 'fixture-host',
    source: 'db', interface: 'users', fields: ['name'], row_count: 1, sample: 'RAW_SAMPLE_MARKER' }, {}))
  assert.equal(rawRejected.ok, false, 'raw sample values must be rejected')
  const valueRejected = JSON.parse(await dataProofTool.execute({ op: 'add', engagement, target: 'fixture-host',
    source: 'db', interface: 'users', fields: ['name=example'], row_count: 1 }, {}))
  assert.equal(valueRejected.ok, false, 'fields must be names, not key/value samples')
  const proofDb = redteam.db(engagement)
  proofDb.exec('ALTER TABLE data_proof ADD COLUMN sample TEXT; ALTER TABLE data_proof ADD COLUMN query TEXT;')
  proofDb.prepare(`INSERT INTO data_proof(target, source, interface, fields, row_count, sample_count, evidence_ref, pii_type, note, created_by, created_at, sample, query)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('legacy-host', 'db', 'users', 'name,phone', 5, 1,
      'evidence://redacted/legacy', 'pii', 'legacy fixture', 'legacy', new Date().toISOString(),
      'LEGACY_RAW_SAMPLE_MARKER', 'SELECT * FROM users')
  const legacyList = JSON.parse(await dataProofTool.execute({ op: 'list', engagement }, {}))
  assert.equal(legacyList.total, 2)
  assert.deepEqual(legacyList.items[0].fields, ['name', 'phone'], 'legacy comma-separated fields remain readable')
  assert.equal(Object.hasOwn(legacyList.items[0], 'sample'), false)
  assert.equal(Object.hasOwn(legacyList.items[0], 'query'), false)
  const dispatchedProof = dispatch(redteam, { op: 'addDataProof', engagement, proof: {
    target: 'fixture-host', source: 'file', interface: '/exports/users.csv', fields: ['email'],
    row_count: 3, sample_count: 1, evidence_ref: 'evidence://redacted/002', pii_type: 'pii', note: 'dispatch fixture',
  } })
  assert.equal(dispatchedProof.ok, true)
  const dispatchedProofs = dispatch(redteam, { op: 'dataProofs', engagement })
  assert.equal(dispatchedProofs.total, 3)
  const report = redteam.report(engagement)
  assert.equal(report.stats.dataProofs, 3)
  assert.ok(report.markdown.includes('Structured data exposure records (metadata only)'))
  assert.ok(report.markdown.includes('evidence://redacted/001'))
  assert.ok(!report.markdown.includes('RAW_SAMPLE_MARKER'))
  assert.ok(!report.markdown.includes('SELECT * FROM users'))

  const { knowledgeRequest } = await import('../lib/redteam/knowledge-center.js')
  const saved = knowledgeRequest(home, { op: 'knowledgeSave', title: 'Example personal note', body: 'LOCAL_REFERENCE_BODY' }).item
  const unifiedSearch = registered.get('redteam_knowledge_search')
  const unifiedGet = registered.get('redteam_knowledge_get')
  const paginationIds = []
  for (let i = 0; i < 21; i++) {
    const item = knowledgeRequest(home, {
      op: 'knowledgeSave', title: 'Pagination note ' + String(i).padStart(2, '0'), body: 'Pagination fixture ' + i,
    }).item
    paginationIds.push(String(item.id))
  }
  const personalFirst = JSON.parse(await unifiedSearch.execute({ query: 'Pagination note', source: 'personal' }))
  const personalNext = JSON.parse(await unifiedSearch.execute({ query: 'Pagination note', source: 'personal', offset: 20 }))
  assert.equal(personalFirst.groups[0].total, 21)
  assert.equal(personalFirst.groups[0].items.length, 20)
  assert.equal(personalFirst.groups[0].offset, 0)
  assert.equal(personalFirst.groups[0].hasMore, true)
  assert.equal(personalNext.groups[0].offset, 20)
  assert.equal(personalNext.groups[0].items.length, 1)
  assert.equal(personalNext.groups[0].hasMore, false)
  assert.equal(new Set([...personalFirst.groups[0].items, ...personalNext.groups[0].items].map(item => String(item.id))).size, 21)
  assert.equal(paginationIds.length, 21)
  const results = JSON.parse(await unifiedSearch.execute({ query: 'Example', source: 'personal' }))
  assert.equal(results.ok, true)
  assert.deepEqual(results.groups[0].items[0].reference, { source: 'personal', id: String(saved.id) })
  assert.equal(JSON.stringify(results).includes('LOCAL_REFERENCE_BODY'), false)
  const local = JSON.parse(await unifiedGet.execute({ source: 'personal', id: String(saved.id), max_chars: 5 }))
  assert.equal(local.ok, true)
  assert.equal(local.item.body, 'LOCAL')
  assert.equal(local.item.truncated, true)
  const full = JSON.parse(await unifiedGet.execute({ source: 'personal', id: String(saved.id) }))
  assert.equal(full.item.body, 'LOCAL_REFERENCE_BODY')
  assert.equal(full.item.truncated, false)
  assert.equal(JSON.parse(await unifiedSearch.execute({ query: '' })).ok, false)
  const bundledFirst = JSON.parse(await unifiedSearch.execute({ source: 'bundled' }))
  const bundledNext = JSON.parse(await unifiedSearch.execute({ source: 'bundled', offset: 20 }))
  assert.equal(bundledFirst.ok, true)
  assert.equal(bundledFirst.groups[0].hasMore, true)
  assert.equal(bundledNext.groups[0].offset, 20)
  assert.ok(bundledNext.groups[0].items.length > 0)
  const filtered = JSON.parse(await unifiedSearch.execute({ source: 'bundled', category: 'AI 运行时' }))
  assert.ok(filtered.groups[0].items.length > 0)
  assert.ok(filtered.groups[0].items.every(item => item.category === 'AI 运行时'))
  const reference = filtered.groups[0].items[0].reference
  const built = JSON.parse(await unifiedGet.execute(reference))
  assert.equal(built.ok, true); assert.equal(built.item.origin, 'bundled'); assert.ok(built.item.body.length > 0)

  const kbSearch = registered.get('redteam_artex_knowledge_search')
  const search = JSON.parse(await kbSearch.execute({ query: 'Example', limit: 3 }))
  assert.equal(search.ok, true)
  assert.equal(search.read_only, true)
  assert.deepEqual(search.items.map(item => item.id), [17])
  const kbGet = registered.get('redteam_artex_knowledge_get')
  const detail = JSON.parse(await kbGet.execute({ id: 17 }))
  assert.equal(detail.ok, true)
  assert.equal(detail.read_only, true)
  assert.equal(detail.item.content, 'No commands were executed')
  const missing = JSON.parse(await kbSearch.execute({ query: '' }))
  assert.equal(missing.ok, false, 'empty queries must return a visible tool error')
  const invalid = JSON.parse(await kbGet.execute({ id: -1 }))
  assert.equal(invalid.ok, false, 'invalid knowledge IDs must return a visible tool error')
})
