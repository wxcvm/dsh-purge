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
    assert.match(env, /section === 'local-search' \? h\(LocalAssetSearchTab, \{ engagement: props.engagement, refreshKey \}\)/)
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
    assert.match(src, /onClick: loadCapabilityMatrix \}, matrixBusy \? '正在检测…' : '一键检测环境'/)
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
