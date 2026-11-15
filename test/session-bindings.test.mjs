import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bindSession, bindingViewOf, handleTargetBindingCommand } from '../lib/redteam/session-bindings.js'

test('command binds an existing session, isolates other sessions and survives reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-bind-'))
  try {
    const makeStore = () => ({ root, listEngagements: () => [{id:'a',name:'Alpha'},{id:'b',name:'Beta'}] })
    const store = makeStore()
    const a = { id: 'session-a', header: {} }, b = { id: 'session-b', header: {} }
    const child = { id:'child', header:{parentSession:a.id}, store:{ get: () => a } }
    const ctx = { get: name => name === 'redteam' ? store : undefined }
    const invoke = (session, rawInput) => handleTargetBindingCommand(ctx, { agent:{session}, rawInput })
    assert.equal(invoke(a, 'a').kind, 'success')
    assert.equal(invoke(b, 'b').kind, 'success')
    assert.equal(bindingViewOf(store,{agent:{session:child}}).bound_engagement,'a')
    assert.equal(bindingViewOf(makeStore(),{agent:{session:a}}).bound_engagement,'a')
    assert.equal(bindingViewOf(makeStore(),{agent:{session:b}}).bound_engagement,'b')
    assert.equal(invoke(a,'missing').kind,'error')
    assert.equal(invoke(undefined,'a').kind,'error')
    assert.equal(invoke(a,'status').kind,'success')
  } finally { rmSync(root,{recursive:true,force:true}) }
})

test('implicit default is not persisted', () => {
  const root = mkdtempSync(join(tmpdir(),'purge-bind-'))
  try {
    const store = {root}, exec = {agent:{session:{id:'draft',header:{}}}}
    bindSession(store,exec,'a',{persist:false})
    assert.equal(bindingViewOf(store,exec).bound_engagement,'a')
    assert.equal(bindingViewOf({root},exec).bound_engagement,null)
  } finally { rmSync(root,{recursive:true,force:true}) }
})
