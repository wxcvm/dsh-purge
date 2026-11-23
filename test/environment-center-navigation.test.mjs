import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const path of ['lib/redteam/client.js', 'client.js']) {
  test(path + ': environment center groups existing views and preserves legacy survey entry', () => {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const env = src.slice(src.indexOf('function EnvTab(props)'), src.indexOf('function GuideTab(props)'))
    for (const id of ['summary', 'execution', 'tools', 'local-search', 'network', 'diagnostics']) {
      assert.ok(env.includes("['" + id + "',"))
    }
    assert.match(env, /section === 'local-search' \? h\(React\.Fragment, null,/) 
    assert.match(env, /h\(LocalAssetSearchTab, \{ engagement: props.engagement, refreshKey \}\)/)
    assert.match(env, /顶部“保存环境配置”不保存测绘操作勾选/)
    assert.match(src, /initialSection: st\.tab === 'local-search' \? 'local-search' : 'summary'/)
    assert.doesNotMatch(src, /label: '资源', pages: [^\n]*local-search/)
    assert.match(src, /op: 'intelSourcesSave'/)
    assert.match(src, /op: 'platformConfigSave'/)
  })
}

for (const path of ['lib/redteam/client.js', 'client.js']) {
  test(path + ': survey sections and read-only environment setup actions', () => {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const survey = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    for (const id of ['platforms', 'assets', 'external', 'active']) {
      assert.ok(survey.includes("surveyCard('" + id + "',"))
    }
    assert.match(survey, /surveyPage === 'assets' \? h\(React.Fragment/)
    assert.match(survey, /if \(!eng\) \{ setError\('请先选择靶标'\)/)
    assert.match(src, /onClick: loadCapabilityMatrix \}, matrixBusy \? '读取中…' : '读取环境与工具路径'/)
    assert.match(src, /推荐配置与下一步/)
    assert.match(src, /网络配置诊断/)
  })
}

for (const path of ['lib/redteam/client.js', 'client.js']) {
  test(path + ': ARTEX owns intel sync and survey links the current target', () => {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const survey = src.slice(src.indexOf('function LocalAssetSearchTab(props)'), src.indexOf('function EnvTab(props)'))
    const panel = src.slice(src.indexOf('function ArtexIntelPanel(props)'), src.indexOf('function ArtexTab(props)'))
    assert.match(survey, /打开 ARTEX 情报同步/)
    assert.doesNotMatch(survey, /op: 'scopedIntelSync'/)
    assert.match(panel, /op: 'scopedIntelInventory'/)
    assert.match(panel, /op: 'scopedIntelSync'/)
    assert.match(panel, /masked === false/)
    assert.match(panel, /companyId: config.companyId, confirm: true/)
    assert.match(src, /h\(ArtexIntelPanel, \{ key: props.engagement/)
  })
}

for (const path of ['lib/redteam/client.js', 'client.js']) {
  test(path + ': environment setup and real network checks', () => {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    assert.match(src, /onClick: fillDetectedPaths/)
    assert.match(src, /if \(!String\(next\[t\.id\] \|\| ''\)\.trim\(\)\) next\[t\.id\] = t\.path/)
    assert.match(src, /op: 'environmentNetworkProbe', kind/)
    assert.match(src, /op: 'proxyConfigTest'/)
  })
}

for (const path of ['lib/redteam/client.js', 'client.js']) {
  test(path + ': configuration draft survives refresh and merges only edited keys', () => {
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const start = src.indexOf('    function envDraftDelta(')
    const end = src.indexOf('    function EnvTab(props)', start)
    const { envDraftDelta, envDraftMerge } = new Function(src.slice(start, end) + '; return {envDraftDelta, envDraftMerge}')()
    const before = { tools: { nmap: '/old', httpx: '' }, env: { FOFA_KEY: 'old', ARTEX_HOME: '/old' }, notes: '' }
    const local = { ...before, tools: { ...before.tools, nmap: '/new' }, notes: 'unsaved' }
    const remote = { ...before, env: { ...before.env, ARTEX_HOME: '/other' }, tools: { ...before.tools, httpx: '/found' } }
    const delta = envDraftDelta(before, local)
    assert.deepEqual(delta, { tools: { nmap: '/new' }, notes: 'unsaved' })
    assert.deepEqual(envDraftMerge(remote, delta), { ...remote, tools: { nmap: '/new', httpx: '/found' }, notes: 'unsaved' })
    assert.match(src, /applyDraftFrom\(r, submitted\)/)
    assert.match(src, /key === 'tools' \|\| key === 'env' \? delta\[key\] : after\[key\]/)
  })
}
