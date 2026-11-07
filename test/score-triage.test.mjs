import test from 'node:test'
import assert from 'node:assert/strict'
import { isUntestedLiveAsset, reviewScoring } from '../lib/redteam/score-triage.js'

const rules = [
  { code: 'server-host', re: /服务器权限|命令执行成功/i },
  { code: 'db-credential', re: /数据库权限|数据库凭据/i },
]
const points = (hits) => ({
  items: [
    { code: 'server-host', points: 50, enabled: true, hits },
    { code: 'db-credential', points: 50, enabled: true, hits: [] },
  ],
})
const vuln = (id, extra = {}) => ({
  id, status: 'confirmed', title: '服务问题', gained: '服务器权限', evidence: '执行结果已记录',
  ...extra,
})
test('待测判定使用 test_status，不把已测试/放弃的资产重新派活', () => {
  assert.equal(isUntestedLiveAsset({ state: 'live', test_status: 'untested' }), true)
  assert.equal(isUntestedLiveAsset({ state: 'live' }), true)
  for (const status of ['tested', 'testing', 'blocked', 'abandoned', 'no_surface']) {
    assert.equal(isUntestedLiveAsset({ state: 'live', test_status: status }), false)
  }
  assert.equal(isUntestedLiveAsset({ state: 'dead', test_status: 'untested' }), false)
})
test('同一个得分 code 在另一个漏洞命中，不能标记本漏洞已得分', () => {
  const result = reviewScoring([vuln(1), vuln(2)], points([{
    id: 4, vuln_id: 1, capped: false, self_created: false,
  }]), rules)
  assert.equal(result.suggestions[0].suggest[0].recorded, true)
  assert.equal(result.suggestions[0].suggest[0].counted, true)
  assert.equal(result.suggestions[1].suggest[0].recorded, false)
  assert.equal(result.suggestions[1].suggest[0].elsewhere_recorded, true)
  assert.equal(result.suggestions[1].status, 'review-ready')
})
test('漏洞标题/组件名称不能冒充权限成果', () => {
  const r = reviewScoring([vuln(5, {
    title: 'MySQL 弱口令风险', gained: '', evidence: '探测结果',
  })], points([]), rules)
  assert.equal(r.suggestions.length, 0)
  assert.equal(r.followup[0].status, 'no-outcome')
})
test('缺证据、被封顶、自建账号不得标记为有效得分', () => {
  const rows = [
    vuln(1, { evidence: '', http_evidence: [] }),
    vuln(2),
    vuln(3),
  ]
  const r = reviewScoring(rows, points([
    { id: 9, vuln_id: 2, capped: true, self_created: false },
    { id: 10, vuln_id: 3, capped: false, self_created: true },
  ]), rules)
  assert.equal(r.needs_evidence, 1)
  assert.equal(r.recorded_not_counted, 2)
  assert.equal(r.counted, 0)
  assert.equal(r.suggestions[1].suggest[0].recorded, true)
  assert.equal(r.suggestions[1].suggest[0].counted, false)
})
test('原始 HTTP 证据存在时可列入待复核，但不会自动加分', () => {
  const r = reviewScoring([vuln(7, {
    evidence: '', http_evidence: [{ request: 'GET / HTTP/1.1' }],
  })], points([]), rules)
  assert.equal(r.review_ready, 1)
  assert.equal(r.counted, 0)
})
