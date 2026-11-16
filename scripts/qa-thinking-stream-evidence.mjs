import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decodeArchive,archiveEvents,extractMarkedTurn} from './review-trace-import.mjs';

const root=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'sessions');
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
const safeType=v=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/.test(v)?v:'unknown';
const num=v=>Number.isFinite(v)&&v>=0?v:null;
const add=(o,k)=>{k=safeType(k);o[k]=(o[k]||0)+1};
const marker=g=>'PURGE-QA-RUN: DS41-THINKING-20261116-'+g+'-01';
const matches={A:[],B:[]};
for(const f of files(root)){
  let records;try{records=decodeArchive(fs.readFileSync(f))}catch{continue}
  for(const g of ['A','B']){
    try{
      const trace=extractMarkedTurn(records,marker(g));
      if(!trace.parentRefs.length)matches[g].push({records,trace,sessionId:path.basename(path.dirname(f))});
    }catch{}
  }
}
for(const g of ['A','B']){
  if(matches[g].length!==1){
    console.log(JSON.stringify({stage:'stream-evidence',group:g,status:matches[g].length?'ambiguous':'not-found'}));continue;
  }
  const {records,trace,sessionId}=matches[g][0],{events}=archiveEvents(records);
  const end=events.find(e=>e.seq>trace.humanSeq&&e.type==='turn/end'&&e.data?.turn===trace.turn);
  const within=events.filter(e=>e.seq>trace.humanSeq&&(!end||e.seq<=end.seq));
  const responses=within.filter(e=>['assistant/message','assistant/attempt'].includes(e.type)&&e.data?.turn===trace.turn);
  const durable={responses:responses.length,streamRecords:0,chunkTypes:{},blockTypes:{},messageBlockTypes:{},reasoningDeltaText:0,reasoningDeltaOther:0,reasoningBlockText:0,reasoningBlockRawText:0,unrecognizedRecordShapes:[]};
  for(const e of responses){
    for(const r of Array.isArray(e.data?.stream)?e.data.stream:[]){
      durable.streamRecords++;const c=r?.chunk;add(durable.chunkTypes,c?.type);
      if(safeType(c?.type)==='unknown'){
        const keys=v=>v&&typeof v==='object'?Object.keys(v).filter(k=>/^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/.test(k)).sort():[];
        const shape={recordKeys:keys(r),recordType:safeType(r?.type),chunkKeys:keys(c),chunkType:safeType(c?.type),dataKeys:keys(r?.data),deltaKeys:keys(r?.delta),textsIsArray:Array.isArray(r?.texts),textsCount:Array.isArray(r?.texts)?r.texts.length:null,nonemptyTextCount:Array.isArray(r?.texts)?r.texts.filter(t=>typeof t==='string'&&t.length).length:null,textChars:Array.isArray(r?.texts)?r.texts.reduce((sum,t)=>sum+(typeof t==='string'?t.length:0),0):null};
        if(durable.unrecognizedRecordShapes.length<8)durable.unrecognizedRecordShapes.push(shape);
      }
      if(c?.type==='block-start'||c?.type==='block-end')add(durable.blockTypes,c.blockType);
      if(c?.type==='reasoning-delta'){
        if(typeof c.text==='string'&&c.text.length)durable.reasoningDeltaText++;
        else durable.reasoningDeltaOther++;
      }
    }
    for(const b of Array.isArray(e.data?.message?.content)?e.data.message.content:[]){
      add(durable.messageBlockTypes,b?.type);
      if(b?.type==='reasoning'){
        if(typeof b.text==='string'&&b.text.length)durable.reasoningBlockText++;
        if(typeof b.rawText==='string'&&b.rawText.length)durable.reasoningBlockRawText++;
      }
    }
  }
  let live={status:'unavailable'};
  try{
    const u=new URL('http://127.0.0.1:43120/dsh-purge/runtime-observations');
    u.searchParams.set('sessionId',sessionId);u.searchParams.set('limit','200');
    const res=await fetch(u,{signal:AbortSignal.timeout(4000),redirect:'error'});
    if(!res.ok)live={status:'http-'+res.status};
    else{
      const snap=await res.json();
      if(snap?.ok!==true||!Array.isArray(snap.items))live={status:'invalid-response'};
      else{
        const rows=snap.items.filter(r=>r.sessionId===sessionId&&r.turn===trace.turn);
        live={status:rows.length?'observed':'no-matching-rows',streamSupport:snap.streamSupport==='observed'?'observed':'not-observed',rows:rows.map(r=>({
          chunks:num(r.chunks),observedChunks:num(r.observedChunks),streamGap:r.streamGap===true,firstTextMs:num(r.firstTextMs),
          elapsedMs:num(r.elapsedMs),reasoningChunks:num(r.reasoningChunks),reasoningChars:num(r.reasoningChars),firstReasoningMs:num(r.firstReasoningMs),
          reasoningFieldsPresent:Object.hasOwn(r,'reasoningChunks'),durableTextObserved:r.durableTextObserved===true
        }))};
      }
    }
  }catch{}
  console.log(JSON.stringify({stage:'stream-evidence',group:g,status:trace.lifecycle,durable,live}));
}
