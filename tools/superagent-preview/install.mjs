import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw Error('此安装器仅用于 Windows')
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('需要 Node 24 或更新版本')
const root = fileURLToPath(new URL('../../', import.meta.url))
const git = (...args) => execFileSync('git', ['-C', root, ...args])
const commit = git('rev-parse', '--verify', (process.argv[2] || 'HEAD') + '^{commit}').toString().trim()
if (!/^[0-9a-f]{40}$/.test(commit)) throw Error('无效提交')
const files = [
  'tools/superagent-preview/app.js', 'tools/superagent-preview/index.html',
  'tools/superagent-preview/style.css', 'tools/superagent-preview/server.mjs',
  'tools/superagent-preview/review-worker.mjs', 'tools/superagent-preview/launch.ps1',
  'tools/superagent-preview/github-evidence.mjs',
  'lib/redteam/agent-work-items.js', 'lib/redteam/agent-work-schema.js',
  'lib/redteam/report-shareable.js',
]
const content = files.map(name => [name, git('show', commit + ':' + name)])
const check = path => {
  const stats = lstatSync(path, { throwIfNoEntry: false })
  if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) throw Error('目录不是预览自有实体目录：' + path)
  if (!stats) mkdirSync(path)
  return path
}
const home = check(resolve(process.env.LOCALAPPDATA, 'Purge-SuperAgent-Preview'))
const version = check(join(check(join(home, 'versions')), commit))
const dataDir = check(join(home, 'data'))
const digest = data => createHash('sha256').update(data).digest('hex')
function write(path, data) {
  try { writeFileSync(path, data, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST' || !lstatSync(path).isFile() || digest(readFileSync(path)) !== digest(data)) throw error
  }
}
const hashes = {}
for (const [name, bytes] of content) {
  let dir = version
  const path = name.split('/')
  const basename = path.pop()
  for (const part of path) dir = check(join(dir, part))
  write(join(dir, basename), bytes)
  hashes[name] = digest(bytes)
}
write(join(version, 'package.json'), '{"private":true,"type":"module"}\n')
const manifest = join(version, 'tools', 'superagent-preview', 'build.json')
write(manifest, JSON.stringify({ commit, sha256: hashes }, null, 2) + '\n')
console.log(JSON.stringify({ commit, installed: version, dataDir, manifest,
  launcher: join(version, 'tools', 'superagent-preview', 'launch.ps1'), copied: content.length }))