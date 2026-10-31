import test from 'node:test'
import assert from 'node:assert/strict'
import { collectAgentStatus } from '../lib/redteam/agent-status.js'
import { handleAgentsOp } from '../lib/redteam/ui.js'

function ctx(rows, children, agents = {}) {
  const services = { sessions: {list: async()=>rows}, subagents: {listChildren: async id=>children(id)}, agents: {get:id=>agents[id]} }
  return { get: name=>services[name] }
}
const root = id=>({id,header:{}})

test('agent status accepts legacy activity and async session lists', async()=>{
  const result = await collectAgentStatus(ctx([root('legacy')],()=>[{id:'a',kind:'child',activity:'running'},{id:'b',kind:'child',activity:'idle'}]),{})
  assert.equal(result.ok,true); assert.equal(result.available,true); assert.equal(result.used,1); assert.equal(result.free,2)
  assert.equal(result.per_root[0].owner,'legacy')
})
test('new host entries use live Agent.status rather than falsely reporting zero', async()=>{
  const result = await collectAgentStatus(ctx([root('new')],()=>[{id:'a'},{id:'b'}],{a:{status:'running'},b:{status:'idle'}}),{})
  assert.equal(result.used,1); assert.equal(result.free,2); assert.equal(result.available,true)
})
test('unknown child activity leaves free unknown and observed usage a lower bound',async()=>{
  const result=await collectAgentStatus(ctx([root('partial')],()=>[{id:'a',activity:'running'},{id:'b'}]),{})
  assert.equal(result.ok,true); assert.equal(result.available,false); assert.equal(result.used,1); assert.equal(result.free,null)
  assert.equal(result.used_is_lower_bound,true); assert.equal(result.per_root[0].free,null)
})
test('per-root maxima are not subtracted from combined occupancy',async()=>{
  const result=await collectAgentStatus(ctx([root('r1'),root('r2')],id=>[{id:id+'a',activity:'running'},{id:id+'b',activity:'running'}]),{})
  assert.equal(result.used,4); assert.equal(result.free,null); assert.deepEqual(result.per_root.map(x=>x.free),[1,1])
})
test('a failed root lookup cannot silently turn missing usage into available slots',async()=>{
  const result=await collectAgentStatus(ctx([root('r1'),root('r2')],id=>{if(id==='r2')throw Error('unavailable');return [{id:'a',activity:'running'}]}),{})
  assert.equal(result.available,false); assert.equal(result.used_is_lower_bound,true); assert.equal(result.free,null); assert.match(result.per_root[1].error,/unavailable/)
})
test('unavailable or malformed session registries report unknown rather than zero',async()=>{
  for(const context of [{get(){throw Error('missing')}},ctx(null,()=>[])]) {
    const result=await collectAgentStatus(context,{}); assert.equal(result.ok,false); assert.equal(result.used,null); assert.equal(result.free,null)
  }
  const empty=await collectAgentStatus(ctx([],()=>[]),{}); assert.equal(empty.free,null)
  const malformed=await collectAgentStatus(ctx([{id:'no-header'}],()=>[]),{}); assert.equal(malformed.available,false)
})
test('missing store root cannot write concurrency settings in the current directory',async()=>{
  assert.deepEqual(await handleAgentsOp({}, {op:'unrelated'}),undefined)
  const result=await handleAgentsOp({}, {op:'setAgentsMax',max:8}); assert.equal(result.ok,false); assert.match(result.error,/根目录/)
})

test('status service resolution supports property fallback when get returns undefined',async()=>{
  const result=await collectAgentStatus({get:()=>undefined,sessions:{list:()=>[root('fallback')]},subagents:{listChildren:()=>[]}}, {})
  assert.equal(result.available,true);assert.equal(result.free,3)
})
test('HTTP settings handler rejects malformed numeric input rather than silently saving defaults',async()=>{
  for (const max of [0,-1,1.5,NaN,Infinity,'8',null,Number.MAX_SAFE_INTEGER+1]) {
    const result=await handleAgentsOp({redteam:{root:'unused-no-write'}},{op:'setAgentsMax',max})
    assert.equal(result.ok,false);assert.match(result.error,/正整数/)
  }
})
