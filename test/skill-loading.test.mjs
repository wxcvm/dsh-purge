/**
 * 验收：随包红队技能库能不能被"加载 + 调用"。
 *
 * 覆盖四件事：
 *   1. 包内 `skills/redteam/*.md` 齐全，frontmatter 可解析、字段合法；
 *   2. 每条都能被 `readSkillFromRoot` 读回正文，`checkSkill` 判为 available；
 *   3. 本机 `$DSH_HOME/redteam/skills` 的安装副本与包内逐字节一致（插件启动时同步的那份）；
 *   4. 红队预设把两个技能根都挂给了宿主的 `skill-filesystem`。
 *
 * 不写入任何真实目录：只读比对，避免测试在用户机器上留垃圾。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { bundledSkillSummaries, checkSkill, readSkillFromRoot, summarizeSkills } from '../lib/redteam/skill-availability.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagedDir = join(root, 'skills', 'redteam')
const presetFile = join(root, 'presets', 'redteam', 'agent.cordis.yml')
const installedDirs = [
  process.env.DSH_HOME ? join(process.env.DSH_HOME, 'redteam', 'skills') : null,
  join(homedir(), '.dsh', 'redteam', 'skills'),
].filter(Boolean)

const skillFiles = readdirSync(packagedDir).filter((f) => f.endsWith('.md')).sort()

function frontmatterOf(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return null
  try { return parseYaml(match[1]) } catch { return null }
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')

test('随包红队技能齐全，数量与命名可对上', () => {
  assert.ok(skillFiles.length >= 40, '技能数量异常：' + skillFiles.length)
  const names = skillFiles.map((f) => f.replace(/\.md$/, ''))
  assert.equal(new Set(names).size, names.length, '存在同名技能文件')
  for (const name of names) assert.match(name, /^[a-z0-9][a-z0-9-]*$/, '技能名不是 kebab-case：' + name)
})

test('每份技能的 frontmatter 合法，且 name 与文件名一致', () => {
  const roles = new Set()
  for (const file of skillFiles) {
    const text = readFileSync(join(packagedDir, file), 'utf8')
    const meta = frontmatterOf(text)
    assert.ok(meta, file + ' 没有可解析的 frontmatter')
    assert.equal(meta.name, file.replace(/\.md$/, ''), file + ' 的 name 与文件名不一致')
    assert.equal(typeof meta.description, 'string', file + ' 缺 description')
    assert.ok(meta.description.trim().length >= 8, file + ' 的 description 太短')
    assert.notEqual(meta.enabled, false, file + ' 被标记为 enabled:false，宿主不会列出它')
    if (meta.role) roles.add(String(meta.role))
    const body = text.replace(/^---[\s\S]*?---/, '').trim()
    assert.ok(body.length > 40, file + ' 正文过短，疑似只有元数据')
  }
  assert.ok(roles.size >= 3, '技能角色维度异常：' + [...roles].join(','))
})

test('每条技能都能被读回正文，并判定为 available', () => {
  const results = skillFiles.map((file) => {
    const name = file.replace(/\.md$/, '')
    const loaded = readSkillFromRoot(packagedDir, name)
    assert.ok(loaded && loaded.content.length > 0, name + ' 读不到正文')
    assert.equal(loaded.path, join(packagedDir, file))
    return checkSkill({ name, content: loaded.content, path: loaded.path, root: packagedDir }, { env: {} })
  })
  assert.equal(results.length, skillFiles.length)
  const statuses = results.map((r) => r.status)
  assert.ok(statuses.every((s) => s === 'available'), '存在不可用技能：' + JSON.stringify(results.filter((r) => r.status !== 'available').map((r) => [r.name, r.status])))
  const summary = summarizeSkills(results)
  assert.equal(summary.total, skillFiles.length)
  assert.equal(summary.available, skillFiles.length)
  assert.equal(summary.broken, 0)
})

test('本机安装副本与包内逐字节一致（插件同步过的就是能加载的那份）', { skip: !installedDirs.some((dir) => existsSync(dir)) && '本机尚未安装 $DSH_HOME/redteam/skills' }, () => {
  const dir = installedDirs.find((candidate) => existsSync(candidate))
  const installed = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  assert.deepEqual(installed, skillFiles, '安装目录与包内文件清单不一致（需要重启插件触发同步）')
  for (const file of skillFiles) {
    assert.equal(sha(readFileSync(join(dir, file))), sha(readFileSync(join(packagedDir, file))), file + ' 内容与包内不一致')
  }
})

test('技能摘要把 frontmatter 的 description 带出来，而不是文件名或英文 H1', () => {
  const summaries = bundledSkillSummaries()
  assert.equal(summaries.length, skillFiles.length, '摘要数量与包内技能文件不一致')
  for (const file of skillFiles) {
    const name = file.replace(/\.md$/, '')
    const summary = summaries.find((s) => s.name === name)
    assert.ok(summary, name + ' 没有出现在 bundledSkillSummaries() 里')
    const meta = frontmatterOf(readFileSync(join(packagedDir, file), 'utf8'))
    assert.equal(summary.description, meta.description, name + ' 的摘要描述没有取 frontmatter.description')
    if (meta.whenToUse) assert.equal(summary.whenToUse, meta.whenToUse, name + ' 丢了 whenToUse')
    if (meta.enabled === false) assert.equal(summary.enabled, false, name + ' 丢了 enabled:false')
    assert.equal(summary.library, 'redteam')
    assert.ok(summary.resourceBase && summary.resourceBase.kind === 'directory')
  }
})

test('红队预设把两个技能根挂给宿主的 skill-filesystem', () => {
  const text = readFileSync(presetFile, 'utf8')
  assert.match(text, /id:\s*skill-filesystem/, '预设里没有 skill-filesystem')
  assert.match(text, /id:\s*tool-skill/, '预设里没有 tool-skill（缺了它模型就拿不到 skill 工具）')
  assert.ok(text.includes("dshHomePath('skills')"), '预设没有挂 $DSH_HOME/skills')
  assert.ok(text.includes("dshHomePath('redteam/skills')"), '预设没有挂 $DSH_HOME/redteam/skills')
  const order = text.indexOf("dshHomePath('skills')") < text.indexOf("dshHomePath('redteam/skills')")
  assert.ok(order, '技能根顺序不对：$DSH_HOME/skills 必须排在 redteam/skills 之前（同名取先出现的）')
})
