import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { redactCredentialText } from './report-shareable.js'

const OUTCOMES = new Set(['success','completed','failed','blocked','timeout','interrupted','no_findings','no_output','tool_missing','import_failed','previewed','inconclusive','ready','waiting','progress','dropped'])
const REVIEW_STATES = new Set(['validated','rejected'])

function cleanText(value, field, max, { optional = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(field + ' must be text')
  const raw = value.trim()
  if (!raw && !optional) throw new TypeError(field + ' is required')
  return redactCredentialText(raw).replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[host]')
    .replace(/(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.%]+/gi, value => isIP(value.split('%')[0]) === 6 ? '[host]' : value)
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}\b/gi, '[host]').slice(0, max)
}
function token(value, field, max) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw || raw.length > max || !/^[a-z0-9][a-z0-9:_/-]*$/.test(raw)) throw new TypeError(field + ' is invalid')
  return raw
}
function parseArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [] }
  catch { return [] }
}
function contextOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const key of ['environment_id','tool_id','binary_source','stop_reason','role','status']) {
    if (typeof value[key] === 'string' && value[key].trim()) out[key] = cleanText(value[key], key, 80)
  }
  for (const key of ['duration_ms','bytes','findings_count','asset_id','attempt','stages_count','blocked_count']) {
    const number = Number(value[key]); if (Number.isFinite(number) && number >= 0) out[key] = Math.trunc(number)
  }
  for (const key of ['attempted','report_present','dry_run']) if (typeof value[key] === 'boolean') out[key] = value[key]
  return out
}
function view(row) {
  if (!row) return null
  let context = {}; try { context = JSON.parse(row.context_json || '{}') } catch { /* malformed legacy row */ }
  return { id: row.id, task_type: row.task_type, outcome: row.outcome, subject_key: row.subject_key,
    summary: row.summary, lesson: row.lesson, source_tool: row.source_tool, engagement_ref: row.engagement_id || null,
    evidence_refs: parseArray(row.evidence_refs), context: context && typeof context === 'object' && !Array.isArray(context) ? context : {},
    confidence: Number(row.confidence) || 0, validation_status: row.validation_status,
    review_note: row.review_note || null, reviewed_at: row.reviewed_at || null,
    occurrences: Number(row.occurrences) || 1, created_at: row.created_at, updated_at: row.updated_at }
}

/** Privacy-reduced observations in the existing shared knowledge.db; recurrence never auto-validates. */
export function recordExperience(db, engagementId, input = {}) {
  const taskType = token(input.task_type, 'task_type', 64)
  const outcome = token(input.outcome, 'outcome', 32)
  if (!OUTCOMES.has(outcome)) throw new TypeError('outcome is invalid')
  const subjectKey = cleanText(input.subject_key || taskType, 'subject_key', 120)
  const summary = cleanText(input.summary, 'summary', 600)
  const lesson = cleanText(input.lesson, 'lesson', 600)
  const sourceTool = token(input.source_tool || 'unknown', 'source_tool', 80)
  const evidenceRef = cleanText(input.evidence_ref || '', 'evidence_ref', 180, { optional: true })
  const rawEngagement = String(engagementId || '').trim()
  const engagement = rawEngagement ? createHash('sha256').update(rawEngagement).digest('hex').slice(0, 16) : ''
  const context = contextOf(input.context)
  const fingerprint = createHash('sha256').update([taskType,outcome,subjectKey.toLowerCase(),lesson.toLowerCase(),
    context.environment_id || '',context.tool_id || ''].join('\u0000')).digest('hex')
  const now = new Date().toISOString()
  const sourceRef = (engagement || 'local') + '|' + (evidenceRef || sourceTool + '|' + now)
  const previous = db.prepare('SELECT id,evidence_refs,occurrences,confidence,validation_status FROM operation_experience WHERE fingerprint=?').get(fingerprint)
  if (previous) {
    const refs = parseArray(previous.evidence_refs)
    if (refs.includes(sourceRef)) return { recorded:false, duplicate:true, id:previous.id, occurrences:previous.occurrences,
      confidence:previous.confidence, validation_status:previous.validation_status }
    refs.push(sourceRef)
    const occurrences = (Number(previous.occurrences) || 1) + 1
    const confidence = previous.validation_status === 'validated' ? 1 : previous.validation_status === 'rejected' ? 0
      : Math.min(0.75, 0.25 + 0.05 * (occurrences - 1))
    db.prepare('UPDATE operation_experience SET evidence_refs=?,occurrences=?,confidence=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(refs.slice(-30)),occurrences,confidence,now,previous.id)
    return { recorded:true, duplicate:false, id:previous.id, occurrences, confidence, validation_status:previous.validation_status }
  }
  const result = db.prepare('INSERT INTO operation_experience (fingerprint,task_type,outcome,subject_key,summary,lesson,source_tool,engagement_id,evidence_refs,context_json,confidence,validation_status,occurrences,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(fingerprint,taskType,outcome,subjectKey,summary,lesson,sourceTool,engagement || null,JSON.stringify([sourceRef]),
      JSON.stringify(context),0.25,'candidate',1,now,now)
  return { recorded:true, duplicate:false, id:Number(result.lastInsertRowid), occurrences:1, confidence:0.25, validation_status:'candidate' }
}
export function searchExperiences(db, options = {}) {
  const where=[],params=[]
  if (options.include_rejected !== true) where.push("validation_status <> 'rejected'")
  const requestedTypes = Array.isArray(options.task_types) ? options.task_types : options.task_type ? [options.task_type] : []
  const taskTypes=[...new Set(requestedTypes.map(value=>token(value,'task_type',64)))]
  if (taskTypes.length) { where.push('task_type IN ('+taskTypes.map(()=>'?').join(',')+')'); params.push(...taskTypes) }
  if (typeof options.query==='string' && options.query.trim()) {
    const query=cleanText(options.query,'query',120).toLowerCase()
    where.push("lower(task_type || ' ' || subject_key || ' ' || summary || ' ' || lesson) LIKE ?"); params.push('%'+query+'%')
  }
  const clause=where.length?' WHERE '+where.join(' AND '):''
  const requested=Number(options.limit),limit=Number.isFinite(requested)&&requested>=1?Math.min(30,Math.trunc(requested)):8
  const total=db.prepare('SELECT COUNT(*) AS n FROM operation_experience'+clause).get(...params)?.n ?? 0
  const rows=db.prepare('SELECT * FROM operation_experience'+clause+
    " ORDER BY CASE validation_status WHEN 'validated' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,confidence DESC,occurrences DESC,updated_at DESC LIMIT ?").all(...params,limit)
  return { total, items:rows.map(view), note:'validated=已核验；candidate=待核验。候选经验只能作为线索，必须结合当前目标与证据重新判断。' }
}
export function reviewExperience(db, input = {}) {
  const id=Number(input.id)
  if (!Number.isSafeInteger(id)||id<1) throw new TypeError('experience id must be a positive integer')
  const status=token(input.status,'status',16)
  if (!REVIEW_STATES.has(status)) throw new TypeError('status must be validated or rejected')
  const note=cleanText(input.review_note,'review_note',500)
  const evidenceRef=cleanText(input.evidence_ref || '','evidence_ref',180,{optional:true})
  if (status==='validated'&&!evidenceRef) throw new TypeError('validated experience requires evidence_ref')
  const now=new Date().toISOString()
  const row=db.prepare('SELECT evidence_refs FROM operation_experience WHERE id=?').get(id)
  if (!row) return { updated:false, reason:'not-found' }
  const refs=parseArray(row.evidence_refs); if (evidenceRef) refs.push('review|'+evidenceRef)
  const result=db.prepare('UPDATE operation_experience SET validation_status=?,confidence=?,review_note=?,reviewed_at=?,evidence_refs=?,updated_at=? WHERE id=?')
    .run(status,status==='validated'?1:0,note,now,JSON.stringify([...new Set(refs)].slice(-30)),now,id)
  return { updated:result.changes===1, item:view(db.prepare('SELECT * FROM operation_experience WHERE id=?').get(id)) }
}
