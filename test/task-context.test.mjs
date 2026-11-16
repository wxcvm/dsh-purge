import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'
import { taskContext } from '../lib/redteam/task-context.js'

function fixture(path = ':memory:', initialize = true) {
  const db = new DatabaseSync(path)
  if (initialize) db.exec([
    'CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, segment_cidr TEXT, state TEXT, test_status TEXT, test_notes TEXT, blocked_count INTEGER)',
    'CREATE TABLE vuln (id INTEGER PRIMARY KEY, asset_id INTEGER, title TEXT, severity TEXT, status TEXT, evidence TEXT, cve TEXT, target TEXT, gained TEXT)',
    'CREATE TABLE http_evidence (id INTEGER PRIMARY KEY, vuln_id INTEGER, asset_id INTEGER, label TEXT, method TEXT, url TEXT, status INTEGER, request TEXT, response TEXT, note TEXT, captured_by TEXT, captured_at TEXT)',
    "INSERT INTO asset VALUES (5, '192.0.2.5', '192.0.2.0/24', 'live', 'testing', 'started\nneeds manual approval', 1)",
    "INSERT INTO asset VALUES (6, '192.0.2.6', '192.0.2.0/24', 'live', 'blocked', 'network access denied', 2)",
    "INSERT INTO vuln VALUES (11, 5, 'candidate finding', 'high', 'candidate', '', NULL, 'https://example.test', '')",
    "INSERT INTO vuln VALUES (12, 6, 'other finding', 'low', 'candidate', '', NULL, '', '')",
    "INSERT INTO vuln VALUES (13, 999, 'unlinked target', 'medium', 'candidate', '', NULL, '', '')",
    "INSERT INTO http_evidence VALUES (21, 11, NULL, 'HTTP result', 'GET', 'https://example.test', 200, 'GET /secret HTTP/1.1', 'HTTP/1.1 200 OK', '', 'lab', '2026-11-08')",
    "INSERT INTO http_evidence VALUES (22, NULL, 5, 'direct observation', 'HEAD', 'https://example.test', 204, 'HEAD / HTTP/1.1', '', '', 'lab', '2026-11-08')",
  ].join(';\n') + ';')
  const store = {
    db: () => db,
    getAsset(_engagement, id) {
      const asset = db.prepare('SELECT * FROM asset WHERE id = ?').get(id)
      return asset ? {
        ...asset, scope: 'external', open_ports: 1,
        ports: [{ port: 443, proto: 'tcp', service: 'https', state: 'open' }, { port: 23, state: 'closed' }],
        fingerprints: [{ vendor: 'Example', product: 'Demo', version: '1' }],
        secret_value: 'NEVER_EXPOSE',
      } : undefined
    },
    listVulns(engagement, options) {
      return RedteamStore.prototype.listVulns.call(this, engagement, options)
    },
    queryHttpEvidence(engagement, options) {
      return RedteamStore.prototype.queryHttpEvidence.call(this, engagement, options)
    },
  }
  return { db, store }
}

test('asset task context joins real database vuln summaries with separate direct evidence IDs', () => {
  const { db, store } = fixture()
  try {
    const context = taskContext(store, 'lab', 'asset #5')
    assert.equal(context.ok, true)
    assert.equal(context.target, 'asset #5')
    assert.equal(context.asset.id, 5)
    assert.equal(context.asset.test_status, 'testing')
    assert.equal(context.asset.blocked_count, 1)
    assert.deepEqual(context.asset.recent_test_notes, ['started', 'needs manual approval'])
    assert.equal(context.asset.open_ports.length, 1)
    assert.equal(context.related_vulns.total, 1)
    assert.equal(context.related_vulns.items[0].id, 11)
    assert.equal(context.related_vulns.items[0].http_evidence_count, 1)
    assert.equal(context.direct_http_evidence.total, 1)
    assert.equal(context.direct_http_evidence.items[0].id, 22)
    assert.equal(context.direct_http_evidence.items[0].has_request, true)
    assert.equal(context.direct_http_evidence.items[0].request, undefined)
    assert.equal(JSON.stringify(context).includes('GET /secret'), false)
    assert.equal(JSON.stringify(context).includes('NEVER_EXPOSE'), false)
  } finally {
    db.close()
  }
})

test('vuln task key resolves linked asset and HTTP evidence without reading raw body', () => {
  const { db, store } = fixture()
  try {
    const context = taskContext(store, 'lab', '复核有证据的候选漏洞:vuln #11')
    assert.equal(context.ok, true)
    assert.equal(context.target, 'vuln #11')
    assert.equal(context.vulnerability.id, 11)
    assert.equal(context.vulnerability.evidence_present, true)
    assert.equal(context.linked_asset.id, 5)
    assert.equal(context.asset_link_status, 'linked')
    assert.equal(context.http_evidence.total, 1)
    assert.equal(context.http_evidence.items[0].id, 21)
    assert.equal(context.http_evidence.items[0].response, undefined)
    assert.equal(JSON.stringify(context).includes('GET /secret'), false)

    const missingAsset = taskContext(store, 'lab', 'vuln #13')
    assert.equal(missingAsset.asset_link_status, 'missing')
    assert.equal(missingAsset.linked_asset, null)
    assert.equal(taskContext(store, 'lab', 'vuln #999').ok, false)
    assert.equal(taskContext(store, 'lab', 'asset #999').ok, false)
  } finally {
    db.close()
  }
})

test('task context rejects ambiguous or unsafe focus target IDs', () => {
  const { db, store } = fixture()
  try {
    for (const target of ['', '资产 #5', 'asset #0', 'vuln #-1', 'asset #1.5', 'asset #9007199254740993', 'asset #5 anything']) {
      assert.throws(() => taskContext(store, 'lab', target), /target must|safe integer/)
    }
  } finally {
    db.close()
  }
})


test('asset task context automatically includes offline CVE candidates without modifying SQLite findings', () => {
  const { db, store } = fixture()
  try {
    const getAsset = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const original = getAsset(engagement, id)
      if (!original) return original
      return {
        ...original,
        ports: [{ port: 3000, proto: 'tcp', state: 'open', service: 'http', product: 'Grafana', version: '8.2.5' }],
        fingerprints: [{ product: 'Grafana', version: '8.2.5' }],
      }
    }
    const before = db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n
    const context = taskContext(store, 'lab', 'asset #5')
    const hit = context.knowledge_candidates.find((row) => row.cve.includes('CVE-2021-43798'))
    assert.ok(hit)
    assert.equal(hit.verified, false)
    assert.equal(hit.status, 'candidate')
    assert.ok(hit.source_url.startsWith('https://github.com/FJNB5/fujiang-pojia/blob/'))
    assert.equal(Array.isArray(context.related_skills), true)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, before)
    assert.equal(JSON.stringify(context).includes('NEVER_EXPOSE'), false)
  } finally {
    db.close()
  }
})

test('task context surfaces compact ARTEX references for product and CVE without importing records', (t) => {
  const { db, store } = fixture()
  t.after(() => db.close())
  const folder = mkdtempSync(join(tmpdir(), 'artex-task-hints-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const previous = process.env.ARTEX_KB_DIR
  process.env.ARTEX_KB_DIR = folder
  t.after(() => {
    if (previous === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = previous
  })
  const kb = new DatabaseSync(join(folder, 'knowledge.db'))
  kb.exec("CREATE TABLE poc (id INTEGER PRIMARY KEY, title TEXT, category TEXT, kind TEXT, tags TEXT, verified INTEGER, description TEXT, usage TEXT, content TEXT)")
  kb.prepare('INSERT INTO poc VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    71, 'Grafana research notes', 'reference', 'markdown', 'grafana', 0,
    'Previous observations', '', 'UNTRUSTED_HISTORY_SHOULD_NOT_BE_IN_TASK_CONTEXT')
  kb.prepare('INSERT INTO poc VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    72, 'CVE-2021-43798 investigation', 'reference', 'markdown', 'grafana', 1,
    'Historical finding', '', 'HISTORICAL_BODY_NOT_CURRENT_EVIDENCE')
  kb.close()

  const originalAsset = store.getAsset.bind(store)
  store.getAsset = (engagement, id) => {
    const asset = originalAsset(engagement, id)
    return asset && id === 5 ? { ...asset,
      ports: [{ port: 3000, proto: 'tcp', state: 'open', product: 'Grafana' }],
      fingerprints: [{ product: 'Grafana', version: '8.2.5' }],
    } : asset
  }
  const countBefore = db.prepare('SELECT count(*) AS n FROM vuln').get().n
  const assetContext = taskContext(store, 'lab', 'asset #5')
  assert.equal(assetContext.artex_knowledge.status, 'available')
  assert.equal(assetContext.artex_knowledge.query, 'Grafana')
  assert.deepEqual(assetContext.artex_knowledge.items.map(item => item.id), [71, 72])
  assert.equal(assetContext.artex_knowledge.items[0].content, undefined)
  assert.equal(JSON.stringify(assetContext).includes('UNTRUSTED_HISTORY'), false)

  db.exec("UPDATE vuln SET cve = 'CVE-2021-43798' WHERE id = 11")
  const vulnContext = taskContext(store, 'lab', 'vuln #11')
  assert.equal(vulnContext.artex_knowledge.query, 'CVE-2021-43798')
  assert.deepEqual(vulnContext.artex_knowledge.items.map(item => item.id), [72])
  assert.equal(vulnContext.artex_knowledge.items[0].verified, true)
  assert.equal(JSON.stringify(vulnContext).includes('HISTORICAL_BODY'), false)
  assert.equal(db.prepare('SELECT count(*) AS n FROM vuln').get().n, countBefore)
})

test('missing ARTEX knowledge does not block existing task context', (t) => {
  const { db, store } = fixture()
  t.after(() => db.close())
  const prev = process.env.ARTEX_KB_DIR
  process.env.ARTEX_KB_DIR = join(tmpdir(), 'artex-kb-absent-for-task')
  t.after(() => {
    if (prev === undefined) delete process.env.ARTEX_KB_DIR
    else process.env.ARTEX_KB_DIR = prev
  })
  const originalGet = store.getAsset.bind(store)
  store.getAsset = (engagement, id) => {
    const row = originalGet(engagement, id)
    return row ? { ...row, fingerprints: [] } : row
  }
  const asset = taskContext(store, 'lab', 'asset #5')
  assert.equal(asset.ok, true)
  assert.equal(asset.artex_knowledge.status, 'no-keyword')
  store.getAsset = (engagement, id) => {
    const row = originalGet(engagement, id)
    return row ? { ...row, fingerprints: [{ product: 'Grafana' }] } : row
  }
  const withKeyword = taskContext(store, 'lab', 'asset #5')
  assert.equal(withKeyword.ok, true)
  assert.equal(withKeyword.artex_knowledge.status, 'not-installed')
  assert.deepEqual(withKeyword.artex_knowledge.items, [])
})

test('task context labels provenance and the coverage of bounded summaries', () => {
  const { db, store } = fixture()
  try {
    const getAsset = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const asset = getAsset(engagement, id)
      return asset && { ...asset,
        test_notes: ['old one', 'old two', 'recent one', 'x'.repeat(300), 'recent three'].join('\n'),
        test_surface: 's'.repeat(300),
        open_ports: 25,
        ports: Array.from({ length: 25 }, (_, i) => ({ port: 10000 + i, state: 'open', proto: 'tcp' })),
        fingerprints: Array.from({ length: 12 }, (_, i) => ({ vendor: 'Demo', product: 'Fixture', version: String(i) })),
      }
    }
    const context = taskContext(store, 'lab', 'asset #5')
    const { asset, provenance } = context
    assert.equal(asset.recent_test_notes.length, 3)
    assert.equal(asset.recent_test_notes[1].length, 240)
    assert.equal(asset.test_surface.length, 240)
    assert.equal(asset.open_ports.length, 20)
    assert.equal(asset.fingerprints.length, 10)
    assert.deepEqual(asset.summary_coverage, {
      test_notes_total: 5, test_notes_omitted: 2, test_notes_text_truncated: true,
      test_surface_truncated: true, open_ports_omitted: 5, fingerprints_omitted: 2,
    })
    assert.deepEqual(provenance, {
      records: 'local-engagement-store', knowledge: 'reference-only',
      current_target_validation: 'not-performed-by-context',
    })
    assert.equal(context.artex_knowledge.source, 'local-artex-knowledge')
    assert.equal(context.artex_knowledge.verification_scope, 'historical-reference')
    const linked = taskContext(store, 'lab', 'vuln #11')
    assert.equal(linked.linked_asset.summary_coverage.open_ports_omitted, 5)
    assert.deepEqual(linked.provenance, provenance)
    assert.equal(linked.artex_knowledge.verification_scope, 'historical-reference')
  } finally {
    db.close()
  }
})

test('task context masks common credentials in HTTP metadata without changing stored evidence', () => {
  const { db, store } = fixture()
  try {
    const url = 'https://user:synthetic-userinfo@example.test/path?access_token=synthetic-query&view=1'
    const label = 'api_key=synthetic-label'
    const note = 'Authorization: Basic synthetic-header'
    db.prepare('UPDATE http_evidence SET url = ?, label = ?, note = ? WHERE id IN (21, 22)').run(url, label, note)

    const asset = taskContext(store, 'lab', 'asset #5')
    const vuln = taskContext(store, 'lab', 'vuln #11')
    for (const result of [asset.direct_http_evidence, vuln.http_evidence]) {
      assert.equal(result.total, 1)
      const item = result.items[0]
      assert.ok(item.url.includes('example.test/path'))
      assert.ok(item.url.includes('view=1'))
      assert.ok(item.url.includes('[REDACTED_USERINFO]'))
      assert.ok(item.url.includes('access_token=[REDACTED_SECRET]'))
      assert.equal(item.label, 'api_key=[REDACTED_SECRET]')
      assert.equal(item.note, 'Authorization: [REDACTED_SECRET]')
      for (const secret of ['synthetic-userinfo', 'synthetic-query', 'synthetic-label', 'synthetic-header']) {
        assert.equal(JSON.stringify(item).includes(secret), false)
      }
      assert.equal(item.has_request, true)
    }
    const raw = db.prepare('SELECT url, label, note FROM http_evidence WHERE id = 21').get()
    assert.equal(raw.url, url)
    assert.equal(raw.label, label)
    assert.equal(raw.note, note)
  } finally {
    db.close()
  }
})

test('stored testing progress survives database reopen without claiming current execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-task-reopen-'))
  const path = join(root, 'lab.db')
  let opened
  try {
    opened = fixture(path)
    opened.db.exec('ALTER TABLE asset ADD COLUMN test_updated_at TEXT')
    const timestamp = '2026-11-08T10:00:00.000Z'
    opened.db.prepare('UPDATE asset SET test_updated_at = ? WHERE id = 5').run(timestamp)
    const saved = taskContext(opened.store, 'lab', 'asset #5').asset
    assert.equal(saved.test_status, 'testing')
    assert.equal(saved.test_status_source, 'stored-record')
    assert.equal(saved.runtime_activity, 'not-observed')
    assert.equal(saved.test_updated_at, timestamp)
    opened.db.close()
    opened = null

    opened = fixture(path, false)
    const reopened = taskContext(opened.store, 'lab', 'asset #5').asset
    assert.deepEqual(reopened, saved)
    const linked = taskContext(opened.store, 'lab', 'vuln #11').linked_asset
    assert.deepEqual(linked, saved)
    const blocked = taskContext(opened.store, 'lab', 'asset #6').asset
    assert.equal(blocked.test_status, 'blocked')
    assert.equal(blocked.runtime_activity, 'not-observed')
    assert.equal(opened.db.prepare('SELECT test_status FROM asset WHERE id = 5').get().test_status, 'testing')
    opened.db.exec('UPDATE asset SET test_status = NULL WHERE id = 6')
    const absent = taskContext(opened.store, 'lab', 'asset #6').asset
    assert.equal(absent.test_status, 'untested')
    assert.equal(absent.test_status_source, 'default')
    assert.equal(absent.runtime_activity, 'not-observed')
  } finally {
    if (opened) opened.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})


test('task context excludes candidates outside a structured fixed-version range', () => {
  const { db, store } = fixture()
  try {
    const original = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const asset = original(engagement, id)
      return asset && id === 5 ? {
        ...asset,
        ports: [{ port: 3000, state: 'open', product: 'Grafana', version: '8.2.7' }],
        fingerprints: [{ product: 'Grafana', version: '8.2.7' }],
      } : asset
    }
    const before = db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n
    const context = taskContext(store, 'lab', 'asset #5')
    assert.equal(context.knowledge_candidates.some(row => row.cve.includes('CVE-2021-43798')), false)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, before)
  } finally { db.close() }
})


test('product-related skills are suggested even when no CVE candidate matches', () => {
  const { db, store } = fixture()
  try {
    const getAsset = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const row = getAsset(engagement, id)
      return row && { ...row,
        test_surface: 'REST API inventory service',
        ports: [{ port: 8080, proto: 'tcp', state: 'open', service: 'http', product: 'Inventory API', version: '1.0' }],
        fingerprints: [],
      }
    }
    const before = db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n
    const context = taskContext(store, 'lab', 'asset #5')
    assert.equal(context.knowledge_candidates.length, 0)
    assert.ok(context.related_skills.some(skill => skill.key === 'redteam:api-attack'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, before)
  } finally {
    db.close()
  }
})

test('business security controls are suggested from observed workflow evidence without CVE matches', () => {
  const { db, store } = fixture()
  try {
    const getAsset = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const row = getAsset(engagement, id)
      return row && { ...row,
        test_surface: '订单 API 支付回调与租户隔离',
        ports: [{ port: 443, proto: 'tcp', state: 'open', service: 'https' }],
        fingerprints: [],
      }
    }
    const before = db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n
    const context = taskContext(store, 'lab', 'asset #5')
    assert.equal(context.knowledge_candidates.length, 0)
    const skill = context.related_skills.find(item => item.key === 'redteam:business-security-controls')
    assert.ok(skill)
    assert.match(skill.description, /多租户隔离/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vuln').get().n, before)
  } finally {
    db.close()
  }
})

test('generic infrastructure observations do not receive business-workflow skill hints', () => {
  const { db, store } = fixture()
  try {
    const getAsset = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const row = getAsset(engagement, id)
      return row && { ...row,
        test_surface: 'SSH and DNS service availability',
        ports: [{ port: 22, proto: 'tcp', state: 'open', service: 'ssh' }, { port: 53, proto: 'udp', state: 'open', service: 'dns' }],
        fingerprints: [],
      }
    }
    const context = taskContext(store, 'lab', 'asset #5')
    assert.ok(!context.related_skills.some(item => item.key === 'redteam:business-security-controls'))
  } finally {
    db.close()
  }
})


test('orphan vulnerability title can supply API and authorization context for skill hints', () => {
  const { db, store } = fixture()
  try {
    db.prepare('UPDATE vuln SET title = ? WHERE id = 13').run('API 对象级授权边界')
    const context = taskContext(store, 'lab', 'vuln #13')
    assert.equal(context.asset_link_status, 'missing')
    assert.equal(context.knowledge_candidates.length, 0)
    assert.ok(context.related_skills.some(skill => skill.key === 'redteam:business-security-controls'))
    assert.ok(context.related_skills.some(skill => skill.key === 'redteam:api-attack'))
  } finally {
    db.close()
  }
})

test('business controls remain in the bounded skill hints alongside product and API matches', () => {
  const { db, store } = fixture()
  try {
    const getAsset = store.getAsset.bind(store)
    store.getAsset = (engagement, id) => {
      const row = getAsset(engagement, id)
      return row && { ...row,
        test_surface: '订单 API 支付回调与租户隔离',
        ports: [{ port: 443, proto: 'tcp', state: 'open', service: 'https', product: 'Inventory API' }],
        fingerprints: [],
      }
    }
    const context = taskContext(store, 'lab', 'asset #5')
    assert.ok(context.related_skills.some(skill => skill.key === 'redteam:business-security-controls'))
    assert.ok(context.related_skills.some(skill => skill.key === 'redteam:api-attack'))
    assert.ok(context.related_skills.length <= 5)
  } finally {
    db.close()
  }
})
