import test from 'node:test'
import assert from 'node:assert/strict'

import { parseVersionAffected, withParsedConstraints } from '../lib/redteam/version-affected-parser.js'
import { matchCveCandidates, loadCveCatalog } from '../lib/redteam/cve-knowledge.js'

test('解析器：五种基础形态', () => {
  assert.deepEqual(parseVersionAffected('< 1.2.83'), [{ min: '0.0.0', max: '1.2.83', max_exclusive: true }])
  assert.deepEqual(parseVersionAffected('<=3.21.1'), [{ min: '0.0.0', max: '3.21.1' }])
  assert.deepEqual(parseVersionAffected('2.0-2.14.1'), [{ min: '2.0.0', max: '2.14.1' }])
  assert.deepEqual(parseVersionAffected('1.2.x'), [{ min: '1.2.0', max: '1.3.0', max_exclusive: true }])
  assert.deepEqual(parseVersionAffected('1.7.8'), [{ min: '1.7.8', max: '1.7.8' }])
  assert.deepEqual(parseVersionAffected('V11.8'), [{ min: '11.8.0', max: '11.8.0' }])
})

test('解析器：多段逗号列举与中文顿号', () => {
  assert.deepEqual(
    parseVersionAffected('9.4.40, 10.0.2, 11.0.2'),
    [{ min: '9.4.40', max: '9.4.40' }, { min: '10.0.2', max: '10.0.2' }, { min: '11.0.2', max: '11.0.2' }],
  )
  assert.deepEqual(parseVersionAffected('8.x、9.x'), [
    { min: '8.0.0', max: '9.0.0', max_exclusive: true },
    { min: '9.0.0', max: '10.0.0', max_exclusive: true },
  ])
})

test('解析器：全量/未知语义显式不解析（保守保 unknown）', () => {
  for (const text of ['all versions', '任意版本（配置相关）', '全系列', 'N/A', '未明确', '', null]) {
    assert.equal(parseVersionAffected(text), null, JSON.stringify(text))
  }
})

test('解析器：混杂文本只提取版本段', () => {
  // 产品名前缀 + 版本 → 提出版本段
  const r = parseVersionAffected('Kong Docker <= 2.0.3')
  assert.ok(Array.isArray(r) && r.length >= 1, '应提取出版本段')
})

test('withParsedConstraints：按全部 CVE 键挂约束', () => {
  const entry = { source_versions: '< 1.2.83' }
  const out = withParsedConstraints(entry, ['CVE-2022-25845', 'CVE-2022-25846'])
  assert.deepEqual(out.version_constraints['CVE-2022-25845'], [{ min: '0.0.0', max: '1.2.83', max_exclusive: true }])
  assert.deepEqual(out.version_constraints['CVE-2022-25846'], out.version_constraints['CVE-2022-25845'])
  // 不可解析时返回原条目（不添加空约束）
  const keep = withParsedConstraints({ source_versions: 'all versions' }, ['CVE-X'])
  assert.equal('version_constraints' in keep, false)
})

test('导入后统计：AS 条目约半数获得结构化约束', () => {
  const rows = loadCveCatalog()
  const as = rows.filter(r => r.advisory_status === 'community-indexed')
  const withC = as.filter(r => r.version_constraints)
  assert.ok(as.length >= 550, 'AS 条目基数: ' + as.length)
  assert.ok(withC.length >= 280, '带约束条目: ' + withC.length)
  // fujiang 条目的约束不应被触碰
  const fu = rows.filter(r => r.advisory_status !== 'community-indexed')
  const fuWith = fu.filter(r => r.version_constraints)
  assert.ok(fuWith.length >= 20, 'fujiang 约束仍在: ' + fuWith.length)
})

test('判定跃迁：AS 独有条目从 unknown → affected/not_affected', () => {
  // anythingllm CVE-2024-3104（fujiang 无此条目）：约束 [0.0.0, 1.0.0)
  const affected = matchCveCandidates({ cve: 'CVE-2024-3104', version: '0.27.0' })
  assert.equal(affected.items[0].version_applicability.status, 'affected')
  const notAffected = matchCveCandidates({ cve: 'CVE-2024-3104', version: '2.0.0' })
  assert.equal(notAffected.items[0].version_applicability.status, 'not_affected')
  // comfyui 精确版 3.38.0
  const exact = matchCveCandidates({ cve: 'CVE-2025-67303', version: '3.38.0' })
  assert.equal(exact.items[0].version_applicability.status, 'affected')
})

test('判定一致性：fastjson AS 条目与 fujiang 约束语义一致', () => {
  // fujiang: 1.2.83 之前（vendor-reviewed）；AS: < 1.2.83 —— 两个来源同判
  const low = matchCveCandidates({ cve: 'CVE-2022-25845', version: '1.2.82' })
  const asRow = low.items.find(x => x.advisory_status === 'community-indexed')
  assert.equal(asRow?.version_applicability?.status, 'affected', 'AS 条目 1.2.82 判 affected')
  const high = matchCveCandidates({ cve: 'CVE-2022-25845', version: '1.2.83' })
  const asHigh = high.items.find(x => x.advisory_status === 'community-indexed')
  assert.equal(asHigh?.version_applicability?.status, 'not_affected', 'AS 条目 1.2.83 判 not_affected')
})
