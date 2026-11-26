import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const path of ['lib/redteam/client.js', 'client.js']) {
  test(path + ': startup overview never equates a path or a version check with task success', () => {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    const begin = source.indexOf('    function envToolReadiness(')
    const end = source.indexOf('    function EnvTab(props)', begin)
    assert.ok(begin >= 0 && end > begin, 'readiness helpers must be present in the served client')
    const { envToolReadiness, envToolSummary } = new Function(
      source.slice(begin, end) + '\nreturn { envToolReadiness, envToolSummary }'
    )()
    const tools = [
      { id: 'verified', path: '/tools/verified', canProbe: true },
      { id: 'failed', path: '/tools/failed', canProbe: true },
      { id: 'unchecked', path: '/tools/unchecked', canProbe: true },
      { id: 'pathOnly', path: '/tools/path-only', canProbe: false },
      { id: 'missing', path: null, canProbe: true },
    ]
    const probes = {
      verified: { status: 'runnable' },
      failed: { status: 'timeout' },
      missing: { status: 'runnable' }, // old evidence must not override a missing path
    }
    assert.deepEqual(envToolSummary(tools, probes), {
      total: 5, located: 4, verified: 1, unchecked: 1, 'path-only': 1, failed: 1, missing: 1,
    })
    assert.equal(envToolReadiness(tools[2], { status: 'path-only' }), 'unchecked')
    assert.equal(envToolReadiness(tools[0], { status: 'probe_verified' }), 'verified')
    assert.equal(envToolReadiness(tools[4], probes.missing), 'missing')

    const view = source.slice(end, source.indexOf('function GuideTab(props)', end))
    assert.match(view, /开工前 · 环境速检/)
    assert.match(view, /版本命令成功都不等于实际任务成功/)
    assert.match(view, /当前检查结果仍基于已保存配置/)
    assert.match(view, /读取环境与工具路径/)
    assert.match(view, /onClick: \(\) => showToolStatus\(filter\)/)
    assert.match(view, /工具验证状态筛选/)
    assert.match(view, /toolStatusFilter === 'all' \|\| envToolReadiness/)
    assert.match(view, /仅对本轮任务需要的工具按需验证版本/)
  })
}
