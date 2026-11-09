/**
 * 插件级设置（零依赖）：目前只有一项 —— **并发执行智能体上限**。
 *
 * 为什么不用环境变量：`REDTEAM_MAX_AGENTS` 只能启动前设，改完得重启 dsh web；
 * 而"同时派几个执行智能体"是使用中最常调的一项，面板上应该能直接改。
 * 所以落一份 JSON 到事实库根目录：`$DSH_HOME/redteam/settings.json`。
 *
 * 生效顺序：settings.json → 环境变量 `REDTEAM_MAX_AGENTS` → 默认 3。
 * 工具侧（redteam_agent_slot 闸门）与面板侧（「智能体」页）读的是同一份，避免两处口径漂移。
 */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** 默认并发上限（用户口径：整个项目默认 3 个执行智能体）。 */
export const DEFAULT_MAX_AGENTS = 3

/** Numeric representation boundary, not an arbitrary plugin concurrency cap. */
export const MAX_AGENTS_LIMIT = Number.MAX_SAFE_INTEGER

/** 设置文件路径（跟事实库同一个根，随事实库一起备份/迁移）。 */
export function settingsPathOf(root) {
  return join(String(root || '.'), 'settings.json')
}

/** 读全部设置（读不到/坏了都当空对象，绝不抛）。 */
export function readSettings(root) {
  try {
    if (!existsSync(settingsPathOf(root))) return {}
    const parsed = JSON.parse(readFileSync(settingsPathOf(root), 'utf8'))
    return isSettingsObject(parsed) ? parsed : {}
  } catch { return {} }
}

function isSettingsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Serialize read/merge/write and publish atomically in the same directory.
 *
 * 为什么必须是"合并写 + 独占锁 + 同目录改名"：
 *   · 只写补丁不合并 → 面板改并发上限会把别的设置整份抹掉；
 *   · 不拿锁 → 两个写入方各自 read-merge-write，后写的一方覆盖前一方的新值；
 *   · 直接写目标文件 → 进程在写一半时退出会留下半份 JSON，下次读取全线丢设置。
 *
 * 读一侧保持宽容（坏了当空对象，启动不能因为一份设置文件起不来），写一侧保持严格：
 * 既有文件是损坏 JSON / 数组 / null / 标量时直接抛错，原字节一个不动 —— 覆盖它等于
 * 把用户（或别的版本）写进去的配置静默销毁。
 * 既有的 `<settings.json>.lock` 一律报 EEXIST，绝不夺锁：持锁的可能还在写。
 */
export function writeSettings(root, patch) {
  if (!isSettingsObject(patch)) throw new TypeError('invalid settings patch: expected an object')
  const path = settingsPathOf(root)
  mkdirSync(String(root || '.'), { recursive: true })
  const lock = path + '.lock'
  let lockFd
  let temp
  try {
    lockFd = openSync(lock, 'wx', 0o600)
    writeFileSync(lockFd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }) + '\n')
    let previous = {}
    let mode = 0o600
    try {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid settings.json: expected a regular file')
      mode = stat.mode & 0o777
      previous = JSON.parse(readFileSync(path, 'utf8'))
      if (!isSettingsObject(previous)) throw new TypeError('invalid settings.json: expected an object')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    /* 展开即"定义自有属性"：既有文档里的 `__proto__` 键被保留成普通键，
       既不会丢，也不会改写 Object.prototype（原型污染）。 */
    const next = { ...previous, ...patch }
    const serialized = JSON.stringify(next, null, 2) + '\n'
    temp = path + '.' + randomUUID() + '.tmp'
    const fd = openSync(temp, 'wx', mode)
    try {
      writeFileSync(fd, serialized, 'utf8')
      fsyncSync(fd)
    } finally { closeSync(fd) }
    renameSync(temp, path)
    temp = undefined
    return next
  } finally {
    if (temp !== undefined) { try { unlinkSync(temp) } catch { /* original error wins */ } }
    if (lockFd !== undefined) {
      try { closeSync(lockFd) } finally { unlinkSync(lock) }
    }
  }
}

/** 把任意输入收敛到 ≥1 的整数（【内部限制已解除】不再有上封顶）。 */
export function clampMaxAgents(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_MAX_AGENTS
  return Math.min(Math.max(n, 1), MAX_AGENTS_LIMIT)
}

/**
 * 当前生效的并发上限。
 * @param root - 事实库根目录（`ctx.redteam.root`）。
 * @param env - 环境变量表（便于测试注入）。
 * @returns 生效的整数上限。
 */
export function maxAgentsOf(root, env = process.env) {
  const fromFile = Number(readSettings(root).maxAgents)
  if (Number.isFinite(fromFile) && fromFile > 0) return clampMaxAgents(fromFile)
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return clampMaxAgents(fromEnv)
  return DEFAULT_MAX_AGENTS
}

/** 保存并发上限，返回实际生效值。 */
export function saveMaxAgents(root, value) {
  const applied = clampMaxAgents(value)
  writeSettings(root, { maxAgents: applied })
  return applied
}

/** 当前设置是从哪来的（面板上要如实说明，避免"我改了没生效"的错觉）。 */
export function maxAgentsSourceOf(root, env = process.env) {
  const fromFile = Number(readSettings(root).maxAgents)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return 'env'
  return 'default'
}
