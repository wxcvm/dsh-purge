/**
 * 子会话活动的纯函数归纳器 —— 不依赖宿主包，可单测。
 *
 * 为什么独立成文件：`tools.js` 在导入期就要解析宿主的 `@deepseek-ai/dsh-tools`，
 * 裸仓库里 import 不了；而"注册表里到底有几个在跑"这条判断恰恰是最需要单测的
 * 并发闸门前提，所以把它拆出来，tools.js 只做转出。
 */

/**
 * 把 `subagents.listChildren` 的原始行归纳成可对账的占用视图。
 *
 * 旧实现只数 `kind==='child' && activity==='running'`：新版宿主的行里没有 `kind`，
 * activity 也可能缺失 —— 结果是"看起来 0 个在跑"，并发闸门直接失效。
 * 这里改成：认得出的行按 id 去重计数，认不出的一律记进 `unknown_children`
 * 并让 `available:false`，宁可报"占用未知"，也不谎报空闲。
 */
export function summarizeChildActivity(rows) {
  const list = Array.isArray(rows) ? rows : []
  const runningIds = new Set()
  const labels = []
  let unknown = 0
  let total = 0
  for (const row of list) {
    const id = row && typeof row === 'object' && row.id !== undefined && row.id !== null ? String(row.id) : ''
    const activity = row && typeof row === 'object' ? row.activity : undefined
    if (id === '' || (activity !== 'running' && activity !== 'idle')) {
      unknown += 1
      continue
    }
    total += 1
    if (activity !== 'running' || runningIds.has(id)) continue
    runningIds.add(id)
    if (labels.length < 20) labels.push(row.label || id)
  }
  return {
    available: unknown === 0,
    running: runningIds.size,
    running_ids: [...runningIds],
    running_labels: labels,
    unknown_children: unknown,
    total_children: total,
  }
}

/** 实时并发占用：读 subagents 注册表里"真正在跑"的直接子会话数。 */
export async function liveRunningChildren(ctx, rootSessionId) {
  const viaGet = ctx && typeof ctx.get === 'function' ? ctx.get('subagents') : undefined
  const registry = viaGet === undefined || viaGet === null ? (ctx ? ctx.subagents : undefined) : viaGet
  if (registry === undefined || registry === null || typeof registry.listChildren !== 'function') {
    return {
      available: false, running: 0, running_ids: [], running_labels: [],
      unknown_children: null, identities_complete: false,
      error: 'subagents 注册表不可用（无法核对实际并发数，只能按预留计数）',
    }
  }
  try {
    const entries = await registry.listChildren(rootSessionId)
    const summary = summarizeChildActivity(entries)
    /* 读得到注册表就算 available；行本身认不全时单独用 identities_complete 标出来，
       不把"表读到了但行畸形"和"表根本没读到"混成同一件事。 */
    return { ...summary, available: true, identities_complete: summary.available }
  } catch (error) {
    return {
      available: false, running: 0, running_ids: [], running_labels: [],
      unknown_children: null, identities_complete: false,
      error: '列子会话失败：' + (error && error.message ? error.message : String(error)),
    }
  }
}
