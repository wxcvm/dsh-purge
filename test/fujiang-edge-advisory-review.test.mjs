import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCveCatalog } from '../lib/redteam/cve-knowledge.js'
import { getBundledKnowledge } from '../lib/redteam/knowledge-bundled.js'

const find = id => loadCveCatalog().find(row => row.cve.includes(id))

test('remaining edge advisories preserve source versions and reviewed guidance', () => {
  const expected = {
    'CVE-2018-13379': { versions: ['5.4.6', 'FortiProxy'] },
    'CVE-2019-11510': { versions: ['8.1R15.1', '9.0R3.4'] },
    'CVE-2020-5902': { versions: ['11.6.5.1', '11.6.5.2', '15.0.0'] },
    'CVE-2021-22986': { versions: ['12.1.5.3', '7.0.0.2', '7.1.0.3'] },
    'CVE-2023-35078': { source_versions: ['11.10.0.1', '11.9.0.1', '11.8.1.1'] },
    'CVE-2023-46805': { versions: ['9.1R18.3', '22.5R2.2', 'Policy Secure 22.5R1.1'] },
    'CVE-2024-24919': { versions: ['R77.20', 'R80.20SP', 'R81.10.x'] },
  }
  for (const [id, fields] of Object.entries(expected)) {
    const row = find(id)
    assert.ok(row, id)
    assert.equal(row.verified, false, id)
    assert.ok(row.version_reference.startsWith('https://'), id)
    assert.ok(row.source_versions, id)
    assert.ok(row.advisory_note, id)
    for (const term of fields.versions || []) assert.ok(row.versions.includes(term), id + ' ' + term)
    for (const term of fields.source_versions || []) assert.ok(row.source_versions.includes(term), id + ' ' + term)
  }
})

test('all edge-device knowledge records retain advisory references and stable document IDs', () => {
  const rows = loadCveCatalog().filter(row => row.category === 'edge-device')
  assert.equal(rows.length, 16)
  for (const row of rows) {
    assert.ok(row.version_reference, row.title)
    assert.ok(row.source_versions, row.title)
    assert.ok(row.advisory_note, row.title)
    const name = row.source_url.split('/').pop().replace('.md', '')
    const doc = getBundledKnowledge('fujiang:edge-device:' + name)
    assert.ok(doc, row.title)
    assert.ok(doc.body.includes(row.version_reference), row.title)
    assert.equal(doc.verified, false)
  }
})
