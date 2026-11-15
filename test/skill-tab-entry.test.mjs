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
    assert.match(source, /const activeTab = st\.tab === 'skills' \? 'knowledge-center' : st\.tab/)
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
