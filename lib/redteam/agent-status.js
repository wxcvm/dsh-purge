/**
 * 智能体并发状态（只读、零依赖、不写盘）
 *
 * 「智能体」页和派活闸门（`redteam_agent_slot`）必须用同一套口径回答同一个问题：
 * 这个进程现在还剩下几个并发名额？谁在跑只看 subagents 注册表里**真的活着**的
 * 子会话，不看历史任务记录、不看报告里的行数。
 *
 * 这里刻意只读：不占位、不写 settings.json、不设超时、不取消任何子智能体。
 *
 * 状态字段要同时认两代宿主：
 *   · 旧版：`child.activity === 'running'`
 *   · 新版：`agents.get(child.id).status === 'running'`
 * 两者都取不到、或者取到的值认不出来 → 这一条算「未知」。
 * **绝不能猜成 idle**：猜 idle 等于把"还有名额"报给派活方，直接放开并发闸门。
 *
 * 读不到的部分用 null 表达「未知」，不用 0 冒充；`used_is_lower_bound: true`
 * 表示 `used` 只是下界（真实占用只会更多，不会更少）。
 *
 * 上限口径：每个 root 会话各有自己的并发上限（默认 3，`options.maxAgents` 可覆盖），
 * 所以**不能用各 root 上限之和去减总占用**。多个 root 时组合 `free` 一律给 null，
 * 只有单 root 且该 root 完全确定时才给出具体数字。
 */

/**
 * 默认并发上限。
 * 与 settings.js 的 DEFAULT_MAX_AGENTS 保持一致；这里不 import 是为了让本模块
 * 保持零依赖（自检只给桩上下文，不该被 fs / 别处的路径探测拖进来）。
 */
const DEFAULT_MAX_AGENTS = 3

/** `running` 就是唯一"在跑"的字面量。 */
const RUNNING = 'running'

/** 明确表示"没在跑"的取值：认这些，认不出的不猜。 */
const IDLE_STATES = new Set([
  'idle', 'stopped', 'paused', 'queued', 'pending', 'waiting',
  'done', 'completed', 'finished', 'failed', 'error', 'cancelled', 'canceled', 'aborted',
])

/** 单个 root 最多回传多少条在跑子项（面板只展示前若干条，别把响应撑爆）。 */
const RUNNING_SAMPLE_LIMIT = 20

function errorMessageOf(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'unknown error'
}

/**
 * 取一个服务。
 * `context.get(name)` 是 Cordis 的正规取法；返回 undefined（或干脆抛错）时回退到
 * `context[name]`，因为有的自检桩/老版本宿主只把服务挂在属性上。
 */
function pickService(context, name) {
  if (!context) return undefined
  if (typeof context.get === 'function') {
    let viaGet
    try {
      viaGet = context.get(name)
    } catch {
      viaGet = undefined
    }
    if (viaGet !== undefined && viaGet !== null) return viaGet
  }
  try {
    const direct = context[name]
    return direct === undefined ? undefined : direct
  } catch {
    return undefined
  }
}

/** options.maxAgents → 生效的每 root 上限；非正整数一律回落到默认值。 */
function maxAgentsFrom(options) {
  const raw = options && typeof options === 'object' ? options.maxAgents : undefined
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  return DEFAULT_MAX_AGENTS
}

/** 新版 Agent 注册表里的那一条记录（取不到就 undefined，绝不抛）。 */
function agentRecordOf(agents, id) {
  if (!agents || typeof agents.get !== 'function') return undefined
  if (id === undefined || id === null) return undefined
  try {
    return agents.get(id) || undefined
  } catch {
    return undefined
  }
}

/** 把 `running` / 明确空闲 / 认不出 三态判出来。 */
function stateOf(state) {
  if (typeof state !== 'string' || state.length === 0) return 'unknown'
  if (state === RUNNING) return 'running'
  if (IDLE_STATES.has(state)) return 'idle'
  return 'unknown'
}

/**
 * 单个子项的占位判定。
 * 旧版 `activity` 优先；没有就查新版 `agents.get(id).status`（也容忍记录里只有 activity）。
 * 两代都没有 → 'unknown'。
 */
function childStateOf(child, agents) {
  if (!child || typeof child !== 'object') return 'unknown'
  const legacy = stateOf(child.activity)
  if (legacy !== 'unknown') return legacy
  const record = agentRecordOf(agents, child.id)
  if (!record) return 'unknown'
  const modern = stateOf(record.status)
  if (modern !== 'unknown') return modern
  return stateOf(record.activity)
}

function labelOf(child, owner) {
  if (!child || typeof child !== 'object') return String(owner)
  if (typeof child.label === 'string' && child.label) return child.label
  if (child.id !== undefined && child.id !== null) return String(child.id)
  return String(owner)
}

/**
 * 读一个 root 会话下的占用。
 * 任一环节读不到都不是"0 个在跑"：置 available:false、free:null，并保留原始 error.message。
 */
async function inspectRoot(root, subagents, agents, maxAgents) {
  const id = root && root.id !== undefined && root.id !== null ? root.id : null
  const owner = id === null ? '(unknown-root)' : String(id)
  const entry = {
    kind: 'root',
    owner,
    id,
    available: false,
    used: 0,
    free: null,
    used_is_lower_bound: true,
    max: maxAgents,
    total_children: 0,
    unknown_children: 0,
    running: [],
  }
  if (!subagents || typeof subagents.listChildren !== 'function') {
    entry.error = 'subagents registry unavailable: cannot read children of ' + owner
    return entry
  }
  let children
  try {
    children = await subagents.listChildren(id)
  } catch (error) {
    /* 保留原始 message：调用方要能看出是超时、权限，还是这个 root 已经没了 */
    entry.error = errorMessageOf(error)
    return entry
  }
  if (!Array.isArray(children)) {
    entry.error = 'listChildren(' + owner + ') did not return an array'
    return entry
  }
  let running = 0
  let unknown = 0
  for (const child of children) {
    const state = childStateOf(child, agents)
    if (state === 'running') {
      running += 1
      if (entry.running.length < RUNNING_SAMPLE_LIMIT) {
        entry.running.push({ parent: owner, label: labelOf(child, owner), activity: RUNNING })
      }
    } else if (state === 'unknown') {
      unknown += 1
    }
  }
  entry.total_children = children.length
  entry.unknown_children = unknown
  entry.used = running
  entry.used_is_lower_bound = unknown > 0
  entry.available = unknown === 0
  entry.free = entry.available ? Math.max(maxAgents - running, 0) : null
  return entry
}

/**
 * 汇总所有 root 会话的并发占用。
 *
 * @param context - 插件上下文（`ctx.get(name)` 取服务），或任何带同名属性的对象。
 * @param options - `{ maxAgents? }` 每个 root 的并发上限，默认 3。
 * @returns {Promise<object>} 纯数据对象：
 *   · `ok` —— 注册表本身读没读到（读不到 false，此时 used/free 都是 null）；
 *   · `available` —— 这个"剩余名额"到底可不可信；
 *   · `used` —— 已占用的确定值；不可信时是下界，配合 `used_is_lower_bound` 读；
 *   · `free` —— 单 root 且完全确定时给数字，其余情况一律 null（别用 0 冒充）；
 *   · `per_root[]` —— 每个 root 的 owner / used / free / available / error。
 */
export async function collectAgentStatus(context, options = {}) {
  const maxAgents = maxAgentsFrom(options)
  const sessions = pickService(context, 'sessions')
  const subagents = pickService(context, 'subagents')
  const agents = pickService(context, 'agents')
  const base = {
    ok: true,
    available: false,
    used: null,
    free: null,
    used_is_lower_bound: true,
    max: maxAgents,
    roots: 0,
    per_root: [],
  }

  if (!sessions || typeof sessions.list !== 'function') {
    return Object.assign({}, base, {
      ok: false,
      error: 'sessions registry unavailable: cannot read concurrent usage.',
    })
  }
  let rows
  try {
    rows = await sessions.list()
  } catch (error) {
    return Object.assign({}, base, {
      ok: false,
      error: 'Failed to list sessions: ' + errorMessageOf(error),
    })
  }
  if (!Array.isArray(rows)) {
    /* null / undefined / 对象：注册表在，但这次没给出会话表 —— 不能当成 0 占用 */
    return Object.assign({}, base, {
      ok: false,
      error: 'sessions.list() did not return an array: concurrent usage is unknown, not zero.',
    })
  }

  const perRoot = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const header = row.header
    if (!header || typeof header !== 'object') {
      /* 缺 header 的会话行：没有 header 就判断不了它是不是 root，不能当 0 占用 */
      const id = row.id !== undefined && row.id !== null ? row.id : null
      perRoot.push({
        kind: 'malformed',
        owner: id === null ? '(unknown-row)' : String(id),
        id,
        available: false,
        used: null,
        free: null,
        used_is_lower_bound: true,
        max: maxAgents,
        total_children: 0,
        unknown_children: 0,
        running: [],
        error: 'session row is missing header: cannot tell whether it is a root or a child',
      })
      continue
    }
    /* 子会话不是 root：它们的占用已经算在各自 root 名下，重复统计会把占用翻倍 */
    if (header.parentSession !== undefined && header.parentSession !== null) continue
    perRoot.push(await inspectRoot(row, subagents, agents, maxAgents))
  }

  const rootEntries = perRoot.filter((entry) => entry.kind === 'root')
  const brokenRows = perRoot.filter((entry) => entry.kind !== 'root')

  let used = 0
  let lowerBound = brokenRows.length > 0
  for (const entry of rootEntries) {
    if (typeof entry.used !== 'number') continue
    used += entry.used
    if (entry.used_is_lower_bound) lowerBound = true
  }

  const everyRootAvailable = rootEntries.length > 0 && rootEntries.every((entry) => entry.available)
  const available = everyRootAvailable && brokenRows.length === 0
  /* 每 root 各有上限：多个 root 时"组合剩余"没有唯一分母，给 null 比给个错数强 */
  const free = rootEntries.length === 1 && brokenRows.length === 0 && rootEntries[0].available
    ? rootEntries[0].free
    : null

  return Object.assign({}, base, {
    ok: true,
    available,
    used,
    free,
    used_is_lower_bound: lowerBound,
    roots: rootEntries.length,
    per_root: perRoot,
  })
}

export default collectAgentStatus
