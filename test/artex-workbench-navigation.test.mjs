import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { DDL, RedteamStore, dispatch } from '../lib/redteam/store-core.js'

test('assets can be located by exact DSH ID without confusing equal IPs in different segments', (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(DDL)
  db.exec("INSERT INTO asset (id, segment_cidr, ip) VALUES (11, '192.0.2.0/24', '192.0.2.5'), (23, '192.0.2.0/25', '192.0.2.5')")
  const store = {
    db: () => db,
    assetChildren: RedteamStore.prototype.assetChildren,
    assetRow: RedteamStore.prototype.assetRow,
    listAssets: RedteamStore.prototype.listAssets,
  }
  const result = dispatch(store, { op: 'assets', engagement: 'target-a', asset_id: 23, limit: 100 })
  assert.equal(result.ok, true)
  assert.equal(result.total, 1)
  assert.deepEqual(result.items.map(x => x.id), [23])
  const absent = dispatch(store, { op: 'assets', engagement: 'target-a', asset_id: 999, limit: 100 })
  assert.equal(absent.total, 0)
  assert.equal(dispatch(store, { op: 'assets', engagement: 'target-a', asset_id: -5 }).ok, false)
})

test('ARTEX matching links route into the chosen engagement asset and local findings tabs', () => {
  const ui = readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8')
  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  for (const source of [ui, bundle]) {
    assert.match(source, /props\.onGotoAsset\(candidate\.dsh_asset_id\)/)
    assert.match(source, /props\.onGotoFindings\(candidate\.dsh_asset_id\)/)
    assert.match(source, /tab: 'assets', focus: \{ engagement: eng, kind: 'asset', assetId \}/)
    assert.match(source, /tab: 'findings', focus: \{ engagement: eng, kind: 'vulns', assetId \}/)
    assert.match(source, /focusAssetId: st\.focus && st\.focus\.engagement === eng/)
    assert.match(source, /asset_id: focusAssetId \|\| undefined/)
    assert.match(source, /查看该资产漏洞/)
    assert.match(source, /返回 ARTEX/)
    assert.match(source, /artexSession && artexSession.engagement === eng/)
    assert.match(source, /onReportChange: \(nextReport\) => setArtexSession/)
    assert.match(source, /const report = props.report \|\| null/)
    assert.match(source, /props.onReportChange\(result\)/)
  }
})

test('failed ARTEX SARIF replacement keeps the current report and handoff state', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const begin = source.indexOf('const reviewFile = async (event) => {')
    const end = source.indexOf('const refresh = () => {', begin)
    assert.ok(begin >= 0 && end > begin, 'ARTEX report handler exists')
    const handler = source.slice(begin, end)
    assert.doesNotMatch(handler, /props\.onReportChange\(null\)/,
      'do not discard a successful report before validating a replacement')
    assert.match(handler, /if \(!response\.ok \|\| !result \|\| result\.ok === false\)/)
    assert.match(handler, /setHandoffMessage\(''\)\s+props\.onReportChange\(result\)/,
      'handoff state resets only when the replacement has parsed')
    assert.match(source, /\(maskArtex \? '报告读取失败，详情已隐藏。' : reportError\) \+ \(report \? '（当前报告已保留）' : ''\)/)
  }
})

test('ARTEX refresh ignores superseded replies and clears stale online state on HTTP failure', async () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8')
    const begin = src.indexOf('      const artexRefreshRevision = React.useRef(0)')
    const end = src.indexOf('      React.useEffect(() => { refresh(); loadPaths() }, [])', begin)
    assert.ok(begin >= 0 && end > begin, path)
    let state = { online: true }, error = '', busy = false
    const pending = []
    const refresh = new Function('React', 'refreshKnowledge', 'setBusy', 'setError', 'setState', 'fetch',
      src.slice(begin, end) + '\nreturn refresh')(
      { useRef: current => ({ current }) }, () => {}, v => { busy = v },
      v => { error = v }, v => { state = v },
      () => new Promise(resolve => pending.push(resolve)))
    const old = refresh(), latest = refresh()
    pending[1]({ ok: false, json: async () => ({ error: 'unavailable' }) })
    await latest
    assert.equal(state, null)
    assert.equal(error, 'unavailable')
    assert.equal(busy, false)
    pending[0]({ ok: true, json: async () => ({ online: true }) })
    await old
    assert.equal(state, null)
    assert.equal(error, 'unavailable')
    const retry = refresh()
    pending[2]({ ok: true, json: async () => ({ online: true }) })
    await retry
    assert.deepEqual(state, { online: true })
    assert.equal(error, '')
    assert.equal(busy, false)
  }
})

test('platform refresh retains unsaved selection while recording persisted configuration', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8')
    const start = src.indexOf('        intelSourcesWriteQueue.then(() => api({ op:')
    const end = src.indexOf('      const toggleSource =', start)
    assert.ok(start >= 0 && end > start, path)
    const code = src.slice(start, end)
    assert.match(code, /setSavedSources\(r.selection\)\s+if \(sourceDirty.current\) return\s+sourceDraft.current = r.selection/)
    assert.match(code, /sourceDirty.current = true\s+sourceDraft.current = next/)
    assert.match(code, /if \(revision === sourceRevision.current\) \{\s+sourceDirty.current = false/)
  }
})

test('confirmed ARTEX exposes a direct link to its Purge intelligence tab in source and bundle', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8')
    const start = src.indexOf("h('h4', { style: { margin: 0 } }, 'ARTEX 联合工作台 · 本机联动')")
    const end = src.indexOf("error ? h('p', { className: 'rt-err'", start)
    assert.ok(start >= 0 && end > start, path)
    const toolbar = src.slice(start, end)
    assert.match(toolbar, /state && state\.online \? h\('a'/)
    assert.match(toolbar, /http:\/\/127\.0\.0\.1:8787\/function\/sync\?tab=purge-intel/)
    assert.match(toolbar, /打开 ARTEX 情报同步/)
    assert.match(toolbar, /打开 ARTEX'/)
  }
})

test('changing or reloading ARTEX pairing invalidates stale company overview', () => {
  for (const path of ['../lib/redteam/client.js', '../client.js']) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8')
    const panelStart = src.indexOf('function ArtexIntelPanel(props)')
    const panelEnd = src.indexOf('function ArtexProjectOverview(props)', panelStart)
    const parentStart = src.indexOf('function ArtexTab(props)')
    assert.ok(panelStart >= 0 && panelEnd > panelStart && parentStart >= 0)
    const panel = src.slice(panelStart, panelEnd)
    const parent = src.slice(parentStart)
    assert.match(panel, /setConfig\(r\); setPairToken\(''\); setPairCompany[^\n]*\n\s*props\.onPairingChange\?\.\(\)/)
    assert.match(panel, /const reload = \(\) => \{\s*props\.onPairingChange\?\.\(\)/)
    assert.match(parent, /onPairingChange: \(\) => setPairingRevision\(v => v \+ 1\)/)
    assert.match(parent, /key: \(props\.engagement \|\| 'none'\) \+ ':' \+ pairingRevision/)
  }
})

function readinessViews(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const helper = (name, next) => {
    const start = source.indexOf('function ' + name + '(')
    const end = source.indexOf('function ' + next + '(', start)
    assert.ok(start >= 0 && end > start, name + ' must exist in ' + file)
    const h = (tag, props, ...children) => ({ tag, props, children })
    return new Function('h', source.slice(start, end) + '\nreturn ' + name)(h)
  }
  return { local: helper('ArtexLocalReadiness', 'ArtexTab'), pairing: helper('ArtexIntelPairingStatus', 'ArtexIntelPanel') }
}

function readinessText(tree) {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(readinessText).join(' ')
  return tree ? readinessText(tree.children) : ''
}

test('ARTEX readiness distinguishes health, zero files, path adoption and untested execution', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const { local } = readinessViews(file)
    const confirmed = { state: 'detected', online: true, version: '0.6.0', httpStatus: 200, tools: [] }
    const zero = readinessText(local({ state: confirmed }))
    assert.match(zero, /ARTEX 本机服务已确认 · 0.6.0 · HTTP 200/)
    assert.match(zero, /本机工具文件 已发现 0 个/)
    assert.match(zero, /DSH 路径采用 采用 0 个 ARTEX 路径/)
    assert.match(zero, /工具执行验证 未检查/)
    assert.match(zero, /不影响服务身份判断/)
    const found = readinessText(local({ state: { ...confirmed, tools: [
      { id: 'sample-1', reused: true, path: 'secret-path' },
      { id: 'sample-2', reused: false },
    ] }, busy: true }))
    assert.match(found, /下方为上次结果/)
    assert.match(found, /本机工具文件 已发现 2 个/)
    assert.match(found, /DSH 路径采用 采用 1 个 ARTEX 路径/)
    assert.doesNotMatch(found, /secret-path/)
    const incomplete = readinessText(local({ state: { ...confirmed, tools: undefined } }))
    assert.match(incomplete, /本机工具文件 未取得清单/)
    assert.match(incomplete, /DSH 路径采用 未确认/)
    assert.doesNotMatch(incomplete, /0 个/)
    const candidate = readinessText(local({ state: { state: 'service_candidate', httpStatus: 200, tools: [] } }))
    assert.match(candidate, /尚未确认是 ARTEX · HTTP 200/)
    assert.doesNotMatch(candidate, /本机服务已确认/)
    assert.match(readinessText(local({ failed: true })), /读取失败，状态未知/)
    assert.match(readinessText(local({ busy: true })), /正在检测/)
    assert.match(readinessText(local({})), /尚未检测/)
  }
})

test('ARTEX pairing says unconfigured only after the configuration reports it', () => {
  for (const file of ['../lib/redteam/client.js', '../client.js']) {
    const { pairing } = readinessViews(file)
    const failed = readinessText(pairing({ failed: true }))
    assert.match(failed, /配置读取失败/)
    assert.doesNotMatch(failed, /未配置/)
    assert.match(readinessText(pairing({ loading: true })), /读取中/)
    const unconfigured = readinessText(pairing({ config: { configured: false } }))
    assert.match(unconfigured, /未配置独立情报令牌或公司 ID/)
    assert.match(unconfigured, /不影响本机服务检测/)
    const configured = { configured: true, companyId: 12 }
    assert.match(readinessText(pairing({ config: configured })), /公司 #12 · 本机配置已记录/)
    assert.match(readinessText(pairing({ config: configured })), /尚未检测两端配对/)
    assert.doesNotMatch(readinessText(pairing({ config: configured, pairing: { ok: true } })), /尚未检测两端配对/)
    assert.match(readinessText(pairing({})), /尚未读取配对配置/)
  }
})
