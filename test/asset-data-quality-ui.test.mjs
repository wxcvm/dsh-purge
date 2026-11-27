import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('asset data quality view is read-only and renders bounded metadata previews', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /op: 'dataQuality'/)
    assert.match(source, /view === 'quality'/)
    assert.match(source, /重复服务预览/)
    assert.match(source, /重复指纹预览/)
    assert.match(source, /孤儿关联预览/)
    assert.match(source, /不包含原始指纹证据/)
    assert.match(source, /不提供自动清理/)
  }
})
