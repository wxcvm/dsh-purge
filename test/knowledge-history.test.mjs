import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeRequest } from '../lib/redteam/knowledge-center.js'

test('document history records changes, restores old content and isolates revisions by document', t => {
  const root=mkdtempSync(join(tmpdir(),'purge-knowledge-history-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const call=(op,args={})=>knowledgeRequest(root,{op,...args})
  const a=call('knowledgeSave',{title:'笔记',body:'原文',category:'资料'}).item
  call('knowledgeSave',{...a,body:'第二版'})
  const history=call('knowledgeHistory',{id:a.id}).items
  assert.equal(history.length,1)
  const rev=history[0].revision_id
  assert.equal(call('knowledgeHistoryGet',{id:a.id,revision_id:rev}).item.body,'原文')
  const other=call('knowledgeSave',{title:'其他',body:'其他'}).item
  assert.throws(()=>call('knowledgeRestore',{id:other.id,revision_id:rev}),/历史版本不存在/)
  assert.equal(call('knowledgeRestore',{id:a.id,revision_id:rev}).item.body,'原文')
  assert.equal(call('knowledgeHistory',{id:a.id}).items.length,2)
  call('knowledgeDelete',{id:a.id})
  assert.equal(call('knowledgeExport').backup.history.length,0)
})

test('backup roundtrip preserves documents and history but never overwrites current entries', t => {
  const root=mkdtempSync(join(tmpdir(),'purge-knowledge-backup-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const call=(op,args={})=>knowledgeRequest(root,{op,...args})
  const a=call('knowledgeSave',{title:'Task notes',body:'v1',source:'task reference',favorite:true}).item
  call('knowledgeSave',{...a,body:'v2',favorite:true})
  const backup=call('knowledgeExport').backup
  assert.equal(backup.format,'purge-knowledge-v1')
  assert.equal(backup.documents.length,1)
  assert.equal(backup.history.length,1)
  const result=call('knowledgeImport',{documents:backup.documents.map(row=>({...row,history:backup.history.filter(h=>h.document_id===row.id)}))})
  const copy=result.ids[0]
  assert.notEqual(copy,a.id)
  assert.equal(call('knowledgeGet',{id:a.id}).item.body,'v2')
  assert.equal(call('knowledgeGet',{id:copy}).item.favorite,1)
  const rev=call('knowledgeHistory',{id:copy}).items[0].revision_id
  assert.equal(call('knowledgeHistoryGet',{id:copy,revision_id:rev}).item.body,'v1')
  assert.equal(call('knowledgeList').total,2)
  assert.throws(()=>call('knowledgeImport',{documents:[{title:'valid',body:'text'},{title:'',body:'bad'}]}),/无效/)
  assert.equal(call('knowledgeList').total,2)
})
