import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {thinkingTaskPrompt,scoreThinkingTask} from '../lib/workspace/thinking-experiment.js';

const root='D:\\dsh',exe=path.join(root,'DeepSeek Harness.exe');
const cli=path.join(root,'resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
const support=path.join(root,'resources/runtime');
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const profile='codex-review';
const runId='DS41-THINKING-CANDIDATE-20261116-01';
const temp=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'purge-thinking-candidate-'));
const marker=path.join(process.env.RUNNER_TEMP||os.tmpdir(),'purge-qa-'+runId+'.sent');
const probe=fileURLToPath(new URL('./runtime-observation-probe.mjs',import.meta.url));
const output=path.join(temp,'observer.json'),patch=path.join(temp,'overlay.json'),entry=path.join(temp,'entry.mjs');
const log=(stage,v)=>console.log(JSON.stringify({stage,...v}));
const safe=v=>typeof v==='string'&&/^[\w./:@+-]{1,120}$/.test(v)?v:null;
const num=v=>Number.isFinite(v)&&v>=0?v:null;
const collect=(v,out=[])=>{if(!v||typeof v!=='object')return out;if(typeof v.id==='string')out.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')collect(x,out);return out};
const pick=(rows,id)=>rows.find(r=>r.id===id);
const call=(args,timeout=30000)=>spawnSync(exe,['--expose-internals',entry,...args],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home},cwd:temp,encoding:'utf8',timeout,windowsHide:true,maxBuffer:32*1024*1024});
const exitSummary=r=>({exit:r.status,timeout:r.error?.code==='ETIMEDOUT',stderrBytes:Buffer.byteLength(r.stderr||'')});
let attempted=false;
try{
 if(!fs.existsSync(exe)||!fs.existsSync(cli)||!fs.existsSync(path.join(home,'profiles',profile,'cordis.yml'))){
  log('candidate-preflight',{status:'existing-cli-profile-unavailable'});process.exitCode=2;
 }else{
  const parse=createRequire(cli)('yaml').parse;
  fs.writeFileSync(entry,'import {runDesktopCli} from '+JSON.stringify(pathToFileURL(cli).href)+';\nawait runDesktopCli('+JSON.stringify(support)+');\n');
  const base=call(['--profile',profile,'--dump-config']);
  let rows=[];try{if(base.status===0)rows=collect(parse(base.stdout))}catch{}
  const model=pick(rows,'agent-default-model'),permission=pick(rows,'permission');
  const activePurge=rows.some(r=>r.disabled!==true&&(r.id==='dsh-purge'||r.id==='dsh-purge-redteam'||/^dsh-purge(?:\/|$)/.test(r.name||'')));
  const account=pick(rows,'deepseek-account');
  if(base.status!==0||!model||!account||account.disabled===true||activePurge||permission?.config?.defaultPreset!=='read-only'){
   log('candidate-preflight',{status:'existing-profile-not-suitable',...exitSummary(base),modelPresent:!!model,accountProviderPresent:!!account&&account.disabled!==true,activePurge,existingPermission:safe(permission?.config?.defaultPreset)});process.exitCode=2;
  }else{
   const overlay=[
    {id:'agent-default-model',config:{provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max'}},
    {insert:[{id:'purge-runtime-observation-probe',name:probe,config:{output}}]}
   ];
   fs.writeFileSync(patch,JSON.stringify(overlay));
   const effective=call(['--profile',profile,'--patch',patch,'--dump-config']);
   let merged=[];try{if(effective.status===0)merged=collect(parse(effective.stdout))}catch{}
   const m=pick(merged,'agent-default-model')?.config,p=pick(merged,'purge-runtime-observation-probe');
   const ready=effective.status===0&&m?.provider==='deepseek-account'&&m?.model==='deepseek-flash'&&m?.reasoningEffort==='max'&&p?.name===probe&&p?.config?.output===output&&pick(merged,'permission')?.config?.defaultPreset==='read-only';
   log('candidate-preflight',{status:ready?'ready':'overlay-not-confirmed',...exitSummary(effective),model:{provider:safe(m?.provider),model:safe(m?.model),reasoningEffort:safe(m?.reasoningEffort)},probeConfirmed:p?.name===probe,existingPermission:safe(pick(merged,'permission')?.config?.defaultPreset),profileConfigWritten:false});
   if(!ready)process.exitCode=2;
   else if(fs.existsSync(marker)){log('candidate-online',{status:'already-attempted-no-repeat'});process.exitCode=2}
   else{
    fs.closeSync(fs.openSync(marker,'wx'));attempted=true;
    const prompt='PURGE-QA-RUN: '+runId+'\n'+thinkingTaskPrompt('config','A');
    const run=call(['--profile',profile,'--patch',patch,'--json',prompt],90000);
    const entries=(run.stdout||'').split(/\r?\n/).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);
    const final=entries.findLast(e=>e.type==='final');
    let snap;try{snap=JSON.parse(fs.readFileSync(output,'utf8'))}catch{}
    const rows=Array.isArray(snap?.items)?snap.items:[];
    const evidence=rows.map(r=>({provider:safe(r.provider),model:safe(r.model),reasoningChunks:num(r.reasoningChunks),reasoningChars:num(r.reasoningChars),durableCompactReasoningChunks:num(r.durableCompactReasoningChunks),durableReasoningBlocks:num(r.durableReasoningBlocks),firstReasoningMs:num(r.firstReasoningMs),firstTextMs:num(r.firstTextMs),observedChunks:num(r.observedChunks),streamGap:r.streamGap===true,finish:safe(r.finish),settlement:safe(r.settlement),turnOutcome:safe(r.turnOutcome),totalTokens:num(r.usage?.totalTokens)}));
    const score=scoreThinkingTask('config',typeof final?.text==='string'?final.text:null);
    const complete=run.status===0&&score.correct===true&&evidence.length>0&&evidence.every(r=>r.provider==='deepseek-account'&&r.model==='deepseek-flash'&&r.reasoningChunks>0&&r.firstReasoningMs!==null&&!r.streamGap&&r.finish==='stop'&&r.settlement==='committed'&&r.turnOutcome==='completed');
    log('candidate-online',{status:complete?'passed':'not-verified',...exitSummary(run),attempted:true,finalReason:safe(final?.reason?.kind),errorCode:safe(final?.reason?.error?.code??final?.error?.code),score,streamSupport:safe(snap?.streamSupport),frames:snap?.frames?{start:num(snap.frames.start),chunk:num(snap.frames.chunk),end:num(snap.frames.end)}:null,evidence,scope:'candidate-observer-only-official-cli-existing-profile-not-full-desktop'});
    if(!complete)process.exitCode=3;
   }
  }
 }
}catch(e){log('candidate-failure',{attempted,errorType:safe(e?.name)});process.exitCode=2}
finally{fs.rmSync(temp,{recursive:true,force:true})}
