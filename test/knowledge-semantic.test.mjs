import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { knowledgeRequest, openKnowledgeDb } from '../lib/redteam/knowledge-center.js'
import { semanticKnowledgeRequest } from '../lib/redteam/knowledge-semantic.js'

test('semantic index persists chunks, ranks paraphrases and invalidates on edit/delete', async t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-semantic-'))
  t.after(() => rmSync(root,{ recursive:true, force:true }))
  const a = knowledgeRequest(root,{ op:'knowledgeSave', title:'Recovery notes', body:'restore backup '.repeat(150) }).item
  const b = knowledgeRequest(root,{ op:'knowledgeSave', title:'Cooking', body:'bread recipe' }).item
  let calls = 0
  const opts = { env:{}, embed: async input => {
    calls++
    return input.map(s => /restore|Recovery|rollback/i.test(s) ? [1,0,0] : [0,1,0])
  }}
  const run = (op,args={}) => semanticKnowledgeRequest(root,{ op,...args },opts)
  assert.equal((await run('knowledgeSemanticStatus')).indexed,0)
  assert.equal((await run('knowledgeSemanticSearch',{query:'rollback'})).items.length,0)
  assert.equal(calls,0)
  assert.ok((await run('knowledgeSemanticIndex',{id:a.id})).chunks>1)
  await run('knowledgeSemanticIndex',{id:b.id})
  const result = await run('knowledgeSemanticSearch',{query:'rollback'})
  assert.equal(result.items[0].id,String(a.id))
  assert.equal(result.items[0].score,1)
  assert.deepEqual(result.items[0].reference,{source:'personal',id:String(a.id)})
  assert.match(result.items[0].snippet,/restore/)
  assert.equal((await semanticKnowledgeRequest(root,{op:'knowledgeSemanticStatus'},{env:{PURGE_EMBEDDING_MODEL:'different'}})).indexed,0)
  knowledgeRequest(root,{op:'knowledgeSave',...a,body:'changed'})
  assert.equal((await run('knowledgeSemanticStatus')).indexed,1)
  knowledgeRequest(root,{op:'knowledgeDelete',id:b.id})
  assert.equal((await run('knowledgeSemanticStatus')).indexed,0)
})

test('failed or stale embedding never replaces a valid index', async t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-semantic-race-'))
  t.after(() => rmSync(root,{recursive:true,force:true}))
  const a = knowledgeRequest(root,{op:'knowledgeSave',title:'note',body:'text'}).item
  const req={op:'knowledgeSemanticIndex',id:a.id}
  await semanticKnowledgeRequest(root,req,{env:{},embed:async xs=>xs.map(()=>[1,0])})
  await assert.rejects(semanticKnowledgeRequest(root,req,{env:{},embed:async xs=>xs.map(()=>[0,0])}),/范数/)
  assert.equal((await semanticKnowledgeRequest(root,{op:'knowledgeSemanticStatus'},{env:{}})).indexed,1)
  await assert.rejects(semanticKnowledgeRequest(root,req,{env:{},embed:async xs=>{
    knowledgeRequest(root,{op:'knowledgeSave',...a,body:'new text'})
    return xs.map(()=>[1,0])
  }}),/文档已变更/)
  assert.equal((await semanticKnowledgeRequest(root,{op:'knowledgeSemanticStatus'},{env:{}})).indexed,0)
})

test('actual loopback HTTP embedding adapter uses the configured model and Nomic prefixes', async t => {
  const root = mkdtempSync(join(tmpdir(),'purge-semantic-http-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const seen=[]
  const server=createServer(async (req,res)=>{
    const data=[]
    for await (const chunk of req) data.push(chunk)
    const body=JSON.parse(Buffer.concat(data))
    seen.push({url:req.url,...body})
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({data:body.input.map((_,index)=>({index,embedding:[1,0]})).reverse()}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const env={PURGE_EMBEDDING_PORT:String(server.address().port)}
  const a=knowledgeRequest(root,{op:'knowledgeSave',title:'reference',body:'local only'}).item
  await semanticKnowledgeRequest(root,{op:'knowledgeSemanticIndex',id:a.id},{env})
  const r=await semanticKnowledgeRequest(root,{op:'knowledgeSemanticSearch',query:'reference'},{env})
  assert.equal(r.items.length,1)
  assert.equal(seen[0].url,'/v1/embeddings')
  assert.equal(seen[0].model,'text-embedding-nomic-embed-text-v1.5')
  assert.match(seen[0].input[0],/^search_document: /)
  assert.match(seen[1].input[0],/^search_query: /)
})

test('streamed ranking preserves ties, best chunks, coverage and corrupt-index diagnostics', async t => {
  const root = mkdtempSync(join(tmpdir(), 'purge-semantic-stream-'))
  t.after(() => rmSync(root,{recursive:true,force:true}))
  const ids = []
  const opts = { env:{}, embed: async xs => xs.map(x => x.includes('special') ? [1,0] : [0,1]) }
  const run = (op,args={}) => semanticKnowledgeRequest(root,{op,...args},opts)
  for (let i=0;i<13;i++) {
    const d = knowledgeRequest(root,{op:'knowledgeSave',title:'note '+i,body:i===12?'ordinary '.repeat(160)+'special':'ordinary'}).item
    ids.push(d.id)
    await run('knowledgeSemanticIndex',{id:d.id})
  }
  const result = await run('knowledgeSemanticSearch',{query:'special'})
  assert.equal(result.indexed,13)
  assert.equal(result.returned,10)
  assert.equal(result.hasMore,true)
  assert.deepEqual(result.items.map(x=>x.id),[ids[12],...ids.slice(0,9)].map(String))
  assert.equal(result.items[0].score,1)
  const db = openKnowledgeDb(root)
  try { db.prepare("UPDATE semantic_chunks SET vector='[null,1]' WHERE document_id=?").run(ids[0]) }
  finally { db.close() }
  await assert.rejects(run('knowledgeSemanticSearch',{query:'special'}),/索引数据损坏.*文档 #/)
})
