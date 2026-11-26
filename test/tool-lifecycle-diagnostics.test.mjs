import test from 'node:test';
import assert from 'node:assert/strict';
import { contextIntegrity } from '../lib/task-quality-diagnostics.js';

test('native tool result identity pairs within turn and step, including legacy results', () => {
  const events=[
    {seq:1,type:'tool/call',data:{turn:1,step:1,callId:'same'}},
    {seq:2,type:'tool/result',data:{turn:1,step:1,message:{toolCallId:'same',source:{callId:'same'},content:'SECRET'}}},
    {seq:3,type:'tool/call',data:{turn:1,step:2,callId:'same'}},
    {seq:4,type:'tool/result',data:{turn:2,step:2,message:{toolCallId:'same'}}},
    {seq:5,type:'tool/call',data:{callId:'legacy'}},
    {seq:6,type:'tool/result',data:{callId:'legacy'}},
  ];
  const r=contextIntegrity(events);
  assert.equal(r.unmatchedCalls,1);
  assert.equal(r.unmatchedResults,1);
  assert.doesNotMatch(JSON.stringify(r),/SECRET|same|legacy/);
});

test('conflicting result identities do not falsely pair a call', () => {
  const r=contextIntegrity([
    {seq:1,type:'tool/call',data:{turn:1,step:1,callId:'a'}},
    {seq:2,type:'tool/result',data:{turn:1,step:1,callId:'b',message:{toolCallId:'a'}}},
  ]);
  assert.equal(r.unmatchedCalls,1);
  assert.equal(r.unmatchedResults,0);
});
