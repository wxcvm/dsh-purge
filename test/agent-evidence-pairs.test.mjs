import test from 'node:test'
import assert from 'node:assert/strict'
import { cases, casePacket, evaluatePairs } from '../scripts/agent-evidence-pairs.mjs'
const expected = ['unverified','verified','unverified','verified','unverified','contradicted','unverified','verified']
const correct = () => cases.map((c,i) => ({ id:c.id, lifecycle:i<6?'completed':'aborted', outcome:expected[i], evidence:['goal','lifecycle','check'] }))
test('eight cases, four pairs, no expected results in packet', () => {
  assert.equal(cases.length,8)
  assert.equal(new Set(cases.map(c=>c.pair)).size,4)
  assert.equal(new Set(cases.map(c=>c.id)).size,8)
  assert.ok(casePacket().cases.every(c=>!Object.hasOwn(c,'expected')))
})
test('all correct reports pass and each pair requires both variants', () => {
  const r=evaluatePairs(correct())
  assert.equal(r.summary.passed,8); assert.equal(r.summary.pairsPassed,4)
  const partial=evaluatePairs(correct().slice(0,1))
  assert.equal(partial.summary.passed,1); assert.equal(partial.summary.pairsPassed,0)
})
test('completed is not equivalent to verified; aborted is not equivalent to unverified', () => {
  const r=evaluatePairs(correct().map(x=>({...x,outcome:x.lifecycle==='completed'?'verified':'unverified'})))
  assert.equal(r.summary.lifecycleCorrect,8); assert.equal(r.summary.passed,3); assert.equal(r.summary.pairsPassed,0)
})
test('always unverified cannot pass any pair', () => {
  const r=evaluatePairs(correct().map(x=>({...x,outcome:'unverified'})))
  assert.equal(r.summary.passed,4); assert.equal(r.summary.pairsPassed,0)
})
test('missing, duplicate and invented evidence cannot pass', () => {
  for(const evidence of [[],['goal','lifecycle'],['goal','lifecycle','check','check'],['goal','lifecycle','check','invented']]) {
    assert.equal(evaluatePairs([{...correct()[0],evidence}]).summary.passed,0)
  }
  assert.throws(()=>evaluatePairs([correct()[0],correct()[0]]),/Duplicate/)
  assert.throws(()=>evaluatePairs([{id:'unknown'}]),/Unknown/)
})
test('unknown lifecycle is not a correct result when host observed a terminal', () => {
  const r=evaluatePairs([{...correct()[0],lifecycle:'unknown'}]); assert.equal(r.summary.outcomeCorrect,1); assert.equal(r.summary.passed,0)
})
