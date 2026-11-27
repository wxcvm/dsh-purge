/** Independent fictional office-record benchmark. No network, model calls,
 * production data, or task execution. Difficulty labels are designed strata,
 * not empirically calibrated model difficulty.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const fixture = [
  { id:'invoice-posted', difficulty:'basic',
    question:'Is invoice I-204 still unpaid at the end of June 12?',
    records:{ ledger:'June 12 16:00: invoice I-204 payment posted in full; outstanding balance 0.',
      reminder:'June 11: an unpaid-invoice reminder was sent.', memo:'Customer account opened May 3.' },
    options:{ a:'Yes, the reminder proves it remains unpaid.', b:'No, the posted ledger shows it is fully paid.', c:'The current balance cannot be determined.' },
    answer:'b', required:['ledger'] },
  { id:'meeting-effective', difficulty:'basic',
    question:'When does the approved meeting now start?',
    records:{ original:'June 1 approved schedule: meeting M-8 starts at 09:00 on June 20.',
      amendment:'June 3 approved amendment for M-8: replace its start time with 10:30; all other details unchanged.',
      draft:'June 4 unapproved suggestion: move M-8 to 14:00.' },
    options:{ a:'10:30 on June 20.', b:'14:00 on June 20.', c:'09:00 on June 20.' },
    answer:'a', required:['original','amendment','draft'] },
  { id:'partial-returns', difficulty:'medium',
    question:'Does the returned-items report establish that every return was inspected?',
    records:{ scope:'The complete May return register contains 18 distinct items.',
      report:'The export includes the first 12 items only.',
      inspections:'All 12 items in this export have completed inspection.',
      note:'The warehouse opens at 08:00.' },
    options:{ a:'Yes, all 18 were inspected.', b:'No, the other six definitely failed inspection.', c:'No, the other six are outside the observed export and their inspection status is unknown.' },
    answer:'c', required:['scope','report','inspections'] },
  { id:'refund-allocation', difficulty:'medium',
    question:'Was refund R-19 issued against the selected order O-31?',
    records:{ selected:'The requested review concerns order O-31 and its original invoice I-31.',
      refund:'Refund R-19 was issued for 42.00 on June 8, reference I-47.',
      mapping:'Invoice I-47 belongs to order O-47; invoice I-31 belongs to O-31.',
      totals:'Daily refunds rose by 42.00 on June 8.',
      email:'A draft email mentions that O-31 may request a refund.' },
    options:{ a:'No, R-19 is linked to O-47, not O-31.', b:'Yes, the daily increase establishes a refund for O-31.', c:'No refunds were issued.' },
    answer:'a', required:['selected','refund','mapping'] },
  { id:'delivery-cutoff', difficulty:'complex',
    question:'At the June 30 close, does the file establish that purchase P-8 was delivered in full?',
    records:{ purchase:'P-8 ordered 10 units of item Q, all due by June 30.',
      receipt1:'June 28 accepted receipt G-1: 6 units of Q for P-8.',
      receipt2:'June 30 accepted receipt G-2: 4 units of Q for P-9.',
      receipt3:'July 1 accepted receipt G-3: 4 units of Q for P-8.',
      cutoff:'The June closing report includes receipts accepted through June 30 only; no other receipts exist for P-8 in that period.',
      dashboard:'A July 2 dashboard shows 10 units received for P-8.' },
    options:{ a:'Yes, G-1 and G-2 total 10 units.', b:'No, only six units qualify for P-8 at the cutoff; July receipt G-3 is outside the period.', c:'No units of Q were delivered for P-8.' },
    answer:'b', required:['purchase','receipt1','receipt2','receipt3','cutoff'] },
  { id:'approval-chain', difficulty:'complex',
    question:'At 17:00 on August 9, is the revised grant G-6 authorized for disbursement?',
    records:{ rule:'A grant revision above 5,000 requires both program and finance approval of the same revision before disbursement.',
      current:'G-6 revision 3 requests 6,000 and supersedes revision 2.',
      program:'August 9 10:00: program approved G-6 revision 3.',
      finance:'August 9 11:00: finance approved G-6 revision 2 only.',
      register:'As of August 9 17:00, no finance approval for revision 3 is recorded; the approval register is complete.',
      chat:'August 9 15:00: a colleague says the payment should be ready soon.' },
    options:{ a:'Yes, any two approvals for G-6 suffice.', b:'No, neither department has approved any revision.', c:'No, revision 3 still lacks its required finance approval.' },
    answer:'c', required:['rule','current','program','finance','register'] },
]
const strata = ['basic','medium','complex']
const byId = new Map(fixture.map(row => [row.id,row]))
export const documentCases = fixture.map(({ answer, required, ...row }) => row)

export function documentReviewPacket() {
  return { instruction:'Review the six fictional office-record cases using only their supplied records. For each answer, cite the smallest complete set of record keys needed to justify the selected option and exclude distractors. Return exactly one bare JSON object with a reports array; each report has id, answer (a/b/c), and evidence (record keys). No tools or external resources.',
    cases:documentCases, format:{reports:[{id:'<case id>',answer:'<a/b/c>',evidence:['<record key>']}]} }
}

/**
 * Audited rubric v2, separate from the original exact-key rubric.
 * Each support set is a human-authored sufficient record set for the stated
 * correct option, taking the question and option text as given. Contrast keys
 * cover a named misleading alternative; citing them is not itself an
 * explanation of why it fails. Context is relevant but not necessary.
 * No claim of a general semantic verifier or exhaustive alternative proofs.
 */
const auditedRubric = {
  'invoice-posted': {
    support:['ledger'], contrast:['reminder'], context:[],
    rationale:'The posted balance settles current payment status; the earlier reminder is contrast evidence.',
  },
  'meeting-effective': {
    support:['original','amendment'], contrast:['draft'], context:[],
    rationale:'The original date and approved amendment establish the new time; an unapproved draft need not be cited.',
  },
  'partial-returns': {
    support:['scope','report'], contrast:[], context:['inspections'],
    rationale:'The total register and partial export establish that six items are outside observed coverage. Inspection of the exported twelve is corroborating context.',
  },
  'refund-allocation': {
    support:['refund','mapping'], contrast:['totals'], context:['selected','email'],
    rationale:'The question identifies O-31. Refund invoice I-47 and its order mapping establish the attribution; aggregate totals do not prove order attribution.',
  },
  'delivery-cutoff': {
    support:['purchase','receipt1','receipt3','cutoff'], contrast:['receipt2'], context:['dashboard'],
    rationale:'The order quantity, qualifying receipt, complete cutoff and July receipt establish the selected option, including its explicit July exclusion. Receipt2 explicitly addresses the other-order distractor.',
  },
  'approval-chain': {
    support:['rule','current','register'], contrast:['finance'], context:['program','chat'],
    rationale:'The approval rule, current revision and complete register establish the missing finance approval. Finance approval of an older revision is contrast evidence.',
  },
}

function auditedEvidence(id, observed, answered, conclusionCorrect, invalidCount, duplicateCount) {
  const {support,contrast,context,rationale}=auditedRubric[id]
  if(!answered) return {supportCovered:null,supportedConclusion:false,minimalSupportMatch:null,
    missingSupport:null,contrastApplicable:contrast.length>0,contrastCovered:null,missingContrast:null,
    citedContext:null,unrelated:null,rationale}
  const missingSupport=support.filter(key=>!observed.includes(key))
  const missingContrast=contrast.filter(key=>!observed.includes(key))
  const supportCovered=missingSupport.length===0
  const related=new Set([...support,...contrast,...context])
  return {supportCovered,supportedConclusion:conclusionCorrect && supportCovered,
    minimalSupportMatch:supportCovered && observed.length===support.length && !invalidCount && !duplicateCount,
    missingSupport,contrastApplicable:contrast.length>0,
    contrastCovered:contrast.length?missingContrast.length===0:null,missingContrast,
    citedContext:context.filter(key=>observed.includes(key)),
    unrelated:observed.filter(key=>!related.has(key)),rationale}
}

function auditedSummary(rows) {
  const count=key=>rows.filter(row=>row.audit[key]===true).length
  return {total:rows.length, supportCovered:count('supportCovered'), supportedConclusions:count('supportedConclusion'),
    minimalSupportMatch:count('minimalSupportMatch'), contrastCases:count('contrastApplicable'),
    contrastCovered:count('contrastCovered'), unrelatedReferenceCount:rows.reduce((n,row)=>n+(row.audit.unrelated?.length??0),0)}
}

function summary(rows) {
  const count = key => rows.filter(row => row[key] === true).length
  return { total:rows.length, answered:count('answered'), correctConclusions:count('conclusionCorrect'),
    requiredCoverage:count('requiredCovered'), exactEvidence:count('exactEvidence'), fullyCorrect:count('fullyCorrect') }
}

export function scoreDocumentReview({ reports } = {}) {
  if (!Array.isArray(reports)) throw new TypeError('Expected reports array')
  const input = new Map()
  for (const row of reports) {
    if (!byId.has(row?.id) || input.has(row.id)) throw new Error('Unknown or duplicate case ID')
    input.set(row.id,row)
  }
  const results = fixture.map(({id,difficulty,answer,required,records}) => {
    const row = input.get(id)
    const answered = ['a','b','c'].includes(row?.answer) && Array.isArray(row?.evidence)
    if (!answered) return {id,difficulty,answered:false,conclusionCorrect:null,requiredCovered:null,exactEvidence:null,
      fullyCorrect:false,missing:null,additional:null,invalidCount:null,duplicateCount:null,
      audit:auditedEvidence(id,[],false,false,null,null)}
    const valid = row.evidence.filter(key => typeof key === 'string' && Object.hasOwn(records,key))
    const observed = [...new Set(valid)]
    const missing = required.filter(key => !observed.includes(key))
    const additional = observed.filter(key => !required.includes(key))
    const invalidCount = row.evidence.length-valid.length, duplicateCount = valid.length-observed.length
    const conclusionCorrect = row.answer === answer, requiredCovered = missing.length === 0
    const exactEvidence = requiredCovered && !additional.length && !invalidCount && !duplicateCount
    return {id,difficulty,answered,conclusionCorrect,requiredCovered,exactEvidence,
      fullyCorrect:conclusionCorrect && exactEvidence,missing,additional,invalidCount,duplicateCount,
      audit:auditedEvidence(id,observed,true,conclusionCorrect,invalidCount,duplicateCount)}
  })
  return {summary:summary(results), byDifficulty:Object.fromEntries(strata.map(d=>[d,summary(results.filter(r=>r.difficulty===d))])),
    auditedRubric:{version:'office-record-support-v2',scope:'authored sufficient sets for this fixed fixture; not general semantic verification',
      summary:auditedSummary(results),byDifficulty:Object.fromEntries(strata.map(d=>[d,auditedSummary(results.filter(r=>r.difficulty===d))]))},results}
}

/** Strict format and substantive content are independent observations. */
export function scoreDocumentReviewText(raw) {
  if (typeof raw !== 'string') throw new TypeError('Expected response text')
  const text = raw.trim()
  let packet, format = 'strict-json'
  try { packet=JSON.parse(text) } catch {
    const fence=String.fromCharCode(96).repeat(3)
    const blocks=[...text.matchAll(new RegExp(fence+'(?:json)?[\\t ]*\\r?\\n([\\s\\S]*?)\\r?\\n'+fence,'gi'))]
    if (blocks.length!==1) return {format:blocks.length>1?'ambiguous-fences':'unrecognized',strict:false,score:null}
    try {packet=JSON.parse(blocks[0][1])} catch {return {format:'unrecognized',strict:false,score:null}}
    format=blocks[0][0]===text?'single-json-fence':'json-fence-with-prose'
  }
  if (!Array.isArray(packet?.reports)) return {format:'invalid-report-shape',strict:false,score:null}
  try {return {format,strict:format==='strict-json',score:scoreDocumentReview(packet)}}
  catch {return {format:'invalid-report-identity',strict:false,score:null}}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (process.argv[2]==='--cases') console.log(JSON.stringify(documentReviewPacket(),null,2))
  else if (process.argv[2]==='--score' && process.argv[3]) console.log(JSON.stringify(scoreDocumentReviewText(readFileSync(process.argv[3],'utf8')),null,2))
  else {console.error('Usage: node scripts/document-review-eval.mjs --cases | --score response.txt');process.exitCode=1}
}
