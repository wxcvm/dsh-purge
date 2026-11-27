import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('asset graph includes aliases, services, fingerprints and stored relations without raw evidence', t => {
  const home = mkdtempSync(join(tmpdir(), 'purge-asset-graph-'))
  const store = new RedteamStore(home)
  t.after(() => {
    store.close()
    rmSync(home, { recursive: true, force: true })
  })
  const { id } = store.openEngagement('asset-graph-fixture', [], { bindCurrent: false })
  store.importBundle(id, {
    scan: { tool: 'graph-fixture', argv: [] },
    assets: [
      {
        ip: '192.0.2.10', state: 'live', provenance: 'passive', tool: 'graph-fixture',
        primary_name: 'app.example.test',
        names: [
          { name: 'app.example.test', kind: 'domain', provenance: 'passive', tool: 'fixture-ct' },
          { name: 'shared.example.test', kind: 'domain', provenance: 'passive', tool: 'fixture-ct' },
        ],
        ports: [{
          port: 443, proto: 'tcp', state: 'open', service: 'https',
          product: 'nginx', version: '1.24',
          fingerprints: [{
            category: 'web', vendor: 'nginx', product: 'nginx', version: '1.24',
            evidence: 'private-graph-evidence-marker', confidence: 0.9,
            provenance: 'passive', tool: 'graph-fixture',
          }],
        }],
      },
      {
        ip: '198.51.100.11', state: 'live', provenance: 'passive', tool: 'graph-fixture',
        primary_name: 'api.example.test',
        names: [
          { name: 'api.example.test', kind: 'domain', provenance: 'passive', tool: 'fixture-ct' },
          { name: 'shared.example.test', kind: 'domain', provenance: 'passive', tool: 'fixture-ct' },
        ],
      },
    ],
  })
  const db = store.db(id)
  const first = db.prepare("SELECT id FROM asset WHERE ip = '192.0.2.10'").get()
  const second = db.prepare("SELECT id FROM asset WHERE ip = '198.51.100.11'").get()
  store.importBundle(id, {
    edges: [{
      src_kind: 'asset', src_id: String(first.id),
      dst_kind: 'asset', dst_id: String(second.id),
      relation: 'shares_cert', confidence: 0.8,
    }],
  })

  const graph = store.graph(id)
  const node = key => graph.nodes.find(item => item.id === key)
  assert.equal(node('name:shared.example.test').kind, 'domain')
  assert.equal(graph.nodes.filter(item => item.id === 'name:shared.example.test').length, 1)
  assert.ok(node('service:1'))
  assert.equal(node('service:1').meta.product, 'nginx')
  assert.ok(node('fingerprint:1'))
  assert.equal(node('fingerprint:1').meta.confidence, 0.9)
  assert.equal(JSON.stringify(graph).includes('private-graph-evidence-marker'), false)
  assert.ok(graph.edges.some(edge => edge.source === 'name:shared.example.test'
    && edge.target === 'asset:' + first.id && edge.relation === 'resolves'))
  assert.ok(graph.edges.some(edge => edge.source === 'name:shared.example.test'
    && edge.target === 'asset:' + second.id && edge.relation === 'resolves'))
  assert.ok(graph.edges.some(edge => edge.source === 'port:1'
    && edge.target === 'service:1' && edge.relation === 'identified_as'))
  assert.ok(graph.edges.some(edge => edge.source === 'port:1'
    && edge.target === 'fingerprint:1' && edge.relation === 'fingerprinted_as'))
  assert.ok(graph.edges.some(edge => edge.source === 'asset:' + first.id
    && edge.target === 'asset:' + second.id && edge.relation === 'shares_cert'))

  const scoped = store.graph(id, { cidr: '192.0.2.0/24' })
  assert.ok(scoped.nodes.some(item => item.id === 'asset:' + first.id))
  assert.equal(scoped.nodes.some(item => item.id === 'asset:' + second.id), false)
  assert.equal(scoped.edges.some(edge => edge.relation === 'shares_cert'), false)
})
