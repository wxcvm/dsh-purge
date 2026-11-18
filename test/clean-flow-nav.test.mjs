import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const rt = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')

test('cleaning bar measures workflow progress and shows patch coverage separately', () => {
  assert.match(root, /const flowFinished = Boolean\(job && job\.stage === "done" && !job\.error && !job\.active\)/)
  assert.match(root, /const pct = flowFinished \? 100 : jobOn/)
  assert.doesNotMatch(root, /:\s*\(located && total \? Math\.round\(\(applied \/ total\)/)
  assert.match(root, /清洗流程：/)
  assert.match(root, /补丁已应用/)
  assert.match(root, /role: "progressbar", "aria-label": "清洗流程进度"/)
  assert.match(root, /flowInterrupted \? h\("p"/)
})

test('interrupted cleaning is not reported as idle or as an explicit failure', () => {
  const predicate = root.match(/const flowInterrupted = Boolean\(([^\n]+)\);/)
  assert.ok(predicate)
  const interrupted = new Function('job', 'jobOn', 'return Boolean(' + predicate[1] + ')')
  assert.equal(interrupted(null, false), false)
  assert.equal(interrupted({ stage: 'idle' }, false), false)
  assert.equal(interrupted({ stage: 'done' }, false), false)
  assert.equal(interrupted({ stage: 'patch', active: true }, true), false)
  assert.equal(interrupted({ stage: 'patch', error: 'failed' }, false), false)
  assert.equal(interrupted({ stage: 'patch', active: false }, false), true)
  assert.match(root, /job && job\.error \? "未完整完成" : flowInterrupted \? "结果未确认" : "未执行"/)
})

test('clean controls precede the patch list and respect host and update activity', () => {
  const actions = root.indexOf('className: "dshp-row dshp-clean-actions"')
  const groups = root.indexOf('h(PatchGroups, { state: s,', actions)
  assert.ok(actions >= 0 && groups > actions)
  const controls = root.slice(actions, groups)
  assert.match(controls, /disabled: jobOn \|\| updateBusy \|\| !overrideLoaded/)
  assert.equal((controls.match(/disabled: jobOn \|\| updateBusy/g) || []).length, 3)
  assert.match(root, /onRefresh: refreshPatchStatus, busy: jobOn \|\| updateBusy/)
  assert.match(root, /let actionDisabled = jobOn \|\| updateBusy/)
  assert.match(root, /disabled: jobOn \|\| updateBusy, onClick: doUninstall/)
})

test('unavailable host coverage and backup do not appear as zero or absent', () => {
  assert.match(root, /\(located \? " · 补丁已应用 "/)
  assert.match(root, /: " · 补丁状态待检测"\)/)
  assert.match(root, /s\.ok === false \|\| typeof s\.has_backup !== "boolean" \? "—"/)
})

test('overview keeps frontend identity visible when host status fails and navigates to evidence', () => {
  const start = root.indexOf('function CleanOverview(')
  const end = root.indexOf('function PurgifySection(', start)
  const h = (type, props, ...children) => ({ type, props, children })
  const render = new Function('h', 'useT', 'CLIENT_BUILD_ID', root.slice(start, end) + '\nreturn CleanOverview;')(h, () => key => key, 'frontend-build')
  const visited = []
  const onNavigate = (next) => visited.push(next)
  const failed = render({ state: { ok: false, plugin_identity: { disk: 'stale-disk' } }, receipt: { phase: 'failed' }, progressUnavailable: true, onNavigate })
  const text = JSON.stringify(failed)
  assert.match(text, /frontend-build/)
  assert.match(text, /diag.overview.unavailable/)
  assert.match(text, /diag.overview.updateFailed/)
  assert.match(text, /diag.overview.stale/)
  assert.doesNotMatch(text, /stale-disk/)
  failed.children.at(-1).children.forEach(button => button.props.onClick())
  assert.deepEqual(visited, ['runtime', 'diagnostics'])
  const current = render({ state: { ok: true, surface: 'desktop', plugin_identity: { disk: 'disk-v2', loaded: 'backend-v1' } }, receipt: { phase: 'awaiting_restart', processRestarted: false }, onNavigate })
  const currentText = JSON.stringify(current)
  assert.match(currentText, /surface.desktop/)
  assert.match(currentText, /disk-v2.*backend-v1.*frontend-build/)
  assert.match(currentText, /diag.overview.mismatch/)
  assert.match(currentText, /diag.overview.restart/)
})

test('client does not overwrite a terminal apply response with late status polling', () => {
  assert.match(root, /const actionTerminal = useRef\(false\)/)
  assert.match(root, /if \(stop \|\| !d \|\| actionTerminal\.current\) return/)
  assert.match(root, /actionTerminal\.current = true/)
  assert.match(root, /无法确认操作结果/)
})

test('redteam main section headings are real controls and each page remains navigable', () => {
  assert.match(rt, /h\('button', \{\s*type: 'button', className: 'rt-tab-group-title'/)
  assert.match(rt, /title: '打开' \+ section\.label \+ '首页'/)
  assert.match(rt, /setUI\(\{ tab: page, focus: null \}\)/)
  assert.match(rt, /\['artex', 'ARTEX'\]/)
  assert.match(rt, /else if \(st\.tab === 'artex'\) body = h\(ArtexTab, \{ engagement: eng,/)
  assert.match(rt, /onGotoAsset: \(assetId\) =>/)
  assert.match(rt, /h\('button', \{[\s\S]*?className: 'rt-tab' \+ \(activeTab === t\[0\]/)
  assert.match(rt, /const activeTab = st\.tab === 'skills' \? 'knowledge-center' : \(st\.tab === 'local-search' \|\| st\.tab === 'knowledge' \? 'env' : st\.tab\)/)
})

test('cleaning panel no longer houses ARTEX and embedded drill gets the updated navigator', () => {
  assert.doesNotMatch(root, /function ArtexLinkSection\(\)/)
  assert.match(root, /function ArtexTab\(props\)/)
  assert.match(root, /className: 'rt-tab-group-title'/)
  assert.match(rt, /fetch\('\/dsh-purge\/artex', \{ method: 'GET' \}\)/)
})


test('prompt and diagnostics are consolidated into two pages with internal tabs', () => {
  const settings = root.slice(root.indexOf('function SettingsRoot(props)'), root.indexOf('const REWIND_CSS'));
  assert.match(settings, /id: "prompt", title: "提示词管理"/);
  assert.match(settings, /id: "diagnostics", title: "诊断中心"/);
  assert.doesNotMatch(settings, /id: "profiles"|id: "runtime"/);
  assert.match(settings, /\["source", "红队主提示词"\]/);
  assert.match(settings, /\["library", "自动匹配与会话"\]/);
  assert.match(settings, /\["health", "宿主与故障"\]/);
  assert.match(settings, /\["runtime", "Provider 与运行记录"\]/);
  assert.match(settings, /profilesVisited \? h\("div", \{ className: "dshp-clean-pane", hidden: section !== "prompt" \|\| promptPane !== "library"/);
  assert.match(settings, /runtimeVisited \? h\("div", \{ className: "dshp-clean-pane", hidden: section !== "diagnostics" \|\| diagnosticsPane !== "runtime"/);
});
test('patch page explains coverage versus loaded host and treats skips separately', () => {
  assert.match(root, /当前定位宿主的磁盘补丁覆盖情况，不等于当前进程已经加载/);
  assert.match(root, /跳过＝不适用或组件缺失/);
  assert.match(root, /tally\.pending \+ tally\.unmatched/);
});
