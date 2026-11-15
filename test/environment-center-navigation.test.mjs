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
