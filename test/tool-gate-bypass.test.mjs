import test from 'node:test'
import assert from 'node:assert/strict'
import { coerceGate, coercePost, denyDelegation, installToolGateBypass, isLeafAgent } from '../lib/tool-gate.js'

function fakeCtx() {
  const handlers = new Map()
  return {
    on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    async pre(exec, next) { return handlers.get('tools/pre-execute')(exec, next) },
    async post(exec, result, next) { return handlers.get('tools/post-execute')(exec, result, next) },
    installed() { return handlers.size },
  }
}

test('默认不安装：toolGateBypass 未显式打开时零副作用', () => {
  const ctx = fakeCtx()
  installToolGateBypass(ctx, {})
  assert.equal(ctx.installed(), 0)
  installToolGateBypass(ctx, { toolGateBypass: false })
  assert.equal(ctx.installed(), 0)
})

test('打开后 pre-execute 把 ask/deny/cancel 降级成 allow，allow 原样放行', async () => {
  const ctx = fakeCtx()
  installToolGateBypass(ctx, { toolGateBypass: true })
  assert.equal(ctx.installed(), 2)
  for (const kind of ['ask', 'deny', 'cancel', undefined]) {
    const decision = await ctx.pre({ name: 'redteam_scan_run' }, async () => (kind ? { kind } : null))
    assert.equal(decision.kind, 'allow', kind)
  }
  const passthrough = await ctx.pre({ name: 'redteam_scan_run' }, async () => ({ kind: 'allow', note: 'x' }))
  assert.deepEqual(passthrough, { kind: 'allow', note: 'x' })
})

test('下游审核器抛异常时降级放行，不变成拒绝', async () => {
  const ctx = fakeCtx()
  installToolGateBypass(ctx, { toolGateBypass: true })
  const decision = await ctx.pre({ name: 'redteam_exploit_chain' }, async () => { throw new Error('reviewer down') })
  assert.equal(decision.kind, 'allow')
})

test('post-execute 只吞掉 block，content 改写保留', async () => {
  const ctx = fakeCtx()
  installToolGateBypass(ctx, { toolGateBypass: true })
  assert.equal((await ctx.post({ name: 'x' }, {}, async () => ({ kind: 'block' }))).kind, 'accept')
  const rewritten = await ctx.post({ name: 'x' }, {}, async () => ({ kind: 'accept', content: 'trimmed' }))
  assert.deepEqual(rewritten, { kind: 'accept', content: 'trimmed' })
})

test('叶子子代理不得再派活，根代理可以', () => {
  const leaf = { session: { header: { origin: 'subagent', delegationDepth: 1 } } }
  const root = { session: { header: { origin: 'user', delegationDepth: 0 } } }
  assert.equal(isLeafAgent(leaf), true)
  assert.equal(isLeafAgent(root), false)
  assert.equal(denyDelegation({ name: 'subagent', agent: leaf }).kind, 'deny')
  assert.equal(denyDelegation({ name: 'subagent', agent: root }), null)
  assert.equal(denyDelegation({ name: 'redteam_scan_run', agent: leaf }), null)
  assert.equal(coerceGate({ kind: 'deny' }).kind, 'allow')
  assert.equal(coercePost({ kind: 'block' }).kind, 'accept')
})
