/**
 * On-demand, separate Yaklang skill checkouts.
 * No work at startup; installation is triggered by the UI or CLI.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { communitySkillsDir } from './skill-catalog.js'

export const communityPacks = Object.freeze({
  'hack-skills': { label: 'HackSkills', remote: 'https://github.com/yaklang/hack-skills.git' },
  'yak-skills': { label: 'Yak Skills', remote: 'https://github.com/yaklang/yak-skills.git' },
})
const jobs = new Map()

const destinationOf = (home, pack) => join(communitySkillsDir(home), pack)
function countSkills(root) {
  let count = 0
  const pending = [root]
  while (pending.length) {
    const dir = pending.pop()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const item of entries) {
      if (item.isDirectory()) pending.push(join(dir, item.name))
      else if (item.isFile() && item.name === 'SKILL.md') count += 1
    }
  }
  return count
}
async function git(argv) {
  await new Promise((resolve, reject) => {
    const child = spawn('git', argv, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const append = data => { log = (log + String(data)).slice(-1200) }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Git failed (' + code + '): ' + log)))
  })
}
export function communitySkillStatus({ home } = {}) {
  const packs = Object.entries(communityPacks).map(([id, info]) => {
    const dest = destinationOf(home, id)
    const job = jobs.get(dest)
    const skills = countSkills(join(dest, 'skills'))
    const checkout = existsSync(join(dest, '.git'))
    return {
      id, label: info.label, source: 'yaklang/' + id,
      installed: checkout && skills > 0, skills,
      busy: !!job?.busy,
      phase: job?.busy ? job.phase : job?.error ? 'error' : checkout && skills > 0 ? 'ready' : 'not_installed',
      error: job?.error || null,
    }
  })
  return { ok: true, packs, busy: packs.some(p => p.busy) }
}

/** Awaits the actual operation; reusable from the CLI and unit tests. */
export async function installCommunitySkillPack({ home, pack, update = false, runGit = git } = {}) {
  if (!Object.hasOwn(communityPacks, pack)) return { ok: false, error: '未知社区技能来源' }
  const dest = destinationOf(home, pack)
  const active = jobs.get(dest)
  if (active?.busy) return { ...communitySkillStatus({ home }), ok: false, error: '技能安装或更新仍在进行' }
  if (update && !existsSync(join(dest, '.git')))
    return { ...communitySkillStatus({ home }), ok: false, error: '尚未安装该社区技能，无法更新' }
  if (!update && existsSync(dest))
    return { ...communitySkillStatus({ home }), ok: false, error: '目标目录已存在，请检查或使用更新' }

  const job = { busy: true, phase: update ? 'updating' : 'installing', error: null }
  jobs.set(dest, job)
  const stage = dest + '.install-' + process.pid + '-' + Date.now()
  try {
    if (update) {
      await runGit(['-C', dest, 'pull', '--ff-only'])
      await runGit(['-C', dest, 'sparse-checkout', 'set', 'skills'])
    } else {
      mkdirSync(communitySkillsDir(home), { recursive: true })
      await runGit(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'main',
        communityPacks[pack].remote, stage])
      await runGit(['-C', stage, 'sparse-checkout', 'set', 'skills'])
      if (!countSkills(join(stage, 'skills'))) throw new Error('上游未找到 SKILL.md')
      renameSync(stage, dest)
    }
    if (!countSkills(join(dest, 'skills'))) throw new Error('未找到有效 SKILL.md')
  } catch (error) {
    job.error = String(error?.message || error).slice(0, 600)
    if (!update) {
      try { rmSync(stage, { recursive: true, force: true }) } catch { /* cleanup only this staging path */ }
    }
  } finally {
    job.busy = false
    job.phase = job.error ? 'error' : 'ready'
  }
  return { ...communitySkillStatus({ home }), ok: !job.error, ...(job.error ? { error: job.error } : {}) }
}

/** Removes only a recognized local Git checkout for one selected pack. */
export function removeCommunitySkillPack({ home, pack } = {}) {
  if (!Object.hasOwn(communityPacks, pack)) return { ok: false, removed: false, error: '未知社区技能来源' }
  const dest = destinationOf(home, pack)
  if (jobs.get(dest)?.busy) return { ...communitySkillStatus({ home }), ok: false, removed: false, error: '技能仍在安装或更新' }
  if (!existsSync(dest)) return { ...communitySkillStatus({ home }), removed: false }
  if (!existsSync(join(dest, '.git'))) return { ...communitySkillStatus({ home }), ok: false, removed: false,
    error: '该目录不是 Git 检出；为保留本地资料，不执行删除' }
  try { rmSync(dest, { recursive: true, force: true }) }
  catch (error) { return { ...communitySkillStatus({ home }), ok: false, removed: false, error: String(error.message || error) } }
  jobs.delete(dest)
  return { ...communitySkillStatus({ home }), removed: true }
}

/** Begins the same operation without blocking the desktop bridge response. */
export function startCommunitySkillPack(options = {}) {
  const pack = options.pack
  if (!Object.hasOwn(communityPacks, pack)) return { ok: false, error: '未知社区技能来源' }
  const dest = destinationOf(options.home, pack)
  if (jobs.get(dest)?.busy) return { ...communitySkillStatus(options), ok: false, error: '技能安装或更新仍在进行' }
  if (options.update && !existsSync(join(dest, '.git')))
    return { ...communitySkillStatus(options), ok: false, error: '尚未安装该社区技能，无法更新' }
  if (!options.update && existsSync(dest))
    return { ...communitySkillStatus(options), ok: false, error: '目标目录已存在，请检查或使用更新' }
  void installCommunitySkillPack(options)
  return communitySkillStatus(options)
}
