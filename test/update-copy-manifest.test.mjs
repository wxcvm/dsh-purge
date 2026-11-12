import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('lib/update.js',root),'utf8');
const literal=source.match(/const COPY_NAMES = (\[[\s\S]*?\]);/)[1];
const names=JSON.parse(literal.replace(/,\s*\]$/,']'));

test('self-update copies every declared package payload root',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8'));
  for(const entry of pkg.files.filter(x=>!x.startsWith('!'))){
    assert(names.includes(entry.split('/')[0]),'Missing update payload: '+entry);
  }
  assert(names.includes('package.json'));
});

test('ZIP overlay retains runtime imports from scripts and shipped preset resources',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'purge-overlay-'));
  try{
    const src=path.join(temp,'src'),dst=path.join(temp,'dst');
    const files={
      'package.json':'{"type":"module"}',
      'lib/redteam/vps-admin-config.js':"export {check} from '../../scripts/vps-admin-check.mjs';",
      'scripts/vps-admin-check.mjs':'export const check = true;',
      'presets/redteam/preset.yml':'name: example',
      'skills/example.md':'example',
      'maintenance/example.txt':'example',
      'NOTICE':'example',
    };
    for(const [name,data] of Object.entries(files)){const p=path.join(src,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
    fs.mkdirSync(dst);
    for(const name of names){const p=path.join(src,name);if(fs.existsSync(p))fs.cpSync(p,path.join(dst,name),{recursive:true});}
    assert.equal((await import(pathToFileURL(path.join(dst,'lib/redteam/vps-admin-config.js')).href)).check,true);
    for(const name of Object.keys(files))assert(fs.existsSync(path.join(dst,name)),name);
  }finally{
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
