import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('unified library has one top-level entry and keeps legacy skills routing', () => {
  for (const path of ['lib/redteam/client.js', 'client.js']) {
    const source = read(path)
    assert.match(source, /\['knowledge-center', '技能与知识库'\]/)
    assert.doesNotMatch(source, /pages: [^\n]*\['skills', '技能库'\]/)
    assert.match(source, /st\.tab === 'knowledge-center' \|\| st\.tab === 'skills'\) body = h\(LibraryTab,/)
    assert.match(source, /initialView: st\.tab === 'skills' \? 'skills' : 'search'/)
    assert.match(source, /const activeTab = activeWorkbenchTab\(st\.tab\)/)
    const start = source.indexOf('function activeWorkbenchTab(')
    const end = source.indexOf('function RtNavIcon(', start)
    assert.ok(start >= 0 && end > start)
    const selectedTab = vm.runInNewContext(source.slice(start, end) + '\nactiveWorkbenchTab')
    assert.equal(selectedTab('skills'), 'knowledge-center')
    assert.equal(selectedTab('knowledge-center'), 'knowledge-center')
    assert.match(source, /page\('skills', h\(SkillsTab/)
    assert.match(source, /page\('knowledge', h\(KnowledgeCenterTab/)
    assert.match(source, /h\(UnifiedKnowledgeTab, \{ initialSource: 'bundled' \}\)/)
  }
})

test('switching library tabs retains visited pages and original components', () => {
  const source = read('lib/redteam/client.js')
  const start = source.indexOf('    function LibraryTab(')
  const end = source.indexOf('    function IntelTab(', start)
  const state = []
  let cursor = 0
  const stub = () => null
  const ctx = vm.createContext({
    React: { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] } },
    h: (type, props, ...children) => ({ type, props, children }),
    SkillsTab: stub, KnowledgeCenterTab: stub, UnifiedKnowledgeTab: stub
  })
  const render = vm.runInContext(source.slice(start, end) + '\nLibraryTab', ctx)
  function nodes(root) { const all=[]; function walk(n){if(Array.isArray(n)){n.forEach(walk);return}if(n && typeof n === 'object'){all.push(n);walk(n.children)}} walk(root); return all }
  function page() { cursor=0; return nodes(render({refreshKey:2,initialView:'skills'})) }
  const first = page()
  assert.equal(first.find(n => n.props?.['data-library-view'] === 'skills').props.hidden, false)
  assert.equal(first.some(n => n.props?.['data-library-view'] === 'knowledge'), false)
  first.find(n => n.type === 'button' && n.children.includes('知识库')).props.onClick()
  const second = page()
  assert.equal(second.find(n => n.props?.['data-library-view'] === 'skills').props.hidden, true)
  assert.equal(second.find(n => n.props?.['data-library-view'] === 'knowledge').props.hidden, false)
  second.find(n => n.type === 'button' && n.children.includes('全库检索')).props.onClick()
  const third=page()
  assert.equal(third.find(n => n.props?.['data-library-view'] === 'knowledge').props.hidden, true)
  assert.equal(third.find(n => n.props?.['data-library-view'] === 'search').props.hidden, false)
})


test('unified library opens bundled knowledge without a search term', async () => {
  const source = read('lib/redteam/client.js')
  const start = source.indexOf('    function UnifiedKnowledgeTab(')
  const end = source.indexOf('    function knowledgeCredentialMessage(', start)
  const effects=[], calls=[]
  const ctx=vm.createContext({
    React:{useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:fn=>effects.push(fn)},
    h:(type,props,...children)=>({type,props,children}),
    api:async request=>{calls.push(request);return {ok:true,groups:[]}}
  })
  const render=vm.runInContext(source.slice(start,end)+'\nUnifiedKnowledgeTab',ctx)
  const tree=render({initialSource:'bundled'})
  effects.forEach(fn=>fn())
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1)
  assert.equal(calls[0].source,'bundled')
  assert.equal(calls[0].query,'')
  assert.match(JSON.stringify(tree),/Purge 内置知识/)
})


test('skill detail offers categorized offline references and opens the correct category', async () => {
  const source = read('lib/redteam/client.js')
  assert.match(source,/skillKnowledgeCategories = \{ recon: '安全评估'/)
  assert.match(source,/h\(UnifiedKnowledgeTab, \{ key: active, initialSource: 'bundled', initialCategory: category \}\)/)
  const start=source.indexOf('    function UnifiedKnowledgeTab('),end=source.indexOf('    function knowledgeCredentialMessage(',start)
  const effects=[],calls=[]
  const ctx=vm.createContext({React:{useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:fn=>effects.push(fn)},h:(type,props,...children)=>({type,props,children}),api:async req=>{calls.push(req);return {ok:true,groups:[]}}})
  const render=vm.runInContext(source.slice(start,end)+'\nUnifiedKnowledgeTab',ctx)
  render({initialSource:'bundled',initialCategory:'Web 安全'})
  effects.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1);assert.equal(calls[0].category,'Web 安全')
})


test('bundled pagination keeps the submitted keyword and federated results can open the full bundled list', async () => {
  const source=read('lib/redteam/client.js'), start=source.indexOf('    function UnifiedKnowledgeTab('),end=source.indexOf('    function knowledgeCredentialMessage(',start)
  const state=[],effects=[],calls=[];let cursor=0
  const ctx=vm.createContext({React:{useState(v){const i=cursor++;if(!(i in state))state[i]=v;return [state[i],next=>{state[i]=next}]},useRef:()=>({current:0}),useEffect:fn=>effects.push(fn)},h:(type,props,...children)=>({type,props,children}),api:async req=>{calls.push(req);return {ok:true,groups:[{source:'bundled',available:true,total:30,items:[],offset:req.offset,hasMore:true,categories:[]}]}}})
  const render=vm.runInContext(source.slice(start,end)+'\nUnifiedKnowledgeTab',ctx)
  function nodes(n){const all=[];function walk(x){if(Array.isArray(x)){x.forEach(walk);return}if(x&&typeof x==='object'){all.push(x);walk(x.children)}}walk(n);return all}
  const page=()=>{cursor=0;return nodes(render({initialSource:'bundled'}))}
  const settle=()=>new Promise(resolve=>setImmediate(resolve))
  page();effects.forEach(fn=>fn());await settle()
  page().find(n=>n.type==='input').props.onChange({target:{value:'new keyword'}})
  const next=page().find(n=>n.type==='button'&&n.children.includes('下一页'))
  next.props.onClick();await settle()
  assert.equal(calls.at(-1).query,'');assert.equal(calls.at(-1).offset,20)
  page().find(n=>n.type==='button'&&n.children.includes('搜索')).props.onClick();await settle()
  assert.equal(calls.at(-1).query,'new keyword');assert.equal(calls.at(-1).offset,0)
  page().find(n=>n.type==='select'&&n.props.value==='bundled').props.onChange({target:{value:'all'}});await settle()
  page().find(n=>n.type==='button'&&n.children.includes('查看该来源全部匹配')).props.onClick();await settle()
  assert.equal(calls.at(-1).source,'bundled');assert.equal(calls.at(-1).query,'new keyword');assert.equal(calls.at(-1).offset,0)
})


test('skill detail ignores late reads and errors after switching or closing a skill', async () => {
  const source=read('lib/redteam/client.js')
  const tab=source.indexOf('    function SkillsTab(')
  const start=source.indexOf('      const open = (skill) => {',tab)
  const end=source.indexOf('      /* Purpose first, source second.',start)
  assert.ok(start>tab && end>start)
  assert.match(source,/const skillReadSeq = React\.useRef\(0\)/)
  assert.match(source,/React\.useEffect\(\(\) => \(\) => \{ skillReadSeq\.current\+\+ \}, \[\]\)/)
  let active=null,detail=null,error=null,related=null
  const requests=[],skillReadSeq={current:0}
  const api=req=>new Promise((resolve,reject)=>requests.push({req,resolve,reject}))
  const open=new Function('active','skillReadSeq','setActive','setDetail','setRelatedSkill','setErr','api',source.slice(start,end)+'\nreturn open')
  const click=skill=>open(active,skillReadSeq,v=>{active=v},v=>{detail=v},v=>{related=v},v=>{error=v},api)(skill)
  const settle=()=>new Promise(resolve=>setImmediate(resolve))
  click({name:'first'});click({name:'second'})
  requests[1].resolve({ok:true,content:'SECOND'});await settle()
  requests[0].resolve({ok:true,content:'FIRST'});await settle()
  assert.equal(active,'redteam:second');assert.equal(detail.content,'SECOND')
  click({name:'third'});click({name:'fourth'})
  requests[3].resolve({ok:true,content:'FOURTH'});await settle()
  requests[2].reject(Error('late failure'));await settle()
  assert.equal(detail.content,'FOURTH');assert.equal(error,null)
  click({name:'fifth'});click({name:'fifth'})
  requests[4].resolve({ok:true,content:'FIFTH'});await settle()
  assert.equal(active,null);assert.equal(detail,null);assert.equal(related,null)
})


test('external skill source cards display license status and the installed commit', () => {
  const source = read('lib/redteam/client.js')
  assert.match(source, /sourceProvenanceText/)
  assert.match(source, /licenseStatus/)
  assert.match(source, /revision\.slice\(0, 12\)/)
  assert.match(source, /来源版本与许可证/)
})
