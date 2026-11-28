import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BASELINE_PATH,
  compareWithBaseline,
  measure,
  readBaseline,
  scanSkills,
} from '../scripts/check-upstream-capability.mjs'

test('内置技能不低于能力基线（删命令/删参数表会在这里红）', () => {
  const baseline = readBaseline()
  assert.ok(baseline, 'capability-baseline.json 必须存在')
  const violations = compareWithBaseline(scanSkills(), baseline)
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2))
})

test('能力基线钉住当前上游修订，防止悄悄换基准', () => {
  const baseline = readBaseline()
  const current = scanSkills()
  assert.equal(baseline.upstream.revision, current.revision)
  assert.match(baseline.upstream.revision, /^[a-f0-9]{40}$/)
  assert.equal(baseline.upstream.version, 'v2.0.2')
})

test('基线覆盖 40 条技能，且重点技能保留命令块与参数表', () => {
  const baseline = readBaseline()
  const rows = baseline.skills
  assert.equal(Object.keys(rows).length, 40)
  for (const local of ['netspy-recon.md', 'host-post-exploit.md', 'c2-infra.md', 'asset-deep-scan.md']) {
    assert.ok(rows[local], local + ' 必须在基线里')
    assert.ok(rows[local].codeBlocks >= 1, local + ' 至少要有一个命令块')
  }
  assert.ok(rows['netspy-recon.md'].tableRows >= 5, 'netspy 参数纪律表必须保留')
})

test('检删能力：把命令块删掉会被判定为回退', () => {
  const baseline = readBaseline()
  const current = scanSkills()
  const target = 'netspy-recon.md'
  const degraded = JSON.parse(JSON.stringify(current))
  const body = 'netspy-recon\n\n只有一句叙述，没有命令。\n'
  degraded.rows[target] = measure(body)
  const violations = compareWithBaseline(degraded, baseline)
  assert.ok(violations.some((v) => v.local === target && v.metric === 'codeBlocks'))
  assert.equal(BASELINE_PATH.endsWith('capability-baseline.json'), true)
})
