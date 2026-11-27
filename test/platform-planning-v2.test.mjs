import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadPlatformConfig, savePlatformConfig, normalizePlanning } from '../lib/redteam/platform-config.js'
import { rankTaskCandidates, planTaskTools } from '../lib/redteam/task-tool-plan.js'

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'purge-planning-v2-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('v1 platform config reads unchanged, upgrades to v2 on save and preserves legacy paths', (t) => {
  const root = workspace(t)
  const v1 = {
    version: 1, platform: 'windows', toolkitDir: 'D:\\tools',
    binDirs: ['D:\\bin'], tools: { nmap: 'D:\\nmap.exe' },
    env: { FOFA_KEY: 'original-placeholder' }, customTools: [{ name: 'My binary', path: 'D:\\custom.exe' }],
    kaliVm: { host: '192.0.2.50', user: 'kali', port: 22 },
    notes: 'legacy config notes',
  }
  writeFileSync(join(root, 'config.json'), JSON.stringify(v1))
  const read = loadPlatformConfig(root)
  assert.equal(read.version, 1)
  assert.equal(read.tools.nmap, 'D:\\nmap.exe')
  assert.deepEqual(read.planning.preferredToolByTask, {})
  const saved = savePlatformConfig({ planning: { preferredToolByTask: { services: 'nmap', web: 'gowitness' } } }, root)
  assert.equal(saved.version, 2)
  assert.equal(saved.tools.nmap, 'D:\\nmap.exe')
  assert.deepEqual(saved.binDirs, ['D:\\bin'])
  assert.equal(saved.env.FOFA_KEY, v1.env.FOFA_KEY)
  assert.equal(saved.notes, v1.notes)
  assert.deepEqual(saved.customTools, v1.customTools)
  assert.equal(saved.kaliVm.host, v1.kaliVm.host)
  assert.deepEqual(saved.planning.preferredToolByTask, { services: 'nmap', web: 'gowitness' })
  assert.equal(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).version, 2)
  const otherSave = savePlatformConfig({ notes: 'later' }, root)
  assert.equal(otherSave.planning.preferredToolByTask.web, 'gowitness')
})

test('unknown planner preferences are ignored without modifying tool execution semantics', () => {
  const p = normalizePlanning({ preferredToolByTask: {
    web: 'gowitness', services: '../../bin/sh', fakeTask: 'nmap',
  } })
  assert.deepEqual(p.preferredToolByTask, { web: 'gowitness' })
  assert.deepEqual(normalizePlanning(), { preferredToolByTask: {} })
})

test('ranking explains observed paths, probe availability and optional user preference', (t) => {
  const root = workspace(t)
  const nmap = join(root, 'nmap.exe')
  const masscan = join(root, 'masscan.exe')
  mkdirSync(dirname(nmap), { recursive: true })
  writeFileSync(nmap, 'fixture')
  writeFileSync(masscan, 'fixture')
  const config = {
    platform: 'windows', toolkitDir: join(root, 'absent'), binDirs: [],
    tools: { nmap, masscan }, planning: { preferredToolByTask: { services: 'masscan' } },
  }
  const plan = planTaskTools('services', { root, config, env: { PATH: '' } })
  assert.equal(plan.status, 'located')
  assert.equal(plan.selected.id, 'masscan', 'explicit preference wins among located tools')
  assert.equal(plan.selected.verification, 'not-run')
  assert.ok(plan.selected.reasons.includes('用户首选工具'))
  assert.equal(plan.selected.executionStatus, 'not-run')
  assert.equal(plan.selected.capabilityVerified, false)
  assert.equal(plan.selected.dependencyStatus, 'not-checked')
  assert.ok(plan.candidates.every((c) => c.score >= 0 && Array.isArray(c.reasons)))
  const noPrefs = planTaskTools('services', { root, config: { ...config, planning: undefined }, env: { PATH: '' } })
  assert.equal(noPrefs.selected.id, 'nmap')
  const ranked = rankTaskCandidates([
    { id: 'not-found', detected: false, canProbe: true, source: 'missing' },
    { id: 'found', detected: true, canProbe: false, source: 'path' },
  ], 'not-found')
  assert.equal(ranked[0].id, 'found', 'missing preferred tool must not replace an installed option')
})

test('planner settings and ranking appear in both actual client surfaces', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const code = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(code, /aria-label': '当前任务首选工具'/)
    assert.match(code, /preferredToolByTask:/)
    assert.match(code, /taskPlan\.selected\.reasons/)
  }
})
