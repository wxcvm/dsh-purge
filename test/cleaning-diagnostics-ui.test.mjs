import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = client.indexOf('function patchRowsOf(state) {')
const end = client.indexOf('function PatchGroups({ state }) {', start)
assert.ok(start >= 0 && end > start, 'cleaning view helper functions must exist')
const context = {}
runInNewContext(
  'function statusLabel(st, t) { return t("status." + st); }\n'
  + client.slice(start, end)
  + '\nthis.cleaning = {patchRowsOf, tallyPatches, cleaningPatchMatches, cleaningDiagnosticText};',
  context,
)
const { patchRowsOf, tallyPatches, cleaningPatchMatches, cleaningDiagnosticText } = context.cleaning
const t = (key) => ({
  'status.applied': '已应用', 'status.pending': '待处理',
  'status.unmatched': '未匹配', 'status.skipped': '跳过',
}[key] || key)
const state = {
  ai_base: 'D:\\Apps\\DeepSeekHarness\\resources\\app',
  dsh_home: 'C:\\Users\\Test\\.dsh',
  plugin_version: '1.1.92-wxcvm.4',
  surface: 'desktop',
  patch_status: { 5: 'applied', 11: 'pending', 13: 'unmatched', 20: 'skipped' },
  patches: [
    { id: 5, ids: [5], status: 'applied', layer: 'Code', title: 'Prompt assembler' },
    { id: 11, ids: [11], status: 'pending', layer: 'Tools', title: 'Tool runner' },
    { id: 13, ids: [13, 14], status: 'unmatched', layer: 'Prompt', title: 'Memory injection' },
    { id: 20, ids: [20], status: 'skipped', layer: 'Code', title: 'Legacy compatibility' },
  ],
  shim_cmd: 'patched', shim_ps1: 'n/a', shim_bin: 'missing',
  has_backup: true,
  apply_progress: { active: false, kind: 'apply', stage: 'done', error: '未匹配 #13' },
  override_content: 'CONFIDENTIAL PROMPT BODY SHOULD NOT BE COPIED',
  rules_content: 'CONFIDENTIAL RULE BODY SHOULD NOT BE COPIED',
}

test('cleaning search matches patch numbers, titles and layers', () => {
  const rows = patchRowsOf(state)
  assert.equal(rows.length, 4)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, '#14', 'all', t)).length, 1)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, 'memory', 'all', t)).length, 1)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, 'tools', 'all', t)).length, 1)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, 'not found', 'all', t)).length, 0)
})

test('cleaning status filters separate pending/unmatched from skipped and applied', () => {
  const rows = patchRowsOf(state)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, '', 'issues', t)).length, 2)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, '', 'unmatched', t)).length, 1)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, '', 'skipped', t)).length, 1)
  assert.equal(rows.filter((r) => cleaningPatchMatches(r, state, '', 'applied', t)).length, 1)
  const tally = tallyPatches(rows)
  assert.equal(tally.total, 4)
  assert.equal(tally.applied, 1)
  assert.equal(tally.pending, 1)
  assert.equal(tally.unmatched, 1)
  assert.equal(tally.skipped, 1)
})

test('cleaning diagnostic includes patch IDs, versions, shim, backup and error, never prompt/rules body', () => {
  const report = cleaningDiagnosticText(state, t)
  for (const expected of ['desktop', '1.1.92-wxcvm.4', 'D:\\Apps\\DeepSeekHarness',
    'C:\\Users\\Test\\.dsh', '#13/#14', '未匹配 #13', 'cmd=patched', '备份: 有']) {
    assert.ok(report.includes(expected), 'report missing ' + expected)
  }
  assert.ok(!report.includes(state.override_content))
  assert.ok(!report.includes(state.rules_content))
  const missing = cleaningDiagnosticText({ surface: 'web' }, t)
  assert.match(missing, /未定位/)
  assert.match(missing, /暂无可读取的补丁/)
})

test('cleaning UI exposes native search/select and explicit copy feedback', () => {
  assert.match(client, /aria-label": "搜索补丁"/)
  assert.match(client, /aria-label": "筛选补丁状态"/)
  assert.match(client, /visibleRows\.length \+ " \/ " \+ allRows\.length/)
  assert.match(client, /open\[key\] === undefined \? filtered : !!open\[key\]/)
  assert.match(client, /navigator\.clipboard\.writeText\(report\)/)
  assert.match(client, /document\.execCommand\("copy"\)/)
  assert.match(client, /复制失败，请检查剪贴板权限/)
})
