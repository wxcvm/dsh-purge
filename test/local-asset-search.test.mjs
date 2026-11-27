import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { compileLocalAssetQuery, LOCAL_ASSET_FIELDS } from '../lib/redteam/local-asset-search.js'

const fixture = (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec([
    'CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, primary_name TEXT, scope TEXT)',
    'CREATE TABLE asset_name (asset_id INTEGER, name TEXT, provenance TEXT, tool TEXT)',
    'CREATE TABLE port (id INTEGER PRIMARY KEY, asset_id INTEGER, port INTEGER, state TEXT, proto TEXT, provenance TEXT, title TEXT, banner TEXT, url TEXT)',
    'CREATE TABLE service (port_id INTEGER, name TEXT, product TEXT, cpe TEXT, provenance TEXT, tool TEXT)',
    'CREATE TABLE fingerprint (asset_id INTEGER, category TEXT, product TEXT, vendor TEXT, evidence TEXT, provenance TEXT, tool TEXT)',
    'CREATE TABLE observation (entity_kind TEXT, entity_id INTEGER, attr TEXT, value TEXT, provenance TEXT, tool TEXT)',
    "INSERT INTO asset VALUES (1, '192.0.2.12', 'app.demo.test', 'external')",
    "INSERT INTO asset VALUES (2, '192.0.2.13', 'vpn.demo.test', 'external')",
    "INSERT INTO asset VALUES (3, '10.3.0.5', 'internal.demo.test', 'internal')",
    "INSERT INTO asset VALUES (4, '192.0.2.14', 'alias-only.demo.test', 'external')",
    "INSERT INTO asset_name(asset_id, name, provenance, tool) VALUES (1, 'api.demo.test', 'active', 'fixture')",
    "INSERT INTO asset_name(asset_id, name, provenance, tool) VALUES (4, 'alias.demo.test', 'passive', 'crt.sh')",
    "INSERT INTO port VALUES (1, 1, 443, 'open', 'tcp', 'active', 'Demo Login', 'nginx banner', 'https://app.demo.test')",
    "INSERT INTO port VALUES (2, 2, 443, 'closed', 'tcp', 'passive', 'VPN', 'apache', 'https://vpn.demo.test')",
    "INSERT INTO port VALUES (3, 3, 8080, 'open', 'tcp', 'passive', 'Developer', 'tomcat', 'http://internal.demo.test:8080')",
    "INSERT INTO service VALUES (1, 'https', 'nginx', 'cpe:/a:nginx:nginx', 'active', 'fixture')",
    "INSERT INTO service VALUES (2, 'https', 'apache', 'cpe:/a:apache:httpd', 'passive', 'fixture')",
    "INSERT INTO service VALUES (3, 'http', 'tomcat', 'cpe:/a:apache:tomcat', 'passive', 'fixture')",
    "INSERT INTO fingerprint(asset_id, category, product, vendor, evidence, provenance, tool) VALUES (1, 'web', 'nginx', 'Example', 'demo application', 'active', 'fixture')",
    "INSERT INTO fingerprint(asset_id, category, product, vendor, evidence, provenance, tool) VALUES (2, 'web', 'apache', 'Example', 'passive banner', 'active', 'fingerprint-fixture')",
    "INSERT INTO fingerprint(asset_id, category, product, vendor, evidence, provenance, tool) VALUES (3, 'tls', 'tomcat', 'Example', 'issuer Local CA', 'passive', 'fixture')",
    "INSERT INTO observation(entity_kind, entity_id, attr, value, provenance, tool) VALUES ('asset', 3, 'cert_subject', '*.demo.test', 'passive', 'fixture')",
    "INSERT INTO observation(entity_kind, entity_id, attr, value, provenance, tool) VALUES ('asset', 3, 'primary_name', 'internal.demo.test', 'active', 'dns-fixture')",
  ].join(';') + ';')
  return (input) => {
    const compiled = compileLocalAssetQuery(input)
    return db.prepare('SELECT a.id FROM asset a WHERE ' + compiled.where + ' ORDER BY a.id')
      .all(...compiled.args).map((r) => r.id)
  }
}

test('offline asset DSL supports combined filters, exact open ports, and observed certificate metadata', (t) => {
  const q = fixture(t)
  assert.deepEqual(q('domain="demo.test" && port=443'), [1])
  assert.deepEqual(q('title="Demo Login" && product=nginx'), [1])
  assert.deepEqual(q('domain="api.demo.test"'), [1])
  assert.deepEqual(q('service=tomcat || banner=apache'), [2, 3])
  assert.deepEqual(q('(port=443 || port=8080) && scope=internal'), [3])
  assert.deepEqual(q('host="192.0.2.13"'), [2])
  assert.deepEqual(q('cert="Local CA"'), [3])
  assert.deepEqual(q('source=active'), [1, 2, 3])
  assert.deepEqual(q('source=passive'), [2, 3, 4])
  assert.deepEqual(q('url="https://app.demo.test"'), [1])
  assert.deepEqual(q('protocol=udp'), [])
})

test('queries cannot turn into raw SQL and unsupported fields return useful errors', (t) => {
  const q = fixture(t)
  assert.deepEqual(q('title="Demo%"'), [])
  assert.deepEqual(q('title="Demo_"'), [])
  assert.deepEqual(q('ip="192.0.2.12"'), [1])
  assert.deepEqual(q('ip="192.0.2.12\\" OR 1=1"'), [])
  for (const bad of ['', 'body="x"', 'country=CN', 'port=99999',
    'scope=unknown', 'source=fofa', 'title=x &&', 'title=x || || port=80',
    '(title=x', 'title=x port=443', 'title=x && (port=443))']) {
    assert.throws(() => compileLocalAssetQuery(bad), Error, bad)
  }
  assert.ok(LOCAL_ASSET_FIELDS.includes('cert'))
  assert.match(compileLocalAssetQuery('title=x OR port=80 AND domain=demo').where, / OR /)
})

test('offline query rejects malformed quotes rather than silently truncating values', (t) => {
  const q = fixture(t)
  for (const bad of ['title="Demo', "title='Demo", 'title=Demo"Login', 'title="Demo Login"x']) {
    assert.throws(() => compileLocalAssetQuery(bad), /查询语法错误/, bad)
  }
  assert.deepEqual(q('title="Demo Login"'), [1])
  assert.deepEqual(q("title='Demo Login'"), [1])
  assert.deepEqual(q('title=Demo'), [1])
  assert.deepEqual(compileLocalAssetQuery('url=https://example.test/?a=b').args,
    ['%https://example.test/?a=b%'])
})

test('offline query enforces input limits and preserves boolean precedence', (t) => {
  const q = fixture(t)
  assert.deepEqual(q('title=Demo OR title=Developer AND scope=external'), [1])
  assert.deepEqual(q('(title=Demo OR title=Developer) AND scope=internal'), [3])
  assert.deepEqual(q('title=Demo AND (scope=external OR scope=internal)'), [1])
  assert.throws(() => compileLocalAssetQuery('title="Demo\0Login"'), /NUL/)
  assert.throws(() => compileLocalAssetQuery('title=' + 'a'.repeat(1200)), /1200/)
  assert.throws(() => compileLocalAssetQuery('('.repeat(9) + 'title=Demo' + ')'.repeat(9)), /嵌套过深/)
  assert.throws(() => compileLocalAssetQuery(Array(25).fill('title=x').join(' OR ')), /24/)
  const clauses = Array(24).fill('title=x').join(' OR ')
  assert.equal(compileLocalAssetQuery(clauses).clauses, 24)
  assert.throws(() => compileLocalAssetQuery('('.repeat(7) + clauses + ')'.repeat(7)), /查询条件过多/)
})

test('offline search is available through the workbench API without any scanning', async (t) => {
  const { RedteamStore, dispatch } = await import('../lib/redteam/store-core.js')
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec([
    'CREATE TABLE asset (id INTEGER PRIMARY KEY, ip TEXT, ip_int INTEGER, segment_cidr TEXT, state TEXT, primary_name TEXT, scope TEXT, priority TEXT, test_status TEXT, first_seen TEXT, discovered_at TEXT)',
    'CREATE TABLE asset_name (id INTEGER PRIMARY KEY, asset_id INTEGER, name TEXT)',
    'CREATE TABLE port (id INTEGER PRIMARY KEY, asset_id INTEGER, port INTEGER, state TEXT, proto TEXT, provenance TEXT, title TEXT, banner TEXT, url TEXT)',
    'CREATE TABLE service (id INTEGER PRIMARY KEY, port_id INTEGER, name TEXT, product TEXT, cpe TEXT)',
    'CREATE TABLE fingerprint (id INTEGER PRIMARY KEY, asset_id INTEGER, category TEXT, product TEXT, vendor TEXT, evidence TEXT)',
    'CREATE TABLE observation (id INTEGER PRIMARY KEY, entity_kind TEXT, entity_id INTEGER, attr TEXT, value TEXT)',
    "INSERT INTO asset VALUES (1, '192.0.2.1', 1, '192.0.2.0/24', 'live', 'app.example.test', 'external', 'high', 'untested', '2026-11-10', '2026-11-10')",
    "INSERT INTO asset VALUES (2, '192.0.2.2', 2, '192.0.2.0/24', 'live', 'vpn.example.test', 'external', 'medium', 'untested', '2026-11-10', '2026-11-10')",
    "INSERT INTO port VALUES (1, 1, 443, 'open', 'tcp', 'active', 'Demo Login', 'nginx', 'https://app.example.test')",
    "INSERT INTO port VALUES (2, 2, 443, 'closed', 'tcp', 'passive', 'VPN', 'apache', 'https://vpn.example.test')",
    "INSERT INTO service VALUES (1, 1, 'https', 'nginx', 'cpe:/a:nginx:nginx')",
    "INSERT INTO service VALUES (2, 2, 'https', 'apache', 'cpe:/a:apache:httpd')",
  ].join(';') + ';')
  const store = {
    db: () => db,
    listAssets: RedteamStore.prototype.listAssets,
    assetChildren: () => ({ ports: new Map(), names: new Map(), fingerprints: new Map() }),
    assetRow: (_db, row) => ({ id: row.id, ip: row.ip, primary_name: row.primary_name,
      ports: [], names: [], fingerprints: [] }),
  }
  const result = dispatch(store, { op: 'localAssetSearch', engagement: 'lab',
    query: 'domain="example.test" && port=443', limit: 10 })
  assert.equal(result.ok, true)
  assert.equal(result.engagement, 'lab')
  assert.equal(result.total, 1)
  assert.deepEqual(result.items.map((r) => r.id), [1])
  for (const query of ['', '   ', 'title="bad']) {
    const invalid = dispatch(store, { op: 'localAssetSearch', engagement: 'lab', query })
    assert.equal(invalid.ok, false)
  }
  const bad = dispatch(store, { op: 'localAssetSearch', engagement: 'lab', query: 'body="x"' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /本地库不含网页正文/)
})

test('source and embedded frontend both expose the offline asset search page', async () => {
  const { readFileSync } = await import('node:fs')
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const code = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    assert.match(code, /function LocalAssetSearchTab/)
    assert.match(code, /\['local-search', '测绘中心'\]/)
    assert.match(code, /op: 'localAssetSearch'/)
  }
  const tools = readFileSync(new URL('../lib/redteam/tools.js', import.meta.url), 'utf8')
  assert.match(tools, /name: 'redteam_local_asset_search'/)
})
