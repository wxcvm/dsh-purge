import test from 'node:test'
import assert from 'node:assert/strict'
import { documentCases, documentReviewPacket, scoreDocumentReview, scoreDocumentReviewText } from '../scripts/document-review-eval.mjs'

const reports = [
  {id:'invoice-posted',answer:'b',evidence:['ledger']},
  {id:'meeting-effective',answer:'a',evidence:['original','amendment','draft']},
  {id:'partial-returns',answer:'c',evidence:['scope','report','inspections']},
  {id:'refund-allocation',answer:'a',evidence:['selected','refund','mapping']},
  {id:'delivery-cutoff',answer:'b',evidence:['purchase','receipt1','receipt2','receipt3','cutoff']},
  {id:'approval-chain',answer:'c',evidence:['rule','current','program','finance','register']},
]
test('new office-record suite has two cases per difficulty and hides all answer keys',()=>{
  const packet=documentReviewPacket()
  assert.equal(packet.cases.length,6)
  assert.equal(new Set(packet.cases.map(c=>c.id)).size,6)
  for(const difficulty of ['basic','medium','complex']) assert.equal(packet.cases.filter(c=>c.difficulty===difficulty).length,2)
  for(const row of packet.cases) {assert.equal(Object.hasOwn(row,'answer'),false);assert.equal(Object.hasOwn(row,'required'),false)}
  assert.deepEqual(packet.cases,documentCases)
})
test('complete correct reports score across all difficulty strata',()=>{
  const out=scoreDocumentReview({reports})
  assert.deepEqual(out.summary,{total:6,answered:6,correctConclusions:6,requiredCoverage:6,exactEvidence:6,fullyCorrect:6})
  assert.equal(out.byDifficulty.complex.fullyCorrect,2)
  assert.equal(out.byDifficulty.basic.fullyCorrect,2)
})
test('missing cross-record support and extra valid records are distinct',()=>{
  const copy=structuredClone(reports)
  copy[2].evidence.push('note')
  copy[4].evidence=copy[4].evidence.filter(k=>k!=='receipt2')
  copy[5].evidence.push('register','PRIVATE-RAW-TEXT')
  const out=scoreDocumentReview({reports:copy})
  assert.equal(out.summary.correctConclusions,6)
  assert.equal(out.summary.requiredCoverage,5)
  assert.equal(out.summary.exactEvidence,3)
  assert.equal(out.byDifficulty.complex.requiredCoverage,1)
  assert.deepEqual(out.results[2].additional,['note'])
  assert.deepEqual(out.results[4].missing,['receipt2'])
  assert.equal(out.results[5].duplicateCount,1)
  assert.equal(out.results[5].invalidCount,1)
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE-RAW-TEXT/)
})
test('unanswered and incorrect conclusions do not get full credit',()=>{
  const copy=structuredClone(reports.slice(0,5))
  copy[0].answer='a'
  const out=scoreDocumentReview({reports:copy})
  assert.equal(out.summary.answered,5)
  assert.equal(out.summary.correctConclusions,4)
  assert.equal(out.summary.fullyCorrect,4)
  assert.equal(out.results[5].requiredCovered,null)
})
test('format diagnostics preserve content score but never accept ambiguous or duplicate reports',()=>{
  const json=JSON.stringify({reports})
  const fence=String.fromCharCode(96).repeat(3)
  const wrapped='Review complete.\n'+fence+'json\n'+json+'\n'+fence
  assert.equal(scoreDocumentReviewText(json).strict,true)
  const parsed=scoreDocumentReviewText(wrapped)
  assert.equal(parsed.strict,false)
  assert.equal(parsed.format,'json-fence-with-prose')
  assert.equal(parsed.score.summary.fullyCorrect,6)
  assert.equal(scoreDocumentReviewText(wrapped+'\n'+wrapped).score,null)
  assert.equal(scoreDocumentReviewText(JSON.stringify({reports:[reports[0],reports[0]]})).format,'invalid-report-identity')
  assert.equal(scoreDocumentReviewText(JSON.stringify({reports:[{id:'foreign',answer:'a',evidence:[]}]})).score,null)
  assert.equal(scoreDocumentReviewText('{"other":[]}').strict,false)
})
