#!/usr/bin/env node
// Run explicitly by the operator. Never changes active proxy or system routes.
import { verifyModeBExit } from '../lib/redteam/proxy-mode-b-verify.js'

const args = process.argv.slice(2)
const params = {}
let valid = true
for (let i = 0; i < args.length; i += 2) {
  if (!['--expected-exit-ip', '--root'].includes(args[i]) || !args[i + 1]) {
    valid = false
    break
  }
  params[args[i]] = args[i + 1]
}
if (!valid || !params['--expected-exit-ip']) {
  console.error('用法: node scripts/mode-b-verify.mjs --expected-exit-ip <VPS2公网IPv4> [--root <DSH_HOME/redteam目录>]')
  process.exitCode = 2
} else {
  try {
    await verifyModeBExit(params['--expected-exit-ip'], { root: params['--root'] })
    console.log('PASS: Purge 插件 HTTP 出口匹配预期 VPS2 公网 IPv4。')
    console.log('NOT TESTED: 机场/VPS1 逐跳证据、外部 MCP、模型 API、Windows TUN 和宿主机 DNS/IPv6。')
  } catch {
    console.error('FAIL: 模式 B 出口不符合要求或链路不可用；未将失败视为直连许可。')
    process.exitCode = 1
  }
}
