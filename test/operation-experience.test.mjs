import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { KNOWLEDGE_DDL } from '../lib/redteam/schema.js'
import { DDL, RedteamStore } from '../lib/redteam/store-core.js'
import { recordExperience, searchExperiences, reviewExperience } from '../lib/redteam/operation-experience.js'
import { taskContext } from '../lib/redteam/task-context.js'
import { captureAgentEndReport } from '../lib/redteam/agent-attention.js'
import { createWorkItem, assignWorkItem } from '../lib/redteam/agent-work-items.js'
import { createReservations } from '../lib/redteam/agent-reservations.js'
import { bindSession } from '../lib/redteam/session-bindings.js'

function memory(){const db=new DatabaseSync(':memory:');db.exec(KNOWLEDGE_DDL);db.exec(KNOWLEDGE_DDL);return db}
const lesson={task_type:'scan:nmap',outcome:'timeout',subject_key:'nmap',
  summary:'timeout at 192.0.2.9 2001:db8::1 https://private.example internal-node.lan password=NEVER_STORE',
  lesson:'先检查 internal-node.lan 与网络环境，再决定是否重试。',source_tool:'redteam_scan_run',
  evidence_ref:'scan:run-1',context:{environment_id:'wsl:Ubuntu-24.04',transport:'wsl',tool_id:'nmap',attempted:true}}

test('records positive and negative outcomes in the existing shared knowledge schema',()=>{
 const db=memory();try{
  const failed=recordExperience(db,'engagement-a',lesson)
  assert.equal(failed.recorded,true);assert.equal(failed.validation_status,'candidate');assert.equal(failed.confidence,0.25)
  const stored=db.prepare('SELECT summary,lesson,engagement_id,evidence_refs,context_json FROM operation_experience WHERE id=?').get(failed.id)
  const serialized=JSON.stringify(stored)
  assert.doesNotMatch(serialized,/192\.0\.2\.9|2001:db8::1|private\.example|internal-node\.lan|NEVER_STORE|engagement-a/)
  assert.match(stored.summary,/\[host\]|\[url\]/)
  assert.deepEqual(JSON.parse(stored.context_json), { environment_id: 'wsl:Ubuntu-24.04', transport: 'wsl', tool_id: 'nmap', attempted: true })
  const duplicate=recordExperience(db,'engagement-a',lesson)
  assert.equal(duplicate.recorded,false);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.occurrences,1)
  const repeated=recordExperience(db,'engagement-b',{...lesson,evidence_ref:'scan:run-2'})
  assert.equal(repeated.recorded,true);assert.equal(repeated.occurrences,2);assert.equal(repeated.validation_status,'candidate');assert.equal(repeated.confidence,0.3)
  const positive=recordExperience(db,'engagement-b',{...lesson,outcome:'completed',evidence_ref:'scan:run-3',summary:'scan imported 2 assets',lesson:'导入成功只说明扫描链路完成，不代表漏洞已验证。'})
  assert.equal(positive.recorded,true)
  const all=searchExperiences(db,{task_types:['scan:nmap'],limit:10})
  assert.equal(all.total,2);assert.ok(all.items.some(row=>row.outcome==='timeout'));assert.ok(all.items.some(row=>row.outcome==='completed'))
  assert.ok(all.items.every(row=>row.validation_status==='candidate'))
 }finally{db.close()}
})

test('deduplicates the same evidence and retains recurrence across runs',()=>{
 const db=memory();try{
  const first=recordExperience(db,'engagement-a',lesson)
  const sameRun=recordExperience(db,'engagement-a',lesson)
  const nextRun=recordExperience(db,'engagement-a',{...lesson,evidence_ref:'scan:run-2'})
  assert.equal(sameRun.duplicate,true);assert.equal(nextRun.occurrences,2)
  assert.equal(searchExperiences(db,{task_type:'scan:nmap'}).items[0].evidence_refs.length,2);assert.equal(first.id,nextRun.id)
 }finally{db.close()}
})

test('only explicit evidence review promotes or rejects a candidate',()=>{
 const db=memory();try{
  const first=recordExperience(db,'engagement-a',lesson)
  assert.throws(()=>reviewExperience(db,{id:first.id,status:'validated',review_note:'checked'}),/evidence_ref/)
  const validated=reviewExperience(db,{id:first.id,status:'validated',evidence_ref:'scan:run-1:manifest-verified',review_note:'核对原始 manifest 与输出摘要一致。'})
  assert.equal(validated.updated,true);assert.equal(validated.item.validation_status,'validated');assert.equal(validated.item.confidence,1)
  const rejected=recordExperience(db,'engagement-a',{...lesson,outcome:'failed',evidence_ref:'scan:run-4',summary:'tool exit failed',lesson:'检查工具依赖。'})
  assert.equal(reviewExperience(db,{id:rejected.id,status:'rejected',review_note:'原始记录证明这是参数输入错误，不是可复用经验。'}).item.validation_status,'rejected')
  const visible=searchExperiences(db,{task_type:'scan:nmap'})
  assert.deepEqual(visible.items.map(row=>row.id),[first.id]);assert.equal(searchExperiences(db,{task_type:'scan:nmap',include_rejected:true}).total,2)
 }finally{db.close()}
})

test('search prioritizes validated lessons and filters by task type and query',()=>{
 const db=memory();try{
  const candidate=recordExperience(db,'a',lesson)
  const validated=recordExperience(db,'b',{...lesson,evidence_ref:'scan:other',summary:'timeout case verified',lesson:'timeout 已核验，先检查网络与执行环境。'})
  reviewExperience(db,{id:validated.id,status:'validated',evidence_ref:'manifest:verified',review_note:'verified'})
  const result=searchExperiences(db,{task_types:['scan:nmap'],query:'timeout',limit:5})
  assert.equal(result.total,2);assert.equal(result.items[0].id,validated.id);assert.equal(result.items[1].id,candidate.id)
 }finally{db.close()}
})

test('task context returns cross-engagement lessons and distinguishes candidates',()=>{
 const asset={id:1,ip:'192.0.2.1',ports:[],fingerprints:[],test_notes:'',test_surface:''};let received
 const store={getAsset:()=>asset,listVulns:()=>({total:0,items:[],hasMore:false,nextOffset:0}),queryHttpEvidence:()=>({total:0,items:[]}),
  searchExperiences:options=>{received=options;return{total:1,items:[{id:7,outcome:'timeout',validation_status:'candidate'}]}}}
 const result=taskContext(store,'demo','asset #1')
 assert.deepEqual(received.task_types,['asset-test','scan:nmap','scan:httpx','agent-task'])
 assert.equal(result.operation_experiences.items[0].validation_status,'candidate')
 assert.match(result.operation_experiences.note,/candidate 仅为待核验线索/)
})

test('subagent end without redteamReport still records an inconclusive experience',()=>{
 const db=new DatabaseSync(':memory:');db.exec(DDL)
 const task=createWorkItem(db,{task_key:'review',role:'review',objective:'Review evidence'}).item
 assignWorkItem(db,{task_id:task.id,session_id:'child',run_id:'run-1'})
 const experiences=[]
 const store={db(){return db},recordAgentReport:RedteamStore.prototype.recordAgentReport,observeWorkItemEnd:RedteamStore.prototype.observeWorkItemEnd,
  recordExperience(engagement,input){experiences.push({engagement,input});return{recorded:true}}}
 try{
  bindSession(store,{agent:{session:{id:'root'}}},'demo',{persist:false})
  const event={id:'child',runId:'run-1',parentSessionId:'root',stopReason:'completed',lastAssistantMessage:[{type:'text',text:'finished without the structured marker'}]}
  assert.equal(captureAgentEndReport(store,createReservations(),event),null)
  assert.equal(experiences.length,1);assert.equal(experiences[0].engagement,'demo')
  assert.equal(experiences[0].input.outcome,'inconclusive');assert.match(experiences[0].input.lesson,/没有结构化回报/);assert.equal(experiences[0].input.summary,'子 Agent 终态：inconclusive');assert.doesNotMatch(experiences[0].input.summary,/finished without/)
 }finally{db.close()}
})
