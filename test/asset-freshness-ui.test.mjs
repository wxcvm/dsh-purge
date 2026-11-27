import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = [
  '../lib/redteam/client.js',
  '../client.js',
]

test('asset freshness overview and detail view are wired into source and embedded client', () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /op: 'assetFreshness'/)
    assert.match(source, /view === 'freshness'/)
    assert.match(source, /数据新鲜度/)
    assert.match(source, /最近观察/)
    assert.match(source, /freshnessState\.summary/)
    assert.match(source, /不代表实时在线/)
    assert.match(source, /freshnessSourceFilter/)
    assert.match(source, /freshnessVerificationFilter/)
    assert.match(source, /全部新鲜度/)
    assert.match(source, /全部来源/)
    assert.match(source, /setFocusAssetId\(it\.id\)/)
  }
})
