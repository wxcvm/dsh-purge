import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyUpdatePayload, readUpdateRecovery, restoreInterruptedUpdate, listPendingUpdateRecovery, assertNoPendingUpdateRecovery } from '../lib/update-payload.js';
import { spawnSync } from 'node:child_process';

const names = ['lib','scripts','client.js','package.json'];
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'purge-copy-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root,'source'), one = path.join(root,'one'), two = path.join(root,'two'), backup = path.join(root,'backup');
  const put = async (dir, name, value) => {
    const file = path.join(dir,name);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file,value);
  };
  for (const dir of [source,one,two]) {
    await put(dir,'lib/index.js',dir === source ? 'new' : 'old');
    await put(dir,'client.js',dir === source ? 'new-client' : 'old-client');
    await put(dir,'package.json',JSON.stringify({name:'dsh-purge',version:dir===source?'2':'1',files:['lib','scripts','client.js']}));
  }
  await put(source,'scripts/ensure-profile-bundle.mjs','new-bootstrap');
  await put(source,'lib/redteam/vps-admin-config.js','new-consumer');
  await put(source,'scripts/vps-admin-check.mjs','new-runtime');
  await put(one,'lib/old-only.js','old-only');
  await put(one,'user-config.json','keep');
  return {source,one,two,backup};
}
const read = (dir, file) => fs.readFileSync(path.join(dir,file),'utf8');

test('invalid target payload is rejected before any destination is modified', async t => {
  const {source,one,two,backup} = await fixture(t);
  await fsp.rm(path.join(source,'scripts/vps-admin-check.mjs'));
  await assert.rejects(copyUpdatePayload(source,[one,two],backup,names), /Missing update payload: scripts\/vps-admin-check/);
  assert.equal(read(one,'lib/index.js'),'old');
  assert.equal(read(two,'client.js'),'old-client');
  assert.equal(fs.existsSync(backup),false);
});

test('failed copy into second install restores both installs and removes new groups', async t => {
  const {source,one,two,backup} = await fixture(t);
  const io = {...fsp, cp: async (from,to,opts) => {
    if (from === path.join(source,'client.js') && to === path.join(two,'client.js')) {
      await fsp.writeFile(to,'partial');
      throw new Error('simulated write failure');
    }
    return fsp.cp(from,to,opts);
  }};
  await assert.rejects(copyUpdatePayload(source,[one,two],backup,names,{io}), /previous plugin files restored/);
  for (const dir of [one,two]) {
    assert.equal(read(dir,'lib/index.js'),'old');
    assert.equal(read(dir,'client.js'),'old-client');
    assert.equal(JSON.parse(read(dir,'package.json')).version,'1');
    assert.equal(fs.existsSync(path.join(dir,'scripts')),false);
  }
  assert.equal(read(one,'lib/old-only.js'),'old-only');
  assert.equal(read(one,'user-config.json'),'keep');
});

test('successful copy installs runtime resources without touching user files', async t => {
  const {source,one,two,backup} = await fixture(t);
  await copyUpdatePayload(source,[one,two],backup,names);
  for (const dir of [one,two]) {
    assert.equal(read(dir,'scripts/vps-admin-check.mjs'),'new-runtime');
    assert.equal(JSON.parse(read(dir,'package.json')).version,'2');
  }
  assert.equal(read(one,'user-config.json'),'keep');
  assert.equal(fs.existsSync(path.join(one,'lib/old-only.js')),false);
});

test('failed rollback reports retained backup instead of claiming success', async t => {
  const {source,one,backup} = await fixture(t);
  const target = path.join(one,'client.js');
  const io = {...fsp, cp: async (from,to,opts) => {
    if (to === target && (from === path.join(source,'client.js') || from === path.join(backup,'0','client.js'))) {
      throw new Error('simulated locked client');
    }
    return fsp.cp(from,to,opts);
  }};
  await assert.rejects(copyUpdatePayload(source,[one],backup,names,{io}), error => {
    assert.equal(error.keepUpdateBackup,true);
    assert.match(error.message,/rollback incomplete/);
    assert.ok(error.message.includes(backup));
    return true;
  });
  assert.equal(read(path.join(backup,'0'),'client.js'),'old-client');
  assert.equal(read(one,'lib/index.js'),'old');
});

test('process interruption leaves a journal usable by an independent recovery process', async t => {
  const {source,one,two,backup} = await fixture(t);
  const moduleUrl = new URL('../lib/update-payload.js',import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module','-e',
    'import {copyUpdatePayload} from '+JSON.stringify(moduleUrl)+';'+
    'await copyUpdatePayload(...'+JSON.stringify([source,[one,two],backup,names])+', {onProgress: p => {if(p.copied===1) process.exit(73);}});'
  ], {encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);
  assert.equal(read(one,'lib/index.js'),'new');
  const journal = await readUpdateRecovery(backup);
  assert.equal(journal.phase,'copying');
  assert.equal(journal.touched,1);
  await restoreInterruptedUpdate(backup);
  assert.equal(read(one,'lib/index.js'),'old');
  assert.equal(read(one,'lib/old-only.js'),'old-only');
  assert.equal(read(two,'lib/index.js'),'old');
  assert.equal((await readUpdateRecovery(backup)).phase,'restored');
  await assert.rejects(restoreInterruptedUpdate(backup),/No interrupted file copy/);
});

test('completed journal is not eligible for interrupted-copy restoration', async t => {
  const {source,one,backup} = await fixture(t);
  await copyUpdatePayload(source,[one],backup,names);
  assert.equal((await readUpdateRecovery(backup)).phase,'complete');
  await assert.rejects(restoreInterruptedUpdate(backup),/No interrupted file copy/);
  assert.equal(read(one,'lib/index.js'),'new');
});

test('pending or malformed journals block a fresh update until restored', async t => {
  const {source,one,backup} = await fixture(t);
  const home = path.join(backup,'recovery-home');
  const pending = path.join(home,'copy-interrupted');
  const complete = path.join(home,'copy-complete');
  const empty = path.join(home,'copy-preparing');
  const invalid = path.join(home,'copy-invalid');
  assert.deepEqual(await listPendingUpdateRecovery(home),[]);
  await fsp.mkdir(empty,{recursive:true});
  await copyUpdatePayload(source,[one],complete,names);
  assert.deepEqual(await listPendingUpdateRecovery(home),[]);
  const moduleUrl = new URL('../lib/update-payload.js',import.meta.url).href;
  const child = spawnSync(process.execPath,['--input-type=module','-e',
    'import {copyUpdatePayload} from '+JSON.stringify(moduleUrl)+';'+
    'await copyUpdatePayload(...'+JSON.stringify([source,[one],pending,names])+', {onProgress: p => {if(p.copied===1) process.exit(73);}});'
  ],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);
  await fsp.mkdir(invalid);
  await fsp.writeFile(path.join(invalid,'recovery.json'),'{broken');
  const before = await listPendingUpdateRecovery(home);
  assert.deepEqual(before.map(x=>x.phase).sort(),['copying','unreadable']);
  await assert.rejects(assertNoPendingUpdateRecovery(home),/copy-interrupted/);
  await restoreInterruptedUpdate(pending);
  await assert.rejects(assertNoPendingUpdateRecovery(home),/copy-invalid/);
  await fsp.rm(invalid,{recursive:true});
  await assertNoPendingUpdateRecovery(home);
  assert.equal((await readUpdateRecovery(pending)).phase,'restored');
  assert.equal((await readUpdateRecovery(complete)).phase,'complete');
});


test('an interrupted update can restore third-party notices as well as plugin files', async t => {
  const {source,one,two,backup} = await fixture(t);
  const notice = path.join('third_party', 'example', 'NOTICE');
  for (const [dir, text] of [[source, 'new notice'], [one, 'old notice']]) {
    await fsp.mkdir(path.dirname(path.join(dir,notice)), {recursive:true});
    await fsp.writeFile(path.join(dir,notice),text);
  }
  const manifest = JSON.parse(read(source,'package.json'));
  manifest.files.push('third_party');
  await fsp.writeFile(path.join(source,'package.json'),JSON.stringify(manifest));
  const copyNames = [...names,'third_party'];
  const moduleUrl = new URL('../lib/update-payload.js',import.meta.url).href;
  const child = spawnSync(process.execPath,['--input-type=module','-e',
    'import {copyUpdatePayload} from '+JSON.stringify(moduleUrl)+';'+
    'await copyUpdatePayload(...'+JSON.stringify([source,[one,two],backup,copyNames])+', {onProgress: p => {if(p.copied===p.copyTotal) process.exit(73);}});'
  ],{encoding:'utf8'});
  assert.equal(child.status,73,child.stderr);
  assert.equal(read(one,notice),'new notice');
  assert.equal(read(two,notice),'new notice');
  assert.equal((await readUpdateRecovery(backup)).phase,'copying');
  await restoreInterruptedUpdate(backup);
  assert.equal(read(one,notice),'old notice');
  assert.equal(fs.existsSync(path.join(two,'third_party')),false);
  assert.equal(read(one,'user-config.json'),'keep');
  assert.equal((await readUpdateRecovery(backup)).phase,'restored');
});
