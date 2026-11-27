import test from 'node:test'
import assert from 'node:assert/strict'
import { describeIntelSourceStatus } from '../lib/redteam/intel-sources.js'
test('source status never exposes credentials or invents quota', () => {
  const result = describeIntelSourceStatus({ env: { FOFA_KEY: 'secret-fofa' } }, { SHODAN_API_KEY: 'secret-shodan' })
  assert.match(result.fofa.label, /已配置/)
  assert.match(result.shodan.label, /已配置/)
  assert.equal(result.fofa.quota, '未检查')
  assert.equal(result.hunter.label, '官网入口 · API 未接入')
  assert.ok(!JSON.stringify(result).includes('secret-'))
  assert.match(describeIntelSourceStatus({}, {}).shodan.label, /未配置/)
})
