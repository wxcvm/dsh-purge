import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {thinkingTaskPrompt,scoreThinkingTask} from '../lib/workspace/thinking-experiment.js';
import {decodeArchive,archiveEvents,extractMarkedTurn} from './review-trace-import.mjs';

const [mode,group]=process.argv.slice(2);
if(!['A','B'].includes(group))throw new Error('invalid group');
const marker='PURGE-QA-RUN: DS41-THINKING-20261116-'+group+'-01';
if(mode==='--packet'){
  console.log(marker+'\n'+thinkingTaskPrompt('config',group));
}else if(mode==='--collect'){
  const root=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'sessions');
  const cutoff=Date.now()-15*60*1000;
  const folders=(dir,depth=0)=>{
    let list;try{list=fs.readdirSync(dir,{withFileTypes:true})}catch{return []}
    const out=[];
    for(const item of list){
      if(!item.isDirectory()||item.isSymbolicLink())continue;
      const child=path.join(dir,item.name);
      for(const name of ['session.v4.jsonl.zstd','session.v4.jsonl']){
        const f=path.join(child,name);
        try{const st=fs.lstatSync(f);if(st.isFile()&&!st.isSymbolicLink()&&st.mtimeMs>=cutoff){out.push(f);break}}catch{}
      }
      if(depth<1)out.push(...folders(child,depth+1));
    }
    return out;
  };
  const measure=(attempts,key)=>{const values=attempts.map(a=>a[key]).filter(v=>Number.isFinite(v)&&v>=0);return {sum:values.length?values.reduce((a,b)=>a+b,0):null,known:values.length,missing:attempts.length-values.length}};
  const label=v=>typeof v==='string'&&/^[\w./:@+-]{1,120}$/.test(v)?v:null;
  let latest=[];
  for(let i=0;i<30;i++){
    latest=[];
    for(const file of folders(root)){
      try{
        const records=decodeArchive(fs.readFileSync(file));
        const trace=extractMarkedTurn(records,marker);
        if(trace.parentRefs.length)continue;
        latest.push({records,trace});
      }catch{}
    }
    if(latest.length===1&&latest[0].trace.lifecycle!=='unknown')break;
    await delay(2500);
  }
  if(latest.length!==1){
    console.log(JSON.stringify({stage:'thinking-live-result',group,status:latest.length?'ambiguous':'not-found',candidateCount:latest.length}));process.exitCode=2;
  }else{
    const {records,trace}=latest[0];const {events}=archiveEvents(records);
    const end=events.find(e=>e.seq>trace.humanSeq&&e.type==='turn/end'&&e.data?.turn===trace.turn);
    const within=events.filter(e=>e.seq>trace.humanSeq&&(!end||e.seq<=end.seq));
    const responses=within.filter(e=>['assistant/message','assistant/attempt'].includes(e.type)&&e.data?.turn===trace.turn);
    const streams=responses.filter(e=>Array.isArray(e.data.stream)&&e.data.stream.length);
    let reasoningChunks=0,reasoningChars=0;
    for(const e of streams)for(const r of e.data.stream){const c=r?.chunk;if(c?.type==='reasoning-delta'&&typeof c.text==='string'&&c.text.length){reasoningChunks++;reasoningChars+=c.text.length}}
    const routes=within.filter(e=>e.type==='request/header').map(e=>{const c=e.data?.header?.config;return {provider:label(c?.provider),model:label(c?.model),reasoningEffort:label(c?.reasoningEffort)}});
    const result={stage:'thinking-live-result',group,status:trace.lifecycle,score:scoreThinkingTask('config',trace.finalText),elapsedMs:trace.elapsedMs,
      route:{provider:label(trace.route?.provider),model:label(trace.route?.model)},requestRoutes:[...new Set(routes.map(r=>JSON.stringify(r)))].map(JSON.parse),
      attempts:trace.attempts.length,totalTokens:measure(trace.attempts,'totalTokens'),reasoningTokens:measure(trace.attempts,'reasoningTokens'),toolStarts:measure(trace.attempts,'toolStarts'),
      childDescriptors:trace.childIds.length,durableStreamResponses:streams.length,reasoningChunks:streams.length?reasoningChunks:null,reasoningChars:streams.length?reasoningChars:null,
      scope:'native-desktop-archive-parent-only-not-live-hook-or-billing'};
    console.log(JSON.stringify(result));
    if(trace.lifecycle!=='completed')process.exitCode=2;
  }
}else throw new Error('invalid operation');
