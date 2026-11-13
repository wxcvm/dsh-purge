import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectKnowledgeCredentials } from '../lib/redteam/knowledge-credentials.js'
import { knowledgeRequest } from '../lib/redteam/knowledge-center.js'

test('credential review flags configuration fields and credential URLs without returning values', () => {
  const fixture = 'privateKey: "TEST_KEY_NOT_REAL"\npassword: test-pass\n{"auth.token":"test-token","uuid":"00000000-0000-4000-8000-000000000001"}\nvless://test-id@example.invalid:443\n-----BEGIN PRIVATE KEY-----'
  const r = inspectKnowledgeCredentials({body:fixture})
  assert.equal(r.flagged,true)
  assert.deepEqual(new Set(r.findings.map(x=>x.kind)),new Set(['private-key','password','token-or-secret','identifier','credential-url']))
  for (const v of ['TEST_KEY_NOT_REAL','test-pass','test-token','test-id','00000000']) assert.ok(!JSON.stringify(r).includes(v))
  assert.equal(inspectKnowledgeCredentials({body:'privateKey: "\${REALITY_PRIV}"\npassword: CHANGE_ME\npublic-key: public-value\nsecret: ""'}).flagged,false)
})

test('audit counts current and historical documents without echoing contents', t => {
  const root = mkdtempSync(join(tmpdir(),'purge-credential-audit-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const call = (op,args={})=>knowledgeRequest(root,{op,...args})
  const old = call('knowledgeSave',{title:'note',body:'password: example-not-real'}).item
  assert.equal(call('knowledgeInspectStored',{id:old.id}).flagged,true)
  call('knowledgeSave',{...old,body:'clean note'})
  const a = call('knowledgeCredentialAudit')
  assert.equal(a.flagged_documents,0)
  assert.equal(a.flagged_revisions,1)
  assert.deepEqual(a.history_document_ids,[old.id])
  assert.ok(!JSON.stringify(a).includes('example-not-real'))
  assert.equal(call('knowledgeInspect',{document:{body:'safe',history:[{body:'token: test-token'}]}}).flagged,true)
})
