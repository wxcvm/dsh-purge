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


test('audited support preserves D/E historical metrics and distinguishes explicit contrast from sufficient proof',()=>{
  // Sets reconstructed from the completed D and E run scoring diagnostics.
  const d=structuredClone(reports)
  d[0].evidence.push('reminder')
  d[3].evidence=['refund','mapping','totals']
  const e=structuredClone(reports)
  e[1].evidence=['original','amendment']
  e[3].evidence=['refund','mapping']
  e[4].evidence=['purchase','receipt1','receipt3','cutoff']
  const before=scoreDocumentReview({reports:d}), after=scoreDocumentReview({reports:e})
  assert.equal(before.summary.requiredCoverage,5)
  assert.equal(before.summary.exactEvidence,4)
  assert.equal(after.summary.requiredCoverage,3)
  assert.equal(after.summary.exactEvidence,3)
  assert.deepEqual(before.auditedRubric.summary,{total:6,supportCovered:6,supportedConclusions:6,minimalSupportMatch:0,
    contrastCases:5,contrastCovered:5,unrelatedReferenceCount:0})
  assert.deepEqual(after.auditedRubric.summary,{total:6,supportCovered:6,supportedConclusions:6,minimalSupportMatch:4,
    contrastCases:5,contrastCovered:1,unrelatedReferenceCount:0})
  assert.deepEqual(after.results[1].audit.missingSupport,[])
  assert.deepEqual(after.results[1].audit.missingContrast,['draft'])
  assert.deepEqual(after.results[3].audit.missingSupport,[])
  assert.deepEqual(after.results[4].audit.missingContrast,['receipt2'])
  assert.equal(after.auditedRubric.byDifficulty.complex.supportedConclusions,2)
})
test('audited sufficient sets still reject genuine missing support and wrong conclusions',()=>{
  const copy=structuredClone(reports)
  copy[1].evidence=['original','draft']
  copy[3].evidence=['refund','totals','selected']
  copy[4].evidence=['purchase','receipt1','receipt3','receipt2']
  copy[5].answer='a'
  const out=scoreDocumentReview({reports:copy})
  assert.equal(out.auditedRubric.summary.supportCovered,3)
  assert.equal(out.auditedRubric.summary.supportedConclusions,2)
  assert.deepEqual(out.results[1].audit.missingSupport,['amendment'])
  assert.deepEqual(out.results[3].audit.missingSupport,['mapping'])
  assert.deepEqual(out.results[4].audit.missingSupport,['cutoff'])
  assert.equal(out.results[5].audit.supportedConclusion,false)
})
test('context is not a mandatory citation; unrelated, invalid and duplicate references remain visible',()=>{
  const copy=structuredClone(reports)
  copy[0].evidence=['ledger','memo','ledger','PRIVATE']
  copy[2].evidence=['scope','report']
  copy[5].evidence=['rule','current','register']
  const out=scoreDocumentReview({reports:copy})
  assert.equal(out.results[0].audit.supportCovered,true)
  assert.equal(out.results[0].audit.minimalSupportMatch,false)
  assert.deepEqual(out.results[0].audit.unrelated,['memo'])
  assert.equal(out.results[0].invalidCount,1)
  assert.equal(out.results[0].duplicateCount,1)
  assert.equal(out.results[2].audit.minimalSupportMatch,true)
  assert.equal(out.results[5].audit.minimalSupportMatch,true)
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE/)
  const packet=JSON.stringify(documentReviewPacket())
  assert.doesNotMatch(packet,/auditedRubric|rationale|missingSupport/)
})
