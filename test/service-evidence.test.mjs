import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { compareServiceConfig } from '../lib/redteam/service-config-review.js'

test('structured config comparison ignores key order and reports differences without values',()=>{
  const a='{"service":{"enabled":true,"secret":"old-value","gone":1},"port":80}'
  const b='{"port":80,"service":{"enabled":true,"secret":"new-value","added":2}}'
  const r=compareServiceConfig(a,b,'json')
  assert.deepEqual(r.counts,{added:1,removed:1,changed:1})
  assert.ok(r.paths.some(x=>x.path==='/service/secret'))
  assert.ok(!JSON.stringify(r).includes('old-value'))
  assert.ok(!JSON.stringify(r).includes('new-value'))
  assert.equal(r.runtime,'not_tested')
  assert.equal(compareServiceConfig('a: 1\nb: true','b: true\na: 1','yaml').equal,true)
  assert.equal(compareServiceConfig('a=1\r\n','a=1\n','text').equal,true)
  assert.equal(compareServiceConfig('a=1','a=2','text').counts.changed,1)
  assert.throws(()=>compareServiceConfig('a: [secret-fixture','a: 1','yaml'),/配置解析失败/)
  assert.throws(()=>compareServiceConfig('','a: 1','yaml'),/非空配置/)
})

test('log summary reports line observations, never raw text or health',()=>{
  const src=readFileSync(new URL('../lib/redteam/client.js',import.meta.url),'utf8')
  const start=src.indexOf('    function summarizeServiceLog(')
  const end=src.indexOf('    function ServiceEvidenceCard()',start)
  const summarize=runInNewContext(src.slice(start,end)+'\n;summarizeServiceLog')
  const result=summarize('2026-11-13T01:00:00Z INFO start\n2026-11-13T01:01:00Z ERROR private-fixture\nWARN retry\n',0)
  assert.equal(result.lines,3)
  assert.equal(result.errors,1)
  assert.equal(result.warnings,1)
  assert.equal(result.first,'2026-11-13T01:00:00Z')
  assert.equal(result.last,'2026-11-13T01:01:00Z')
  assert.equal(result.runtime,'not_tested')
  assert.ok(!JSON.stringify(result).includes('private-fixture'))
  assert.equal(summarize('',undefined).lines,0)
})
