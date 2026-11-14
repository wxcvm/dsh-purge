import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inspectRepairCenter,runRepair,rollbackRepair,patchEmptyStreamDeadline} from '../lib/repair-center.js';
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'purge-center-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const root=path.join(home,'purge');fs.mkdirSync(path.join(root,'lib'),{recursive:true});fs.mkdirSync(path.join(home,'profiles/desktop'),{recursive:true});fs.writeFileSync(path.join(home,'profiles/desktop/package.json'),JSON.stringify({dsh:{profile:{bundles:['dsh-purge']}}}));return {home,purgeRoot:root,exe:process.execPath};}
test('diagnostics identify comments-only patches and duplicate install YAML without modifying files',async t=>{const o=fixture(t);fs.writeFileSync(path.join(o.home,'cordis.patch.yml'),'# keep comments\n');fs.writeFileSync(path.join(o.home,'profiles/desktop/pnpm-workspace.yaml'),'allowBuilds: {}\nallowBuilds: {}\n');const r=await inspectRepairCenter(o);assert.equal(r.checks.find(x=>x.id==='global-patch').repairable,true);assert.equal(r.checks.find(x=>x.id==='workspace-yaml').status,'invalid-yaml');assert.equal(fs.readFileSync(path.join(o.home,'cordis.patch.yml'),'utf8'),'# keep comments\n');});
test('patch normalization preserves comments, creates a receipt, and rolls back exact bytes',async t=>{const o=fixture(t),file=path.join(o.home,'cordis.patch.yml');fs.writeFileSync(file,'# original\r\n');const r=await runRepair(o,'global-patch');assert.ok(r.receiptId);assert.equal(fs.readFileSync(file,'utf8'),'# original\n[]\n');assert.equal((await runRepair(o,'global-patch')).changed,false);rollbackRepair(o,r.receiptId);assert.equal(fs.readFileSync(file,'utf8'),'# original\r\n');});
test('invalid shape is reported instead of guessed into an array',async t=>{const o=fixture(t),file=path.join(o.home,'cordis.patch.yml');fs.writeFileSync(file,'something: true');await assert.rejects(runRepair(o,'global-patch'),{code:'NOT_AUTOMATIC'});assert.equal(fs.readFileSync(file,'utf8'),'something: true');});
test('rollback refuses to erase a later edit',async t=>{const o=fixture(t),file=path.join(o.home,'cordis.patch.yml');fs.writeFileSync(file,'# original');const r=await runRepair(o,'global-patch');fs.writeFileSync(file,'# later\n[]\n');assert.throws(()=>rollbackRepair(o,r.receiptId),{code:'CONCURRENT_CHANGE'});});
test('config junction target is not modified',async t=>{const o=fixture(t),outside=path.join(o.home,'outside'),desktop=path.join(o.home,'profiles/desktop');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'cordis.patch.yml'),'# outside');fs.renameSync(desktop,desktop+'.saved');fs.symlinkSync(outside,desktop,process.platform==='win32'?'junction':'dir');await assert.rejects(runRepair(o,'profile-patch'),{code:'LINK_REFUSED'});assert.equal(fs.readFileSync(path.join(outside,'cordis.patch.yml'),'utf8'),'# outside');fs.unlinkSync(desktop);});
const bug='async function* waitForStream(){while(true){if(outcome.timeout){\n if(held.length>0){\n open("budget");\n yield* flush();\n }\n continue;\n }}}';
test('optional stream component is diagnosed, not added when absent',async t=>{const o=fixture(t),r=await inspectRepairCenter(o);assert.equal(r.checks.find(x=>x.id==='stream-timeout').status,'not-installed');assert.equal(fs.existsSync(path.join(o.purgeRoot,'lib/stream-guard.js')),false);});
test('known empty-buffer timeout is corrected once and can be rolled back',async t=>{const o=fixture(t),file=path.join(o.purgeRoot,'lib/stream-guard.js');fs.writeFileSync(file,bug);const r=await runRepair(o,'stream-timeout');assert.equal(r.restartRequired,true);assert.equal(patchEmptyStreamDeadline(fs.readFileSync(file,'utf8')).changed,false);rollbackRepair(o,r.receiptId);assert.equal(fs.readFileSync(file,'utf8'),bug);});
test('unrecognized stream code is not rewritten',()=>{const text='if (outcome.timeout) { open("budget"); if (held.length > 0) yield* flush(); }';assert.deepEqual(patchEmptyStreamDeadline(text),{changed:false,text});});
test('receipt path traversal and unknown actions are rejected',async t=>{const o=fixture(t);assert.throws(()=>rollbackRepair(o,'../other'),{code:'BAD_RECEIPT'});await assert.rejects(runRepair(o,'delete-sessions'),{code:'UNKNOWN_REPAIR'});});

test('the exact timeout rewrite restores timer responsiveness under an external watchdog', async () => {
  const { spawnSync } = await import('node:child_process');
  const source = `
    async function* stream() {
      const deadline = Date.now() + 5, held = [];
      let probing = true;
      const pending = new Promise(resolve => setTimeout(() => resolve({ done: true }), 70));
      const open = () => { probing = false; };
      try { while (true) {
        let outcome;
        if (probing) { const left = deadline - Date.now(); outcome = left <= 0 ? {timeout:true} : await Promise.race([pending.then(value=>({value})),new Promise(r=>setTimeout(()=>r({timeout:true}),left))]); }
        else outcome = {value:await pending};
        if (outcome.timeout) {
          if (held.length > 0) {
            open("budget");
          }
          continue;
        }
        if(outcome.value.done) return;
      }} finally {}
    }
    let heartbeat=false; setTimeout(()=>heartbeat=true,20);
    for await (const item of stream()) {}
    if(!heartbeat) throw Error('timers starved');
  `;
  const before = spawnSync(process.execPath, ['--input-type=module','-e',source], { timeout:500, windowsHide:true, encoding:'utf8' });
  assert.equal(before.error?.code, 'ETIMEDOUT');
  const fixed = patchEmptyStreamDeadline(source);
  assert.equal(fixed.changed,true);
  const after = spawnSync(process.execPath,['--input-type=module','-e',fixed.text],{timeout:3000,windowsHide:true,encoding:'utf8'});
  assert.equal(after.error,undefined); assert.equal(after.status,0,after.stderr);
});
