/**
 * Search/read existing bundled skills and optionally installed AboutSecurity skills.
 * No network calls and no automatic installation.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundled = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'redteam')
const homeOf = (home) => home || process.env.DSH_HOME || join(homedir(), '.dsh')
export const aboutSecurityDir = (home) => join(homeOf(home), 'redteam', 'external-skills', 'aboutsecurity', 'skills')
/** Separate on-disk community packs; never install or execute them while listing. */
export const communitySkillsDir = (home) => join(homeOf(home), 'redteam', 'external-skills', 'community')

const QUARANTINED_SKILL_NAMES = new Map([
  ['credential-attack', '旧版凭据爆破、离线破解与凭据复用流程'],
  ['credential-to-access', '旧版凭据转访问与写入型后续流程'],
  ['fscan-intranet', '旧版批量内网扫描、凭据尝试与漏洞利用流程'],
  ['gogo-intranet', '旧版广域主动测绘、模板执行与代理隧道流程'],
  ['dir-bruteforce', '旧版目录爆破及凭据/利用跟进流程'],
  ['nuclei-scan', '旧版主动漏洞模板与默认凭据检查流程'],
  ['chisel-tunnel', '目标侧隧道与多跳转发流程'],
  ['frp-tunnel', '目标侧长期隧道与持久化流程'],
  ['suo5-tunnel', '基于 WebShell 的目标侧隧道流程'],
  ['webshell-toolkit', 'WebShell 生成、上传与管理流程'],
  ['shell-handler', '反向 Shell 与载荷投递流程'],
  ['vps-reverse-shell', '反向 Shell、载荷投递与会话控制流程'],
  ['lateral-movement', '凭据复用、横向移动与凭据转储流程'],
  ['privesc', '权限提升执行流程'],
  ['payload-c2', '载荷、C2 与目标侧通道流程'],
  ['safe-exploit', '漏洞触发与可能造成服务影响的利用流程'],
  ['unauth-exploit', '未授权访问后的数据读取与写入型利用流程'],
  ['read-to-rce', '从读取权限升级到命令执行的流程'],
  ['file-upload', '上传绕过与可执行文件落地流程'],
  ['deserialize', '反序列化载荷与命令执行流程'],
  ['ssrf-xxe', 'SSRF/XXE 内网访问与写入型利用流程'],
  ['web-midware', '中间件主动漏洞利用与敏感信息提取流程'],
  ['web-injection', '注入漏洞主动利用流程'],
  ['xss-csrf', '可改变目标状态的脚本与请求伪造流程'],
  ['auth-attack', '认证绕过与身份切换攻击流程'],
  ['ad-attack', '目录服务攻击与凭据/会话获取流程'],
  ['exploitdb-lookup', '可直接复用的 EXP 正文与目标参数化说明'],
  ['cn-proxy-pool', '代理轮换与规避封锁流程'],
  ['active-scan', '旧版主动扫描组合流程'],
  ['recon-pipeline', '旧版多工具主动测绘流水线'],
  ['netspy-recon', '尚未审查的主动网络测绘流程'],
  ['asset-deep-scan', '尚未审查的批量深度扫描流程'],
])

function skillSafety(key, role, source) {
  const normalizedKey = String(key || '').replace(/^redteam:/, '')
  const leaf = normalizedKey.split('/').at(-1) || ''
  const reason = QUARANTINED_SKILL_NAMES.get(leaf)
    || (['exploit', 'internal'].includes(String(role || '').toLowerCase())
      ? '该角色的旧版技能包含目标侧执行或高影响操作；尚无逐项审查的专用适配器。'
      : null)
  return {
    role: role || null,
    quarantined: Boolean(reason),
    ...(reason ? { quarantineReason: reason } : {}),
    executionPolicy: reason ? 'quarantined-reference-only'
      : (source === 'redteam' ? 'reference-only' : 'untrusted-reference-only'),
  }
}

let sourceManifestCache = null
function bundledSourceMeta(filename) {
  if (sourceManifestCache === null) {
    try {
      const manifest = JSON.parse(readFileSync(join(bundled, 'source-manifest.json'), 'utf8'))
      sourceManifestCache = {
        source: manifest.source || {},
        files: new Map((manifest.files || []).map((entry) => [entry.local, entry])),
      }
    } catch {
      sourceManifestCache = { source: {}, files: new Map() }
    }
  }
  const entry = sourceManifestCache.files.get(filename)
  if (!entry) return null
  const source = sourceManifestCache.source
  return {
    repository: source.repository || null,
    url: source.url || null,
    revision: source.revision || null,
    version: source.version || null,
    license: source.license || null,
    verifiedAt: source.verifiedAt || null,
    commitUrl: source.url && source.revision ? source.url + '/commit/' + source.revision : null,
    adoption: entry.adoption || 'adapted',
    upstreamPath: entry.upstream || null,
    upstreamBlobSha: entry.upstreamBlobSha || null,
  }
}

function walk(root, fn) {
  const pending = [root]
  while (pending.length) {
    const dir = pending.pop()
    let items
    try { items = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const item of items) {
      const full = join(dir, item.name)
      // External repos may have symlinks; never follow them for indexing or reading.
      if (item.isDirectory()) pending.push(full)
      else if (item.isFile()) fn(full, item.name)
    }
  }
}

/**
 * 读 SKILL.md 的 frontmatter 标量字段。
 *
 * 支持 YAML 块标量（`description: |` / `>`）：上游 AboutSecurity 有 47 个技能用
 * 多行描述，旧实现只按 `key: value` 单行取，结果 `description` 变成字面量 "|"，
 * 面板与原生技能列表里就成了一条空描述——模型根本看不出这个技能什么时候该用。
 */
function metadata(md) {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!frontmatter) return {}
  const lines = frontmatter[1].split(/\r?\n/)
  const fields = {}
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^([a-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    const block = /^([|>])([+-]?)$/.exec(value)
    if (block) {
      /* 收集比 key 缩进更深的后续行；`|` 保留换行，`>` 折叠成空格（YAML 语义）。 */
      const collected = []
      let j = i + 1
      for (; j < lines.length; j += 1) {
        const line = lines[j]
        if (line.trim() === '') { collected.push(''); continue }
        if (!/^\s/.test(line)) break
        collected.push(line)
      }
      const indents = collected.filter((line) => line !== '').map((line) => line.match(/^\s*/)[0].length)
      const cut = indents.length ? Math.min(...indents) : 0
      const body = collected.map((line) => line.slice(cut)).join('\n').replace(/\n+$/, '')
      value = block[1] === '|' ? body : body.split(/\n+/).map((s) => s.trim()).filter(Boolean).join(' ')
      i = j - 1
    } else {
      value = value.replace(/^(["'])([\s\S]*)\1$/, '$2')
    }
    fields[key] = value
  }
  return fields
}

export function listLocalSkills({ home } = {}) {
  const list = []
  walk(bundled, (file, name) => {
    if (!name.endsWith('.md')) return
    const body = readFileSync(file, 'utf8')
    const data = metadata(body)
    const heading = /^\s*#\s+(.+)$/m.exec(body)
    const sourceMeta = bundledSourceMeta(name)
    list.push({
      key: 'redteam:' + name.slice(0, -3), source: 'redteam',
      name: name.slice(0, -3), title: heading?.[1] || name,
      description: data.description || '', file,
      ...skillSafety('redteam:' + name.slice(0, -3), data.role, 'redteam'),
      ...(sourceMeta ? { sourceMeta } : {}),
    })
  })
  const external = aboutSecurityDir(home)
  walk(external, (file, name) => {
    if (name !== 'SKILL.md') return
    const body = readFileSync(file, 'utf8')
    const data = metadata(body)
    const rel = relative(external, dirname(file)).split('\\').join('/')
    list.push({
      key: 'aboutsecurity:' + rel, source: 'aboutsecurity', name: data.name || rel.split('/').pop(),
      title: data.name || rel, description: data.description || '', file,
      ...skillSafety('aboutsecurity:' + rel, data.role, 'aboutsecurity'),
    })
  })
  // Community skill packs are indexed only after explicit local installation.
  // Layout: community/<pack>/skills/<topic>/SKILL.md or skills/<topic>.md.
  // Keys are namespaced by pack, so identical names never replace bundled skills.
  const community = communitySkillsDir(home)
  let packs = []
  try { packs = readdirSync(community, { withFileTypes: true }) } catch { /* not installed */ }
  for (const pack of packs) {
    if (!pack.isDirectory()) continue
    // Only walk skills/. A Git checkout also has .git and unrelated examples.
    const skillsRoot = join(community, pack.name, 'skills')
    walk(skillsRoot, (file, filename) => {
      const rel = relative(skillsRoot, file).split('\\').join('/')
      const isSkillFile = filename === 'SKILL.md'
      // Nested Markdown is often examples or notes; only root-level flat skills count.
      if (!isSkillFile && (rel.includes('/') || !filename.endsWith('.md') || /^(readme|license|changelog|index)\.md$/i.test(filename))) return
      const id = isSkillFile ? relative(skillsRoot, dirname(file)).split('\\').join('/')
        : rel.slice(0, -3)
      if (!id || id === '.') return
      const body = readFileSync(file, 'utf8')
      const data = metadata(body)
      const heading = /^\s*#\s+(.+)$/m.exec(body)
      list.push({
        key: 'redteam:community/' + pack.name + '/' + id, source: 'redteam',
        name: data.name || id.split('/').at(-1),
        title: heading?.[1] || data.name || id,
        description: data.description || '', file, communitySource: pack.name,
        ...skillSafety('redteam:community/' + pack.name + '/' + id, data.role, 'community'),
      })
    })
  }
  return list
}

export function searchLocalSkills(query, { home, limit = 10 } = {}) {
  const skills = listLocalSkills({ home })
  const terms = String(query || '').toLowerCase().trim().split(/[\s,，]+/).filter(Boolean)
  const results = skills.map((s) => {
    let score = terms.length === 0 ? 1 : 0
    const name = s.name.toLowerCase()
    const text = (s.title + ' ' + s.description + ' ' + s.key).toLowerCase()
    for (const term of terms) {
      if (name === term) score += 50
      else if (name.includes(term)) score += 20
      else if (text.includes(term)) score += 8
    }
    return { skill: s, score }
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.key.localeCompare(b.skill.key))
  const take = Math.max(1, Math.min(50, Number(limit) || 10))
  return {
    total: results.length, count: Math.min(results.length, take),
    aboutsecurity_installed: skills.some((s) => s.source === 'aboutsecurity'),
    items: results.slice(0, take).map(({ skill: s }) => ({
      key: s.key, name: s.name, title: s.title,
      description: s.quarantined ? '此技能已隔离；旧版正文不向模型开放，仅保留索引供人工审查。' : s.description,
      source: s.source, role: s.role || null, quarantined: s.quarantined === true,
      execution_policy: s.executionPolicy,
      ...(s.quarantineReason ? { quarantine_reason: s.quarantineReason } : {}),
      ...(s.sourceMeta ? { source_meta: s.sourceMeta } : {}),
      ...(s.communitySource ? { community_source: s.communitySource } : {}),
    })),
  }
}

export function readLocalSkill(key, { home, maxChars = 16000 } = {}) {
  const skill = listLocalSkills({ home }).find((entry) => entry.key === key)
  if (!skill) throw new Error('skill not found: ' + String(key || ''))
  if (skill.quarantined) {
    return {
      key: skill.key, name: skill.name, source: skill.source,
      role: skill.role || null, quarantined: true,
      quarantineReason: skill.quarantineReason,
      executionPolicy: 'quarantined-reference-only',
      contentTrust: 'quarantined',
      content: [
        '# Skill 已隔离',
        '',
        '该技能包含未经当前工具契约审查的目标侧执行或高影响操作说明。旧版正文不会提供给模型，也不会授予任何工具执行凭证。',
        '不得据此生成命令、访问目标、尝试凭据、部署载荷/隧道、执行漏洞利用或修改目标状态。',
        '原始文件仅保留在仓库中供维护者离线审查；请改用当前已审查的只读资料或专用适配器。',
      ].join('\\n'),
      truncated: false,
    }
  }
  const markdown = readFileSync(skill.file, 'utf8')
  const n = Math.max(1000, Math.min(100000, Number(maxChars) || 16000))
  return {
    key: skill.key, name: skill.name, source: skill.source,
    role: skill.role || null, quarantined: false,
    executionPolicy: skill.executionPolicy,
    contentTrust: skill.source === 'redteam' ? 'reference-only' : 'untrusted-reference-only',
    ...(skill.sourceMeta ? { sourceMeta: skill.sourceMeta } : {}),
    ...(skill.communitySource ? { community_source: skill.communitySource } : {}),
    content: markdown.slice(0, n), truncated: markdown.length > n,
  }
}
