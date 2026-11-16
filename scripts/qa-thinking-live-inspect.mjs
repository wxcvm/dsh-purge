import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const root='D:\\dsh\\resources\\app\\dsh\\node_modules';
const req=createRequire(path.join(home,'profiles','desktop','package.json'));
let plugin={resolved:false};
try{
 const f=req.resolve('dsh-purge');let d=path.dirname(f);
 for(let i=0;i<5;i++,d=path.dirname(d)){
  try{const p=JSON.parse(fs.readFileSync(path.join(d,'package.json'),'utf8'));
   if(p.name==='dsh-purge'){const obs=path.join(d,'lib','runtime-observations.js');const txt=fs.existsSync(obs)?fs.readFileSync(obs,'utf8'):'';
    plugin={resolved:true,version:typeof p.version==='string'&&/^[\w.-]+$/.test(p.version)?p.version:null,observer:!!txt,reasoningCounters:txt.includes('firstReasoningMs'),compactBatches:txt.includes('compactReasoningChunks')};break}
  }catch{}
 }
}catch{}
console.log(JSON.stringify({stage:'installed-plugin',...plugin}));
let ports=[];
try{ports=JSON.parse(process.env.QA_PORTS||'[]')}catch{}
if(!Array.isArray(ports))ports=[ports];
ports=[...new Set([...ports,43120])].filter(p=>Number.isInteger(p)&&p>0&&p<65536).slice(0,20);
for(const port of ports){
 for(const host of ['127.0.0.1','[::1]']){
  let result={stage:'runtime-endpoint',port,host,status:'unavailable'};
  try{
   const res=await fetch('http://'+host+':'+port+'/dsh-purge/runtime-observations?limit=1',{signal:AbortSignal.timeout(1500),redirect:'error'});
   result.status='http-'+res.status;
   if(res.ok){const j=await res.json();
    if(j?.ok===true&&Array.isArray(j.items))result={...result,status:'observed-api',streamSupport:j.streamSupport==='observed'?'observed':'not-observed',rowCount:j.items.length,hasReasoningFields:j.items.some(r=>Object.hasOwn(r,'reasoningChunks')),hasCompactFields:j.items.some(r=>Object.hasOwn(r,'durableCompactReasoningChunks'))};
   }
  }catch{}
  console.log(JSON.stringify(result));
 }
}
const keys=['agent/assistant-stream','reasoning-delta','reasoning-chunks','text-chunks','conversation.chat.reasoning.body'];
const pkgs=['dsh-agent','dsh-agent-loop','dsh-session','dsh-llm','dsh-desktop-host','dsh-web-server','dsh-web-app','dsh-stream'];
for(const pkg of pkgs){
 const dir=path.join(root,'@deepseek-ai',pkg);
 let manifest;try{manifest=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'))}catch{continue}
 const hits=[];
 const walk=(d,depth=0)=>{
  if(depth>6||hits.length>=40)return;
  let entries;try{entries=fs.readdirSync(d,{withFileTypes:true})}catch{return}
  for(const e of entries){
   if(hits.length>=40)break;
   const f=path.join(d,e.name);
   if(e.isDirectory()&&!e.isSymbolicLink()&&e.name!=='node_modules')walk(f,depth+1);
   else if(e.isFile()&&/\.(?:js|mjs|cjs|ts)$/.test(e.name)&&!e.name.endsWith('.map')){
    let source;try{if(fs.statSync(f).size>12*1024*1024)continue;source=fs.readFileSync(f,'utf8')}catch{continue}
    const present=keys.filter(k=>source.includes(k));if(!present.length)continue;
    const locations=present.map(k=>({key:k,line:source.slice(0,source.indexOf(k)).split('\n').length,
     count:source.split(k).length-1}));
    hits.push({file:path.relative(dir,f).replaceAll('\\','/'),locations});
   }
  }
 };
 walk(path.join(dir,'lib'));
 console.log(JSON.stringify({stage:'host-source-contract',pkg,version:typeof manifest.version==='string'&&/^[\w.-]+$/.test(manifest.version)?manifest.version:null,hits}));
}
