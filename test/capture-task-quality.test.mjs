import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCaptureConfig, captureMetrics, planCapture } from '../scripts/capture-task-quality.mjs';

test('capture requires three existing isolated like-for-like profiles before any model call', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-capture-config-'));
  try {
    const config = { exe: root, cli: root, dshHome: root, runtime: root };
    for (const name of ['host', 'current', 'candidate']) {
      mkdirSync(join(root, 'profiles', name), { recursive: true });
      writeFileSync(join(root, 'profiles', name, 'package.json'), '{}');
      config[name] = { profile: name, variant: name, model: 'fixture/model', hostVersion: '0.2.2-rc.3', environment: 'fixture', settings: {} };
    }
    assert.equal(validateCaptureConfig(config), config);
    config.candidate.profile = 'current'; assert.throws(() => validateCaptureConfig(config), /distinct/);
    config.candidate.profile = 'candidate'; config.candidate.model = 'different'; assert.throws(() => validateCaptureConfig(config), /comparison mismatch/);
    config.candidate.model = 'fixture/model'; config.candidate.profile = 'missing'; assert.throws(() => validateCaptureConfig(config), /existing isolated/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('capture metrics validate every attempt route and omit partial or missing measurements', () => {
  const attempt = (provider='fixture', model='model', tokens=10) => ({provider,model,usage:{totalTokens:tokens},firstTextMs:5});
  const probe = {evicted:0,frames:{start:2},items:[attempt(),attempt()]};
  assert.deepEqual(captureMetrics(probe,'fixture/model',100,[{type:'tool_call'}]),{elapsedMs:100,totalTokens:20,firstTextMs:5,toolCalls:1});
  assert.throws(()=>captureMetrics({...probe,items:[attempt(),attempt('other')]},'fixture/model',100,[]),/route missing\/mismatched/);
  assert.throws(()=>captureMetrics({...probe,items:[attempt(),attempt(null)]},'fixture/model',100,[]),/route missing\/mismatched/);
  assert.deepEqual(captureMetrics({...probe,evicted:1},'fixture/model',100,[]),{elapsedMs:100,toolCalls:0});
  assert.deepEqual(captureMetrics({...probe,frames:{start:3}},'fixture/model',100,[]),{elapsedMs:100,toolCalls:0});
  assert.deepEqual(captureMetrics({...probe,items:[attempt(),attempt('fixture','model',null)]},'fixture/model',100,[]),{elapsedMs:100,firstTextMs:5,toolCalls:0});
});


test('resume reuses completed real samples, preserves input and schedules only missing variants', () => {
  const config = Object.fromEntries(['host','current','candidate'].map(name=>[name,{profile:name,variant:name,model:'fixture/model',hostVersion:'0.2.2-rc.3',environment:'fixture',settings:{}}]));
  const smoke=planCapture(config,false);
  assert.equal(smoke.pending.length,6);
  for (const {task,name} of smoke.pending) smoke.matrix[name].samples[task.id]={response:'94'};
  const before=JSON.stringify(smoke.matrix);
  const full=planCapture(config,true,smoke.matrix);
  assert.equal(full.reusedSamples,6);assert.equal(full.pending.length,24);
  assert.ok(full.pending.every(({task})=>!['arithmetic','multi-step'].includes(task.id)));
  assert.equal(planCapture(config,false,smoke.matrix).pending.length,0);
  full.matrix.host.samples.sort={response:'[]'};
  assert.equal(JSON.stringify(smoke.matrix),before);
  delete smoke.matrix.candidate.samples.arithmetic;
  const partial=planCapture(config,false,smoke.matrix);
  assert.equal(partial.reusedSamples,5);
  assert.deepEqual(partial.pending.map(({task,name})=>[task.id,name]),[['arithmetic','candidate']]);
  assert.throws(()=>planCapture(config,true,{...smoke.matrix,captureKind:'synthetic'}),/real capture/);
  assert.throws(()=>planCapture({...config,candidate:{...config.candidate,variant:'new-build'}},true,smoke.matrix),/resume comparison mismatch: candidate.variant/);
  assert.throws(()=>planCapture({...config,host:{...config.host,profile:'other'}},true,smoke.matrix),/resume comparison mismatch: host.profile/);
});
