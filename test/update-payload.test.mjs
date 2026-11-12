import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyUpdatePayload } from '../lib/update-payload.js';

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
