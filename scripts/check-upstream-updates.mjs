/** Manual public-upstream check. Does not fetch Git objects, install or change settings. */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkUpstreams, githubUpstreamRequest } from '../lib/upstream-status.js'
import { publicUpstreamRefs, updateProxy } from '../lib/update-network.js'
import { proxyUrlOf } from '../lib/redteam/proxy-network.js'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function main(argv) {
  let proxy = null, hostPackage = ''
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i + 1]) throw new Error('expected --proxy URL or --host-package PATH')
    if (argv[i] === '--proxy') {
      const u = new URL(argv[i + 1])
      if (!['http:', 'https:', 'socks5:'].includes(u.protocol) || u.pathname !== '/' || u.search || u.hash) throw new Error('invalid proxy URL')
      proxy = { enabled: true, protocol: u.protocol.slice(0, -1), host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : 1080)), username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
    } else if (argv[i] === '--host-package') hostPackage = argv[i + 1]
    else throw new Error('unknown option')
  }
  let localHostVersion = ''
  if (hostPackage) {
    const pkg = JSON.parse(fs.readFileSync(hostPackage, 'utf8'))
    if (pkg.name !== '@deepseek-ai/dsh-desktop-host') throw new Error('not a desktop host package')
    localHostVersion = pkg.version
  }
  const result = await checkUpstreams({ request: githubUpstreamRequest(proxy), localHostVersion,
    observePublic: source => publicUpstreamRefs(source, { proxyUrl: proxyUrlOf(proxy) || updateProxy() }),
    containsCommit: sha => {
      const r = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, windowsHide: true, timeout: 5000, stdio: 'ignore' })
      return r.status === 0 ? true : r.status === 1 ? false : null
    } })
  return { ...result, localPluginVersion: JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).version }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); if (!result.ok) process.exitCode = 1 })
    .catch(() => { process.stderr.write('Upstream check failed; verify options, paths and network. No files modified.\n'); process.exitCode = 1 })
}
