import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('asset evidence graph view is CIDR-scoped and renders stored relationships only', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /op: 'graph'/)
    assert.match(source, /maxNodes: 300/)
    assert.match(source, /view === 'graph'/)
    assert.match(source, /关系图谱/)
    assert.match(source, /identified_as/)
    assert.match(source, /fingerprinted_as/)
    assert.match(source, /先从左侧选择一个 C 段/)
    assert.match(source, /不会发起扫描或网络请求/)
  }
})
