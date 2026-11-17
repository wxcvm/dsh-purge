export const MAX_INPUT_BYTES = 128 * 1024;
const statuses = new Set(['todo','doing','done','blocked']);
const keys = new Set(['id','title','status','summary','updatedAt']);
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const bidi = /[\u202a-\u202e\u2066-\u2069]/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const utcPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u;
function fail(message) { throw new Error(message); }
function plain(v) { return v!==null && typeof v==='object' && !Array.isArray(v); }
function field(value, limit, multiline=false) {
  return typeof value==='string' && value.trim().length>0 && value.length<=limit &&
    !controls.test(value) && !bidi.test(value) && (multiline || !value.includes('\n'));
}
function validDate(value) {
  if(typeof value!=='string' || !utcPattern.test(value))return false;
  const parsed=new Date(value);
  if(!Number.isFinite(+parsed))return false;
  return parsed.toISOString()===(value.length===20?value.replace(/Z$/u,'.000Z'):value);
}
export function parseRecords(input) {
  if(typeof input!=='string' || Buffer.byteLength(input)>MAX_INPUT_BYTES)fail('Expected JSON text up to 128 KiB');
  let data;
  try { data=JSON.parse(input); } catch { fail('Invalid JSON'); }
  if(!plain(data) || Object.keys(data).length!==2 || !Object.hasOwn(data,'schemaVersion') ||
    data.schemaVersion!==1 || !Array.isArray(data.records) || data.records.length>100)
    fail('Expected schemaVersion 1 and up to 100 records');
  const seen=new Set();
  const records=data.records.map((r,i)=>{
    const at='Record '+(i+1);
    if(!plain(r) || Object.keys(r).some(k=>!keys.has(k)))fail(at+': invalid or unknown fields');
    if(typeof r.id!=='string' || !idPattern.test(r.id))fail(at+': invalid id');
    if(seen.has(r.id.toLowerCase()))fail(at+': duplicate id');
    seen.add(r.id.toLowerCase());
    if(!field(r.title,160))fail(at+': invalid title');
    if(!statuses.has(r.status))fail(at+': invalid status');
    if(!validDate(r.updatedAt))fail(at+': invalid UTC updatedAt');
    const summary=r.summary;
    if(summary!==undefined && summary!=='' && !field(summary,1200,true))fail(at+': invalid summary');
    return {id:r.id,title:r.title,status:r.status,summary:summary??'',updatedAt:new Date(r.updatedAt).toISOString()};
  });
  return {schemaVersion:1,records};
}
export function validateRecords(input) {
  const {records}=parseRecords(input);
  const counts={todo:0,doing:0,done:0,blocked:0};
  for(const {status} of records)counts[status]++;
  return {ok:true,count:records.length,counts};
}
export function replayRecords(input) {
  const {records}=parseRecords(input);
  return records.map((r,index)=>({r,index})).sort((a,b)=>
    Date.parse(a.r.updatedAt)-Date.parse(b.r.updatedAt) || a.index-b.index
  ).map(({r})=>r);
}
// Resume only explicit records. Status is not inferred from conversation text,
// and recorded "done" is not independent verification of task completion.
export function resumeRecords(input, coordination) {
  const {records}=parseRecords(input);
  const pending=records.filter(r=>r.status==='doing'||r.status==='todo');
  const blocked=records.filter(r=>r.status==='blocked');
  const done=records.filter(r=>r.status==='done');
  const current=pending.filter(r=>r.status==='doing');
  const todo=pending.filter(r=>r.status==='todo');
  return {
    schemaVersion:1,
    counts:{todo:todo.length,doing:current.length,done:done.length,blocked:blocked.length},
    current, todo, blocked, done,
    ...(coordination === undefined ? {} : { delegation: delegationView(records, coordination) }),
    interpretation:'explicit-recorded-progress-not-execution-or-verification',
  };
}
// Join only explicit task IDs to a caller-supplied redteam_agent_slot status
// snapshot. It is an advisory view, not a task-state transition or proof of work.
function delegationView(records, coordination) {
  if (!plain(coordination)) fail('Expected explicit coordination status object')
  const active = new Map((Array.isArray(coordination.reservations) ? coordination.reservations : [])
    .filter(row => typeof row?.key === 'string').map(row => [row.key, row]))
  const ended = new Map((Array.isArray(coordination.handoffs) ? coordination.handoffs : [])
    .filter(row => typeof row?.key === 'string').map(row => [row.key, row]))
  const tasks = records.map(record => {
    const reservation = active.get(record.id), handoff = ended.get(record.id)
    let state = 'no-linked-evidence'
    if (reservation) state = record.status === 'done' ? 'recorded-done-with-active-run'
      : reservation.runId == null ? 'reserved' : 'delegated'
    else if (record.status === 'done') state = 'recorded-done'
    else if (handoff) state = handoff.stopReason === 'completed' && handoff.finalMessage === 'present'
      ? 'needs-verification' : 'needs-attention'
    return { id: record.id, recordedStatus: record.status, state,
      ...(handoff && !reservation ? { stopReason: handoff.stopReason, finalMessage: handoff.finalMessage } : {}) }
  })
  return { tasks, counts: Object.fromEntries([...new Set(tasks.map(row => row.state))].map(
    state => [state, tasks.filter(row => row.state === state).length])),
    interpretation: 'caller-supplied-key-join-only-never-auto-completes-tasks-or-proves-parent-delivery' }
}
function literalBlock(text) {
  // Fences always longer than any supplied tilde run. No interpolation or live links.
  const len=Math.max(3,1+Math.max(0,...(text.match(/~+/gu)??[]).map(x=>x.length)));
  const fence='~'.repeat(len);
  return fence+'\n'+text+'\n'+fence;
}
export function renderReport(input, format) {
  const data=parseRecords(input);
  if(format==='json')return JSON.stringify(data,null,2)+'\n';
  if(format!=='markdown')fail('Format must be markdown or json');
  return '# 本地维护记录\n\n记录数：'+data.records.length+'\n\n'+data.records.map(r=>
    '## '+r.id+'\n\n'+literalBlock('标题：'+r.title+'\n状态：'+r.status+'\n时间：'+r.updatedAt+'\n摘要：'+r.summary)
  ).join('\n\n')+'\n';
}
