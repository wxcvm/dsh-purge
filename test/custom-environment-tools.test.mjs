import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadPlatformConfig, savePlatformConfig, resolveTool, resolveAllTools, platformSummary, TOOL_CATALOG,
} from '../lib/redteam/platform-config.js'
import { probeInstalledTool } from '../lib/redteam/tool-health.js'

test('custom tool paths persist and augment built-in tools without replacing them', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-extra-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'my-tool.exe')
  writeFileSync(file, 'fixture')
  savePlatformConfig({ customTools: [
    { name: 'My Toolkit', path: file },
    { name: 'Missing CLI', path: join(root, 'missing') },
  ] }, root)
  const config = loadPlatformConfig(root)
  assert.equal(config.customTools.length, 2)
  assert.equal(config.customTools[0].name, 'My Toolkit')
  assert.equal(resolveTool('custom:0', { root }).path, file)
  assert.equal(resolveTool('custom:1', { root }).path, null)
  const all = resolveAllTools({ root })
  assert.ok(all.find((t) => t.id === 'nmap'))
  assert.equal(all.length, 25)
  assert.equal(all.at(-2).label, 'My Toolkit')
  assert.ok(platformSummary(root).tools.found >= 1)
  assert.equal(platformSummary(root).tools.items.at(-2).path, file)
  assert.equal(platformSummary(root).tools.items.at(-2).canProbe, false)
  savePlatformConfig({ notes: 'preserved' }, root)
  assert.equal(loadPlatformConfig(root).customTools.length, 2)
  const unknown = resolveTool('custom:999', { root })
  assert.equal(unknown.path, null)
})

test('blank extra-tool rows can be omitted; probe does not execute custom binary', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-extra-tools-empty-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'cli.exe')
  writeFileSync(file, 'fixture')
  const cfg = savePlatformConfig({ customTools: [{ name: '', path: '' }, { name: 'CLI', path: file }] }, root)
  assert.equal(cfg.customTools.length, 1)
  assert.equal(resolveTool('custom:0', { root }).path, file)
  const result = await probeInstalledTool('custom:0', {
    root, execFileFn: () => { throw new Error('custom tool should not be launched') },
  })
  assert.equal(result.status, 'unknown')
  assert.equal(resolveAllTools({ root }).length, 24)
  savePlatformConfig({ customTools: [] }, root)
  assert.equal(resolveAllTools({ root }).length, 23)
})


test('bulk tool discovery preserves precedence and refreshes directory snapshots between reads', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-tool-snapshot-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const toolkit = join(root, 'toolkit')
  const pathDir = join(root, 'path')
  mkdirSync(toolkit)
  mkdirSync(pathDir)
  const configured = Object.fromEntries(TOOL_CATALOG.filter(tool => tool.id !== 'nmap').map(tool => [tool.id, join(root, 'missing-' + tool.id)]))
  savePlatformConfig({ toolkitDir: toolkit, tools: configured }, root)
  const fallback = join(pathDir, 'nmap')
  const preferred = join(toolkit, 'nmap')
  writeFileSync(fallback, 'fixture')
  const options = { root, env: { PATH: pathDir, HOME: root } }
  const find = () => resolveAllTools(options).find(tool => tool.id === 'nmap')
  assert.equal(find().path, fallback)
  writeFileSync(preferred, 'fixture')
  assert.equal(find().path, preferred)
  const summary = platformSummary(root)
  assert.equal(summary.tools.found, summary.adapt.found)
  assert.equal(summary.tools.items.find(tool => tool.id === 'nmap').path, preferred)
  rmSync(preferred)
  assert.equal(find().path, fallback)
})
