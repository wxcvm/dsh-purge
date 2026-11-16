/** One-shot replay of the six observed fictional B-arm child reports.
 * No answer key in the packet; no live targets, external tools or new children.
 */
import { casePacket } from './agent-quality-eval.mjs'

const priorReports = [
  { id: 'records-vs-score', answer: 'b', evidence: ['before', 'after'] },
  { id: 'in-place-update', answer: 'a', evidence: ['before', 'after', 'edit'] },
  { id: 'reference-vs-proof', answer: 'a', evidence: ['reference', 'fingerprint', 'verification'] },
  { id: 'partial-summary', answer: 'c', evidence: ['coverage', 'notes'] },
  { id: 'unavailable-read', answer: 'c', evidence: ['read', 'catalog'] },
  { id: 'task-attribution', answer: 'b', evidence: ['delta', 'newRecord'] },
]
const packet = casePacket()
console.log('PURGE-QA-RUN: DS41-DESKTOP-20261116-REVIEW-01\n'
  + 'This is a fictional record-review experiment. The candidate reports below are the six previously observed child answers, not an answer key. Independently review each candidate against all original records. Decide the answer yourself, check whether every record required to justify the conclusion is present, remove redundant citations and correct any omission or mistake. Do not merely accept the candidate; do not delegate, call tools, read files or access external resources. Return exactly one bare JSON object with a reports array and no Markdown fences or extra text.\n'
  + JSON.stringify({ ...packet, candidateReports: priorReports }, null, 2))
