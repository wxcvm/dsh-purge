import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const start=source.indexOf('function installTargetBindingPicker(ctx)')
const end=source.indexOf('\n\t\tfunction apply(ctx)',start)
test('native picker uses captured session and never submits a model message',async()=>{
  const registrations=[]
  const requests=[]
  const commands=[]
  const context={__dshPurgeDrill:{api:async req=>{requests.push(req);return {ok:true,current:'a',targets:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]}}}}
  vm.runInNewContext(source.slice(start,end)+'\nthis.install=installTargetBindingPicker;',context)
  const services={commandUi:{decorate:spec=>{registrations.push(spec);return ()=>{}}},sessions:{subagentAddress:()=>undefined},remote:{commands:{execute:async(...args)=>{commands.push(args);return {ok:true,value:{result:{kind:'success'}}}}}}}
  context.install({get:name=>services[name],effect:fn=>fn()})
  const spec=registrations.find(x=>x.name==='bind')
  assert.equal(spec.ui.kind,'popupSelect')
  const session={sessionId:'fresh'}
  const options=await spec.ui.options(session,{aborted:false})
  assert.equal(options[0].active,true)
  assert.equal(requests[0].sessionId,'fresh')
  await spec.ui.onSelect(options[1],session)
  assert.equal(commands[0][0],'fresh')
  assert.equal(commands[0][1],'/bind select b')
  await spec.ui.onSelect(options[2],session)
  assert.equal(commands[1][1],'/bind unbind')
  services.remote.commands.execute=async()=>({ok:true,value:{result:{kind:'error',text:'failed'}}})
  await assert.rejects(spec.ui.onSelect(options[1],session),/failed/)
})
