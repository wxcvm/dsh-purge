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
  assert.match(rt, /const activeTab = st\.tab === 'local-search' \|\| st\.tab === 'knowledge' \? 'env' : st\.tab/)
})

test('cleaning panel no longer houses ARTEX and embedded drill gets the updated navigator', () => {
  assert.doesNotMatch(root, /function ArtexLinkSection\(\)/)
  assert.match(root, /function ArtexTab\(props\)/)
  assert.match(root, /className: 'rt-tab-group-title'/)
  assert.match(rt, /fetch\('\/dsh-purge\/artex', \{ method: 'GET' \}\)/)
})
