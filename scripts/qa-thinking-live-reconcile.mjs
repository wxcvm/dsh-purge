import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decodeArchive,archiveEvents,extractMarkedTurn} from './review-trace-import.mjs';
import {createRuntimeObservations,streamSummary} from '../lib/runtime-observations.js';
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const roots=path.join(home,'sessions');
const cutoff=Date.now()-24*60*60*1000;
const files=(dir,depth=0)=>{
  let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return []}
  const out=[];
  for(const item of entries){
    if(!item.isDirectory()||item.isSymbolicLink())continue;
    const child=path.join(dir,item.name);
    for(const name of ['session.v4.jsonl.zstd','session.v4.jsonl']){
      const f=path.join(child,name);
      try{const st=fs.lstatSync(f);if(st.isFile()&&!st.isSymbolicLink()&&st.mtimeMs>=cutoff){out.push(f);break}}catch{}
    }
    if(depth<1)out.push(...files(child,depth+1));
  }
  return out;
};
const matches={A:[],B:[]};
for(const f of files(roots)){
 let records;try{records=decodeArchive(fs.readFileSync(f))}catch{continue}
 for(const group of ['A','B']){
  try{
   const trace=extractMarkedTurn(records,'PURGE-QA-RUN: DS41-THINKING-20261116-'+group+'-01');
   if(!trace.parentRefs.length)matches[group].push({records,trace,sessionId:path.basename(path.dirname(f))});
  }catch{}
 }
}
let ports=[];try{ports=JSON.parse(process.env.QA_PORTS||'[]')}catch{}
if(!Array.isArray(ports))ports=[ports];
const endpoints=[];
for(const port of [...new Set(ports)].filter(p=>Number.isInteger(p)&&p>0&&p<65536).slice(0,20)){
 try{
  const url='http://127.0.0.1:'+port+'/dsh-purge/runtime-observations';
  const res=await fetch(url+'?limit=1',{signal:AbortSignal.timeout(1500),redirect:'error'});
  if(res.ok){const data=await res.json();if(data?.ok===true&&data.readOnly===true&&Array.isArray(data.items))endpoints.push(url)}
 }catch{}
}
const valid=v=>Number.isFinite(v)&&v>=0?v:null;
for(const group of ['A','B']){
 const arr=matches[group];
 if(arr.length!==1){console.log(JSON.stringify({stage:'marked-live-reconcile',group,status:arr.length?'ambiguous':'not-found'}));continue}
 const {records,trace,sessionId}=arr[0],{events}=archiveEvents(records);
 const end=events.find(e=>e.seq>trace.humanSeq&&e.type==='turn/end'&&e.data?.turn===trace.turn);
 const responses=events.filter(e=>e.seq>trace.humanSeq&&(!end||e.seq<=end.seq)&&['assistant/message','assistant/attempt'].includes(e.type)&&e.data?.turn===trace.turn);
 const runtime=[];
 for(const base of endpoints){
  try{
   const u=new URL(base);u.searchParams.set('sessionId',sessionId);u.searchParams.set('limit','200');
   const res=await fetch(u,{signal:AbortSignal.timeout(3000),redirect:'error'});
   if(!res.ok)continue;
   const snap=await res.json();
   if(snap?.ok!==true||!Array.isArray(snap.items))continue;
   const rows=snap.items.filter(r=>r.sessionId===sessionId&&r.turn===trace.turn);
   runtime.push({streamSupport:snap.streamSupport,rows:rows.map(r=>({step:r.step,seq:r.seq,observedChunks:valid(r.observedChunks),chunks:valid(r.chunks),firstTextMs:valid(r.firstTextMs),elapsedMs:valid(r.elapsedMs),streamGap:r.streamGap===true,streamEnded:r.streamEnded===true,finish:r.finish,settlement:r.settlement,turnOutcome:r.turnOutcome}))});
  }catch{}
 }
 // Candidate is exercised in an isolated in-memory observer using the genuine
 // archived assistant event; live start/end are fixture boundaries, not new model traffic.
 const candidate=[];
 for(const event of responses){
  const obs=createRuntimeObservations({now:()=>0});
  const agent={id:'qa',session:{id:'qa'}};
  const attemptId='qa:1';
  obs.frame({agent,frame:{type:'start',revision:1,attemptId,turn:event.data.turn,step:event.data.step}});
  obs.event(agent.session,event);
  const row=obs.snapshot().items[0];
  const summary=streamSummary(event.data.stream);
  candidate.push({step:event.data.step,seq:event.seq,archiveCompactReasoningChunks:summary.compactReasoningChunks,archiveCompactReasoningChars:summary.compactReasoningChars,
    archiveCompactTextChunks:summary.compactTextChunks,observerCompactReasoningChunks:row.durableCompactReasoningChunks,observerCompactReasoningChars:row.durableCompactReasoningChars,
    observerCompactTextChunks:row.durableCompactTextChunks,observerReasoningBlocks:row.durableReasoningBlocks,firstReasoningMs:row.firstReasoningMs,
    firstTextMs:row.firstTextMs,liveReasoningChunks:row.reasoningChunks,invalidBatches:row.durableCompactInvalidRecords});
  obs.dispose();
 }
 console.log(JSON.stringify({stage:'marked-live-reconcile',group,status:trace.lifecycle,endpointCount:endpoints.length,runtime,candidate,scope:'existing-live-metadata-vs-actual-archive-candidate-ingest-no-new-model'}));
}
const root='D:\\dsh\\resources\\app\\dsh\\node_modules\\@deepseek-ai';
for(const [file,term] of [['dsh-agent-loop/lib/index.js','agent/assistant-stream'],['dsh-llm/lib/types/assistant-stream.js','reasoning-chunks']]){
 try{
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const lines=source.split(/\r?\n/),i=lines.findIndex(l=>l.includes(term));
  // Installed package source only; no config or transcript. Report limited lines.
  if(i>=0)console.log(JSON.stringify({stage:'official-stream-contract',file,line:i+1,source:lines.slice(Math.max(0,i-8),i+15).join('\n')}));
 }catch{}
}
