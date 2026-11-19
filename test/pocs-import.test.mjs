import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = join(root, 'scripts', 'import-armory.mjs')

test('🟢4 --pocs：本地 PoC-in-GitHub 风格 CSV 导入', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocs-'))
  const csv = join(dir, 'pocs.csv')
  writeFileSync(csv, [
    'CVE,Owner/Repo,URL',
    'CVE-2021-44228,foo/log4shell-poc,https://github.com/foo/log4shell-poc',
    'CVE-2023-44487,bar/http2-rapid-reset,https://github.com/bar/http2-rapid-reset',
    'CVE-2021-44228,qux/another,https://github.com/qux/another',
    'invalid,line,skip',
    '',
  ].join('\n'))
  execFileSync('node', [script, '--pocs', csv], { stdio: 'pipe', cwd: root })
  const out = JSON.parse(readFileSync(join(root, 'lib', 'redteam', 'cve-catalog', 'poc-links.json'), 'utf8'))
  assert.equal(out.count, 3)
  assert.ok(out.entries.every(e => e.verified === false))
  assert.ok(out.entries.some(e => e.cve === 'CVE-2021-44228' && e.repo === 'foo/log4shell-poc'))
  // 清理：poc-links.json 不应留在默认产物里
  rmSync(join(root, 'lib', 'redteam', 'cve-catalog', 'poc-links.json'))
  execFileSync('node', [script], { stdio: 'pipe', cwd: root })
  assert.equal(existsSync(join(root, 'lib', 'redteam', 'cve-catalog', 'poc-links.json')), false)
})

test('🟢4 --pocs：无效 CSV 报错退出', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocs-bad-'))
  const csv = join(dir, 'bad.csv')
  writeFileSync(csv, 'name,value\nfoo,bar\n')
  let failed = false
  try { execFileSync('node', [script, '--pocs', csv], { stdio: 'pipe', cwd: root }) }
  catch { failed = true }
  assert.ok(failed, '无可解析 CVE 行时应报错')
})
