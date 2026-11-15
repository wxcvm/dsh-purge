import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const source=client.slice(client.indexOf('function RulesSection()'),client.indexOf('function skillUiAllowed'));
function fixture({failSave=false,failStatus=false,editing=false,confirm=false}={}) {
  const states=[{ok:true,rules:[],active:null,cwd:'/work',cwd_candidates:[{path:'/work/AGENTS.md',name:'AGENTS.md',selected:false}],workspace_policy:'fallback'},null,'','AGENTS.md','','draft-id','draft-name','AGENTS.md',false,{kind:'idle',text:''},false,'',null];
  if(editing){states[0].rules=[{id:'one',name:'one',target:'AGENTS.md',size:1},{id:'two',name:'two',target:'AGENTS.md',size:1}];states[1]='one';states[2]='one';states[4]='edited';states[12]={name:'one',target:'AGENTS.md',content:'original'};}
  let i=0,resolveStatus;const calls=[];
  const ctx=vm.createContext({window:{confirm:()=>confirm},useT:()=>k=>k,useRef:v=>({current:v}),useState:()=>{const at=i++;return [states[at],v=>{states[at]=typeof v==='function'?v(states[at]):v}]},useCallback:f=>f,useEffect(){},clientCurrentCwd:()=>'/work',warnNeedPrompt(){},rulesApi:async(op,payload)=>{calls.push([op,payload]);if(op==='status')return new Promise(resolve=>{resolveStatus=resolve});if(failSave)return {ok:false,error:'write failed'};return {ok:true,selections:['/work/AGENTS.md']}},h:(type,props,...children)=>({type,props,children}),Btn:'button',noticeNode:()=>null,formatSize:()=>'',TARGETS:['AGENTS.md'],ruleLabel:r=>r.name});
  const tree=vm.runInContext(source+'\nRulesSection()',ctx);const nodes=[];
  function walk(n){if(Array.isArray(n)){n.forEach(walk);return}if(n&&typeof n==='object'){nodes.push(n);walk(n.children)}}walk(tree);
  return {states,nodes,calls,finishStatus:()=>resolveStatus(failStatus?{ok:false,error:'read failed'}:{...states[0],ok:true})};
}
test('saved workspace selection remains busy through the authoritative status refresh',async()=>{
  const f=fixture();const check=f.nodes.find(n=>n.type==='input'&&n.props.type==='checkbox');
  const pending=check.props.onChange({target:{checked:true}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.states[8],true);assert.equal(f.states[0].cwd_candidates[0].selected,true);
  f.finishStatus();await pending;assert.equal(f.states[8],false);assert.match(f.states[9].text,/已保存/);
});
test('successful write with failed refresh retains saved selection and distinguishes read failure',async()=>{
  const f=fixture({failStatus:true});const check=f.nodes.find(n=>n.type==='input'&&n.props.type==='checkbox');
  const pending=check.props.onChange({target:{checked:true}});await new Promise(resolve=>setImmediate(resolve));f.finishStatus();await pending;
  assert.equal(f.states[0].cwd_candidates[0].selected,true);assert.equal(f.states[9].kind,'ok');assert.match(f.states[9].text,/读取失败/);
});
test('failed create preserves the entered rule ID and name',async()=>{
  const f=fixture({failSave:true});const create=f.nodes.find(n=>n.type==='button'&&n.children.includes('btn.create'));
  create.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.states[5],'draft-id');assert.equal(f.states[6],'draft-name');assert.equal(f.states[9].kind,'error');
});

 test('dirty rule warns and switching does not discard without confirmation',()=>{const f=fixture({editing:true});assert.ok(f.nodes.some(n=>n.children.includes('有未保存修改 · 切换规则前请保存')));f.nodes.find(n=>n.props?.key==='two').props.onClick();assert.equal(f.calls.length,0);assert.equal(f.states[4],'edited');});
test('successful save marks the captured draft as saved',async()=>{const f=fixture({editing:true});const save=f.nodes.find(n=>n.type==='button'&&n.children.includes('btn.saveRule'));save.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.states[12].content,'edited');f.finishStatus();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.states[8],false);});
