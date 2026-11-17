import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, definitions } from './index.mjs';
import { parseRecords, validateRecords, renderReport, replayRecords, resumeRecords } from './records.mjs';
import { listTemplates, getTemplate } from './catalog.mjs';

const row={id:'B-01',title:'合成记录',status:'done',summary:'示例',updatedAt:'2026-11-04T10:00:00Z'};
const make=(...records)=>JSON.stringify({schemaVersion:1,records});
test('validate records and normalize timestamp',()=>{
  assert.deepEqual(validateRecords(make(row)),{ok:true,count:1,counts:{todo:0,doing:0,done:1,blocked:0}});
  assert.equal(parseRecords(make(row)).records[0].updatedAt,'2026-11-04T10:00:00.000Z');
});
test('reject ambiguous roots, schema changes and malformed JSON',()=>{
  for(const input of ['{','[]','{}','{"schemaVersion":2,"records":[]}','{"schemaVersion":1,"records":[],"other":true}']){
    assert.throws(()=>parseRecords(input));
  }
});
test('reject duplicate ids and unknown fields',()=>{
  assert.throws(()=>parseRecords(make(row,{...row,id:'b-01'})),/duplicate id/u);
  assert.throws(()=>parseRecords(make({...row,command:'sample'})),/unknown fields/u);
  assert.throws(()=>parseRecords('{"schemaVersion":1,"records":[{"__proto__":{}}]}'),/unknown fields/u);
});
test('reject invalid dates and states, including normalized rollover',()=>{
  for(const updatedAt of ['2026-11-31T10:00:00Z','2026-11-04T10:00:00+08:00','2026-11-04T24:00:00Z']){
    assert.throws(()=>parseRecords(make({...row,updatedAt})),/invalid UTC/u);
  }
  assert.throws(()=>parseRecords(make({...row,status:'unknown'})),/invalid status/u);
});
test('bounded inputs and forbidden control characters',()=>{
  assert.throws(()=>parseRecords('中'.repeat(50000)),/128 KiB/u);
  assert.throws(()=>parseRecords(make(...Array.from({length:101},(_,n)=>({...row,id:String(n)})))),/100 records/u);
  assert.throws(()=>parseRecords(make({...row,title:'x\u001by'})),/invalid title/u);
  assert.throws(()=>parseRecords(make({...row,summary:'y\u202ex'})),/invalid summary/u);
});
test('markdown makes active syntax literal even when the text contains fences',()=>{
  const md=renderReport(make({...row,title:'<script>example</script>',summary:'first\n~~~~~~\n[example](https://example.invalid)'}),'markdown');
  assert.match(md,/\n~~~~~~~\n标题：<script>example<\/script>/u);
  assert.match(md,/\n~~~~~~\n\[example\]\(https:\/\/example.invalid\)\n~~~~~~~\n/u);
  assert.equal(JSON.parse(renderReport(make(row),'json')).records[0].title,'合成记录');
  assert.throws(()=>renderReport(make(row),'html'),/Format/u);
});
test('replay is deterministic, stable for tied timestamps, and returns data only',()=>{
  const x=replayRecords(make(row,{...row,id:'early',updatedAt:'2026-11-04T09:00:00Z',summary:'echo example'},{...row,id:'tied'}));
  assert.deepEqual(x.map(r=>r.id),['early','B-01','tied']);
  assert.equal(x[0].summary,'echo example');
});
test('catalog returns copies of static templates',()=>{
  const list=listTemplates(); assert.equal(list.length,6);
  const a=getTemplate('patch');a.title='改写';
  assert.equal(getTemplate('patch').title,'最小补丁');
  assert.throws(()=>getTemplate('nonexistent'),/Unknown template/u);
});
function fixture(failAt=Infinity) {
  const entries=new Map(), disposers=[];
  let calls=0;
  const ctx={
    tools:{
      get:k=>entries.get(k),
      register(d){
        if(++calls===failAt)throw new Error('fixture registration failure');
        entries.set(d.name,d);
        return ()=>entries.delete(d.name);
      }
    },
    effect(fn){disposers.push(fn());}
  };
  return {ctx,entries,disposers};
}
test('registers only four tools; lifecycle disposal leaves unrelated tools',()=>{
  const f=fixture();f.entries.set('unrelated',{});
  apply(f.ctx);assert.equal(f.entries.size,5);
  f.disposers[0]();assert.deepEqual([...f.entries.keys()],['unrelated']);
});
test('collision is rejected before any registry change',()=>{
  const f=fixture(), key=definitions()[2].name;f.entries.set(key,{existing:true});
  assert.throws(()=>apply(f.ctx),/already registered/u);
  assert.deepEqual([...f.entries.entries()],[[key,{existing:true}]]);
});
test('registration failure rolls back successful earlier registrations',()=>{
  const f=fixture(3);assert.throws(()=>apply(f.ctx),/fixture registration failure/u);
  assert.equal(f.entries.size,0);
});

test('resume view preserves explicit ongoing, todo, blocked and done work across replay', async()=>{
  const json=make(
    {...row,id:'done-1',status:'done'},
    {...row,id:'todo-1',status:'todo',title:'待复核'},
    {...row,id:'blocked-1',status:'blocked',summary:'等待用户提供样本'},
    {...row,id:'doing-1',status:'doing',summary:'已完成第一步'},
    {...row,id:'todo-2',status:'todo'},
    {...row,id:'doing-2',status:'doing'},
  );
  const result=resumeRecords(json);
  assert.deepEqual(result.counts,{todo:2,doing:2,done:1,blocked:1});
  assert.deepEqual(result.current.map(r=>r.id),['doing-1','doing-2']);
  assert.deepEqual(result.todo.map(r=>r.id),['todo-1','todo-2']);
  assert.deepEqual(result.blocked.map(r=>r.id),['blocked-1']);
  assert.deepEqual(result.done.map(r=>r.id),['done-1']);
  assert.equal(result.current[0].summary,'已完成第一步');
  const tool=definitions().find(d=>d.name==='maintenance_replay_records');
  const replay=JSON.parse((await tool.execute({json})).text);
  assert.deepEqual(replay.resume,result);
  assert.equal(replay.records.length,6);
  assert.equal(resumeRecords(make()).current.length,0);
});

test('resume does not invent completion or choose a task when nothing is ready',()=>{
  const data=resumeRecords(make({...row,status:'blocked'}));
  assert.deepEqual(data.current,[]);
  assert.deepEqual(data.todo,[]);
  assert.deepEqual(data.done,[]);
  assert.equal(data.blocked.length,1);
  assert.throws(()=>resumeRecords(make({...row,status:'unknown'})),/invalid status/);
});

test('explicit task keys join active and ended subagent evidence without changing statuses', async () => {
  const json = make(
    {...row,id:'task-done',status:'done'},
    {...row,id:'task-review',status:'doing'},
    {...row,id:'task-error',status:'todo'},
    {...row,id:'task-active',status:'doing'},
    {...row,id:'task-pending',status:'todo'},
    {...row,id:'task-unknown',status:'blocked'},
  )
  const coordination = { reservations: [
    { key:'task-active',runId:'run-7',state:'assigned' },
    { key:'task-pending',runId:null,state:'pending' },
  ], handoffs: [
    { key:'task-review',stopReason:'completed',finalMessage:'present' },
    { key:'task-error',stopReason:'error',finalMessage:'empty' },
    { key:'foreign-task',stopReason:'completed',finalMessage:'present' },
  ] }
  const before=JSON.parse(json)
  const view=resumeRecords(json,coordination)
  const statuses=Object.fromEntries(view.delegation.tasks.map(x=>[x.id,x.state]))
  assert.deepEqual(statuses,{
    'task-done':'recorded-done',
    'task-review':'needs-verification',
    'task-error':'needs-attention',
    'task-active':'delegated',
    'task-pending':'reserved',
    'task-unknown':'no-linked-evidence',
  })
  assert.equal(view.counts.done,1)
  assert.equal(view.counts.doing,2)
  assert.equal(view.delegation.tasks.find(x=>x.id==='task-review').recordedStatus,'doing')
  assert.deepEqual(JSON.parse(json),before)
  const result=JSON.parse((await definitions()[2].execute({json,coordination:JSON.stringify(coordination)})).text)
  assert.deepEqual(result.resume,view)
  assert.equal(result.records.length,6)
  assert.equal(resumeRecords(json).delegation,undefined)
})

test('retry reservation supersedes stale handoff and completed child does not imply task done',()=>{
  const json=make({...row,id:'retry',status:'doing'})
  const old={reservations:[],handoffs:[{key:'retry',stopReason:'completed',finalMessage:'present'}]}
  const newer={reservations:[{key:'retry',runId:'second-run'}],handoffs:old.handoffs}
  assert.equal(resumeRecords(json,old).delegation.tasks[0].state,'needs-verification')
  assert.equal(resumeRecords(json,newer).delegation.tasks[0].state,'delegated')
  assert.equal(resumeRecords(json,newer).current[0].status,'doing')
  assert.throws(()=>resumeRecords(json,[]),/coordination status object/)
})
