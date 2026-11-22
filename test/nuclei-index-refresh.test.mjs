import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RedteamStore } from '../lib/redteam/store-core.js'

test('explicit nuclei index refresh discovers updates inside an existing nested YAML without network I/O', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-nuclei-index-'))
  const templates = join(root, 'toolkit', 'nuclei-templates')
  const nested = join(templates, 'http', 'cves')
  mkdirSync(nested, { recursive: true })
  const yaml = join(nested, 'example.yaml')
  writeFileSync(yaml, 'id: synthetic-fixture\ninfo:\n  name: Original Template\n  severity: info\n', 'utf8')
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })

  assert.equal(store.searchTemplates('Original Template').items.length, 1)
  const before = store.templateStats()
  assert.equal(before.total, 1)
  assert.equal(Object.hasOwn(before, 'reindexed'), false)
  const rootMtime = statSync(templates).mtimeMs

  // Updating a file in http/cves does not update the outer template root's mtime.
  writeFileSync(yaml, 'id: synthetic-fixture\ninfo:\n  name: Updated Template\n  severity: high\n', 'utf8')
  assert.equal(statSync(templates).mtimeMs, rootMtime)
  assert.equal(store.searchTemplates('Updated Template').items.length, 0, 'ordinary reads reuse cached index')
  const refresh = store.templateStats({ refresh: true })
  assert.equal(refresh.reindexed, true)
  assert.equal(refresh.total, 1)
  assert.equal(store.searchTemplates('Updated Template').items.length, 1)
  assert.equal(store.searchTemplates('Original Template').items.length, 0)
  const cache = JSON.parse(readFileSync(join(root, 'pocs', '.nuclei-index.json'), 'utf8'))
  assert.equal(cache.items.length, 1)
  assert.match(cache.items[0][1], /Updated Template/)
})

test('explicit refresh handles an isolated empty local templates directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-nuclei-empty-'))
  const templates = join(root, 'toolkit', 'nuclei-templates')
  mkdirSync(templates, { recursive: true })
  const store = new RedteamStore(root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  assert.deepEqual(store.templateStats({ refresh: true }), {
    dir: templates, total: 0, cve: 0, reindexed: true,
  })
})
