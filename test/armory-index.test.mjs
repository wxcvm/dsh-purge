import test from 'node:test'
import assert from 'node:assert/strict'

import { loadPayloadIndex, loadDictionaryIndex, searchPayloads, searchDictionaries, armoryStats } from '../lib/redteam/armory-index.js'

test('武器库索引生成物齐全且带来源', () => {
  const stats = armoryStats()
  assert.ok(stats.payload_groups >= 15, 'payload 组数: ' + stats.payload_groups)
  assert.ok(stats.payload_files >= 60, 'payload 文件数: ' + stats.payload_files)
  assert.ok(stats.dictionary_groups >= 60, '字典组数: ' + stats.dictionary_groups)
  assert.ok(stats.dictionary_files >= 200, '字典文件数: ' + stats.dictionary_files)
  assert.equal(stats.source, 'https://github.com/wgpsec/AboutSecurity')
})

test('payload 索引：每个文件有路径、行数与用途', () => {
  const data = loadPayloadIndex()
  for (const group of data.groups) {
    assert.ok(group.category)
    for (const file of group.files) {
      assert.ok(file.name)
      assert.match(file.path, /^Payload\//)
      assert.equal(typeof file.lines, 'number')
      assert.ok(file.lines > 0)
    }
  }
})

test('字典索引：路径合法且非空', () => {
  const data = loadDictionaryIndex()
  for (const group of data.groups) {
    for (const file of group.files) {
      assert.match(file.path, /^Dic\//)
      assert.ok(file.lines === null || file.lines > 0)
    }
  }
})

test('按场景检索：SQL盲注 / XSS / 子域名 / 403绕过', () => {
  const blind = searchPayloads('盲注', { limit: 5 })
  assert.ok(blind.items.some((x) => /blind/i.test(x.name)), '盲注 payload 应命中')
  const xss = searchPayloads('xss', { limit: 5 })
  assert.ok(xss.items.length >= 3, 'XSS 多载体应命中多个')
  const sub = searchDictionaries('子域名', { limit: 5 })
  assert.ok(sub.items.some((x) => /dns|subdomain/i.test(x.name)), '子域名字典应命中')
  const xff = searchPayloads('403', { limit: 5 })
  assert.ok(xff.items.some((x) => /xff|access/i.test(x.name + x.group)), '403 绕过应命中')
})

test('空查询列出全部；limit 收敛', () => {
  const all = searchPayloads('', { limit: 5 })
  assert.equal(all.count, 5)
  assert.ok(all.total >= 60)
  const one = searchDictionaries('redis', { limit: 1 })
  assert.equal(one.items.length, 1)
})

test('索引不复制文件内容，只含元数据', () => {
  const data = loadPayloadIndex()
  for (const group of data.groups.slice(0, 5)) {
    for (const file of group.files) {
      assert.ok(!('content' in file), '索引条目不应含 content 字段')
      assert.ok(!('body' in file), '索引条目不应含 body 字段')
    }
  }
})

test('随包 CVE 索引扩充后仍满足现有匹配链路', async () => {
  const { loadCveCatalog } = await import('../lib/redteam/cve-knowledge.js')
  const entries = loadCveCatalog()
  assert.ok(entries.length >= 700, '导入 AboutSecurity 后应 700+：' + entries.length)
  // fujiang 的 vendor-reviewed 条目仍在（版本边界未被动过）
  const grafana = entries.find((row) => row.cve.includes('CVE-2021-43798'))
  assert.equal(grafana.product, 'Grafana')
  for (const fixed of ['8.0.7', '8.1.8', '8.2.7', '8.3.1']) assert.ok(grafana.versions.includes(fixed + ' 之前'))
  // AboutSecurity 新条目有独立来源
  const asEntries = entries.filter((row) => row.source_url.includes('wgpsec'))
  assert.ok(asEntries.length >= 500, 'AS 导入条目应 500+：' + asEntries.length)
  for (const row of asEntries) {
    assert.equal(row.verified, false)
    assert.equal(row.advisory_status, 'community-indexed')
  }
})

test('AboutSecurity payload and dictionary indexes are pinned to the same commit and have unique safe paths', () => {
  const payload = loadPayloadIndex(), dictionaries = loadDictionaryIndex()
  assert.match(payload.source_commit, /^[0-9a-f]{40}$/)
  assert.equal(payload.source_commit, dictionaries.source_commit)
  for (const [data, prefix] of [[payload, 'Payload/'], [dictionaries, 'Dic/']]) {
    const seen = new Set()
    for (const group of data.groups) for (const file of group.files) {
      assert.ok(file.path.startsWith(prefix))
      assert.ok(!file.path.includes('..') && !file.path.includes('\\') && !file.path.startsWith('/'))
      assert.equal(seen.has(file.path), false, file.path)
      seen.add(file.path)
    }
  }
})

test('community-indexed CVE source links use the declared immutable revision', async () => {
  const { loadCveCatalog } = await import('../lib/redteam/cve-knowledge.js')
  const entries = loadCveCatalog().filter(row => row.source_url.includes('wgpsec/AboutSecurity'))
  assert.ok(entries.length >= 500)
  for (const row of entries) {
    assert.match(row.source_commit, /^[0-9a-f]{40}$/)
    assert.ok(row.source_url.includes('/blob/' + row.source_commit + '/'), row.source_url)
    assert.equal(row.verified, false)
  }
})
