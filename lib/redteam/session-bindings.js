import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'

/** 一次调用的会话解析结果。 */
export function sessionInfoOf(exec) {
  const agent = exec && exec.agent
  const session = agent && agent.session
  if (session === undefined || session === null) return {}
  const id = session.id == null ? undefined : String(session.id)
  let parentId
  try {
    const header = session.header
    parentId = header && header.parentSession !== undefined && header.parentSession !== null
      ? String(header.parentSession)
      : undefined
  } catch { parentId = undefined }
  return { id: id, parentId: parentId, session: session }
}

/** 会话 id（兼容旧调用点）。 */
export function sessionOf(exec) {
  return sessionInfoOf(exec).id
}

/**
 * 解析"根会话"：一路沿 parentSession 走到最顶层的会话 id。
 * 主会话派出的子智能体因此共享同一个绑定键，而**不同主会话之间天然隔离**。
 * 顺手把沿途会话 id 都返回，便于把绑定缓存到子会话上。
 */
function resolveRootSession(session) {
  const chain = []
  let cur = session
  let guard = 0
  while (cur !== undefined && cur !== null && guard < 64) {
    const info = sessionInfoOf({ agent: { session: cur } })
    if (info.id === undefined) break
    chain.push(info.id)
    if (info.parentId === undefined || info.parentId === '') break
    let parent
    try {
      const store = cur.store
      parent = store && typeof store.get === 'function' ? store.get(info.parentId) : undefined
    } catch { parent = undefined }
    if (parent === undefined || parent === null) {
      /* 父会话不在内存里（被回收 / 冷启动）：父 id 本身就是稳定的根键 */
      return { rootId: info.parentId, chain: chain.concat([info.parentId]) }
    }
    cur = parent
    guard += 1
  }
  return { rootId: chain.length > 0 ? chain[chain.length - 1] : undefined, chain: chain }
}

/** 绑定键 + 会话链。 */
export function bindingKeyOf(exec) {
  const info = sessionInfoOf(exec)
  if (info.id === undefined) return { rootId: undefined, sessionId: undefined, chain: [] }
  const resolved = resolveRootSession(info.session)
  const rootId = resolved.rootId === undefined ? info.id : resolved.rootId
  return { rootId, sessionId: info.id, chain: resolved.chain }
}


const states = new WeakMap()
function stateOf(store) {
  let state = states.get(store)
  if (!state) {
    const file = typeof store.root === 'string' && store.root ? join(store.root, 'session-bindings.json') : null
    let entries = []
    if (file) {
      try { entries = JSON.parse(readFileSync(file, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    state = { file, explicit: new Map(entries), implicit: new Map() }
    states.set(store, state)
  }
  return state
}

export function sessionBindings(store) {
  const { explicit, implicit } = stateOf(store)
  return new Map([...implicit, ...explicit])
}

export function bindKeysOf(exec) {
  const { rootId, sessionId, chain } = bindingKeyOf(exec)
  return Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))
}

// Only explicit user/tool bindings survive restart; implicit defaults retain their old lifetime.
export function bindSession(store, exec, engagement, { persist = true } = {}) {
  const keys = bindKeysOf(exec)
  if (!keys.length) throw new Error('无法确定当前会话，请先创建或打开对话。')
  const state = stateOf(store)
  const next = new Map(persist ? state.explicit : state.implicit)
  for (const key of keys) next.set(key, engagement)
  if (persist && state.file) atomicWriteFileSync(state.file, JSON.stringify([...next]))
  if (persist) {
    state.explicit = next
    for (const key of keys) state.implicit.delete(key)
  } else state.implicit = next
}

export function bindingViewOf(store, exec) {
  const info = sessionInfoOf(exec)
  const { rootId, chain } = bindingKeyOf(exec)
  const bindings = sessionBindings(store)
  return {
    session_id: info.id ?? null, parent_session: info.parentId ?? null,
    root_session: rootId ?? null, session_chain: chain,
    is_subagent: info.parentId !== undefined,
    bound_engagement: rootId !== undefined ? (bindings.get(rootId) ?? null) : null,
  }
}

// The popup is a read-only catalogue; actual mutations go through the host command
// executor, which addresses the retained session and materializes its agent.
export function targetBindingOptions(store, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('缺少会话 ID')
  const current = sessionBindings(store).get(sessionId) ?? null
  const targets = store.listEngagements().filter(e => e.stats !== null)
    .map(e => ({ id: e.id, name: e.name }))
  return { ok: true, current, targets }
}

export function handleTargetBindingCommand(ctx, invocation) {
  try {
    const store = ctx.get?.('redteam') || ctx.redteam
    if (!store) throw new Error('作战台尚未启用。')
    const session = invocation?.agent?.session
    const id = session?.id ?? invocation?.agent?.sessionId
    const live = session?.id != null ? session : id != null ? ctx.get?.('sessions')?.get?.(id) : undefined
    const exec = { agent: { session: live } }
    const arg = String(invocation?.rawInput ?? '').trim()
    const list = store.listEngagements()
    const view = bindingViewOf(store, exec)
    if (!arg || arg === 'list' || arg === 'status') {
      const current = list.find(e => e.id === view.bound_engagement)
      return { kind: 'success', text: [
        '当前靶标：' + (current?.name ?? view.bound_engagement ?? '未绑定'),
        '使用 /bind <靶标 ID 或完整名称> 绑定当前对话。使用 /bind create <名称> 创建并绑定。',
        ...list.map(e => e.name + '  [' + e.id + ']'),
      ].join('\n') }
    }
    if (view.root_session == null) throw new Error('当前对话尚未创建，请先创建或打开对话后再绑定。')
    if (arg === 'unbind') {
      bindSession(store, exec, null)
      return { kind: 'success', text: '当前对话已解除靶标绑定。' }
    }
    if (arg.startsWith('create ')) {
      const name = arg.slice(7).trim()
      if (!name) throw new Error('请输入靶标名称。')
      const engagement = store.openEngagement(name, undefined, { bindCurrent: false })
      bindSession(store, exec, engagement.id)
      return { kind: 'success', text: '已创建并绑定靶标：' + engagement.name }
    }
    const exact = arg.startsWith('select ') ? arg.slice(7).trim() : null
    const hit = exact !== null ? list.find(e => e.id === exact && e.stats !== null) : list.find(e => e.id === arg) || list.find(e => e.name === arg)
    if (!hit) throw new Error('靶标不存在：' + arg + '。使用 /bind list 查看候选。')
    bindSession(store, exec, hit.id)
    return { kind: 'success', text: '当前对话已绑定靶标：' + hit.name }
  } catch (error) { return { kind: 'error', text: error.message || String(error) } }
}
