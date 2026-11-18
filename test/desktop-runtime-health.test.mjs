import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectDesktopRuntime, repairDesktopRuntime, restoreRuntimePayload, RUNTIME_FILES, readDesktopManifest } from '../lib/desktop-runtime-health.js';
const sevenZip='C:/Program Files/7-Zip/7z.exe';
function fixture(t) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'purge-runtime-test-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const install=path.join(home,'install'),resources=path.join(install,'resources'),payload=path.join(home,'payload'),journalRoot=path.join(home,'journal');
 fs.mkdirSync(path.join(resources,'app'),{recursive:true});fs.mkdirSync(payload,{recursive:true});
 fs.writeFileSync(path.join(resources,'app/package.json'),JSON.stringify({name:'@deepseek-ai/dsh-desktop',version:'0.2.2-rc.3'}));
 const exe=path.join(install,'DeepSeek Harness.exe');fs.writeFileSync(exe,'fixture only, never executed');
 for(const rel of RUNTIME_FILES){fs.mkdirSync(path.dirname(path.join(payload,rel)),{recursive:true});fs.writeFileSync(path.join(payload,rel),rel==='versions.json'?JSON.stringify({node:'24.21.0',pnpm:'11.28.5'}):'fixture '+rel);}
 return {home,resources,payload,journalRoot,exe,version:'0.2.2-rc.3'};
}
function asar(file,version){
 const data=Buffer.from(JSON.stringify({name:'@deepseek-ai/dsh-desktop',version}));const header=Buffer.from(JSON.stringify({files:{'package.json':{size:data.length,offset:'0'}}}));
 const headerSize=8+header.length;const pre=Buffer.alloc(16);pre.writeUInt32LE(4,0);pre.writeUInt32LE(headerSize,4);pre.writeUInt32LE(header.length,12);fs.writeFileSync(file,Buffer.concat([pre,header,data]));
}
test('missing runtime is a shared failure, inspection does not write',t=>{const f=fixture(t);const r=inspectDesktopRuntime(f);assert.equal(r.ok,false);assert.equal(r.issues.length,RUNTIME_FILES.length);assert.equal(fs.existsSync(path.join(f.resources,'runtime')),false);});
test('real ASAR identity takes priority over an old unpacked tree',t=>{const f=fixture(t);asar(path.join(f.resources,'app.asar'),'0.2.2-rc.4');assert.equal(readDesktopManifest(f.resources).version,'0.2.2-rc.4');});
test('restore missing payload and preserve existing files byte for byte',async t=>{const f=fixture(t),existing=path.join(f.resources,'runtime/bin/node.cmd');fs.mkdirSync(path.dirname(existing),{recursive:true});fs.writeFileSync(existing,'user existing shim');const r=await restoreRuntimePayload(f);assert.equal(r.changed,RUNTIME_FILES.length-1);assert.equal(fs.readFileSync(existing,'utf8'),'user existing shim');assert.equal(inspectDesktopRuntime(f).ok,true);assert.equal(JSON.parse(fs.readFileSync(r.receipt)).phase,'complete');});
test('running installation version change prevents writes',async t=>{const f=fixture(t);await assert.rejects(restoreRuntimePayload({...f,version:'wrong'}),{code:'VERSION_MISMATCH'});assert.equal(fs.existsSync(path.join(f.resources,'runtime')),false);});
test('different runtime versions are not merged',async t=>{const f=fixture(t);fs.mkdirSync(path.join(f.resources,'runtime'));fs.writeFileSync(path.join(f.resources,'runtime/versions.json'),JSON.stringify({node:'old',pnpm:'old'}));await assert.rejects(restoreRuntimePayload(f),{code:'VERSION_MISMATCH'});assert.equal(fs.existsSync(path.join(f.resources,'runtime/bin')),false);});
test('incomplete source is rejected before any destination write',async t=>{const f=fixture(t);fs.unlinkSync(path.join(f.payload,RUNTIME_FILES[2]));await assert.rejects(restoreRuntimePayload(f),{code:'INVALID_PAYLOAD'});assert.equal(fs.existsSync(path.join(f.resources,'runtime')),false);});
test('Windows runtime junction is not traversed during recovery',async t=>{const f=fixture(t),outside=path.join(f.home,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'sentinel'),'keep');fs.symlinkSync(outside,path.join(f.resources,'runtime'),'junction');await assert.rejects(restoreRuntimePayload(f),{code:'LINK_REFUSED'});assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'keep');fs.unlinkSync(path.join(f.resources,'runtime'));});
test('copy failure retains receipt and does not remove existing files',async t=>{const f=fixture(t);await assert.rejects(restoreRuntimePayload({...f,onCopy:()=>{throw Error('simulated disk failure');}}),/simulated disk failure/);const j=JSON.parse(fs.readFileSync(path.join(f.journalRoot,'receipt.json')));assert.equal(j.phase,'failed');assert.ok(j.created.length===1);assert.ok(fs.existsSync(path.join(f.resources,'runtime',j.created[0].file)));});
test('in-progress package operation blocks runtime recovery',async t=>{const f=fixture(t),run=path.join(f.home,'profiles/desktop/.plugin-manager');fs.mkdirSync(run,{recursive:true});fs.writeFileSync(path.join(run,'run.json'),'{}');await assert.rejects(repairDesktopRuntime(f),{code:'PACKAGE_OPERATION_ACTIVE'});});
test('mismatched cached version is rejected without running installer',async t=>{const f=fixture(t),cache=path.join(f.home,'cache');fs.mkdirSync(cache);fs.writeFileSync(path.join(cache,'update-info.json'),JSON.stringify({fileName:'deepseek-harness-0.2.2-rc.4-win-x64.exe',sha512:'A'.repeat(86)+'=='}));await assert.rejects(repairDesktopRuntime({...f,cache,sevenZip}),{code:'VERSION_MISMATCH'});});
test('bad cache hash leaves installed runtime untouched',async t=>{const f=fixture(t),cache=path.join(f.home,'cache');fs.mkdirSync(cache);const fileName='deepseek-harness-0.2.2-rc.3-win-x64.exe';fs.writeFileSync(path.join(cache,fileName),'bad');fs.writeFileSync(path.join(cache,'update-info.json'),JSON.stringify({fileName,sha512:'A'.repeat(86)+'=='}));await assert.rejects(repairDesktopRuntime({...f,cache,sevenZip}),{code:'HASH_MISMATCH'});assert.equal(fs.existsSync(path.join(f.resources,'runtime')),false);});
test('full cached archive extraction recovers missing runtime without executing installer',async t=>{
 const f=fixture(t),cache=path.join(f.home,'cache'),outer=path.join(f.home,'outer'),inner=path.join(f.home,'inner');fs.mkdirSync(cache);fs.mkdirSync(path.join(outer,'$PLUGINSDIR'),{recursive:true});fs.mkdirSync(path.join(inner,'resources'),{recursive:true});
 fs.cpSync(f.payload,path.join(inner,'resources/runtime'),{recursive:true});asar(path.join(inner,'resources/app.asar'),f.version);
 const run=(args,cwd)=>execFileSync(sevenZip,args,{cwd,windowsHide:true,stdio:'ignore'});
 run(['a',path.join(outer,'$PLUGINSDIR/app-64.7z'),'resources','-y'],inner);
 const fileName='deepseek-harness-0.2.2-rc.3-win-x64.exe',installer=path.join(cache,fileName);run(['a','-t7z',installer,'$PLUGINSDIR','-y'],outer);
 const sha512=createHash('sha512').update(fs.readFileSync(installer)).digest('base64');fs.writeFileSync(path.join(cache,'update-info.json'),JSON.stringify({fileName,sha512}));
 const result=await repairDesktopRuntime({...f,cache,sevenZip});assert.equal(result.ok,true);assert.equal(result.changed,RUNTIME_FILES.length);assert.equal(result.after.ok,true);
 const again=await repairDesktopRuntime({...f,cache,sevenZip});assert.equal(again.changed,0);
});
