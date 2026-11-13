import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * A management-only SSH connectivity check for an operator's own hosts.
 * Host aliases are defined in the user's OpenSSH configuration.
 * This module never exports a proxy or changes redteam tool routing.
 */
const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
const MAX_JUMPS = 4

export function buildAdminProbeArgs(target, jumps = []) {
  if (typeof target !== 'string' || !ALIAS.test(target)) throw new Error('Invalid target SSH alias')
  if (!Array.isArray(jumps) || jumps.length > MAX_JUMPS ||
      jumps.some((alias) => typeof alias !== 'string' || !ALIAS.test(alias))) {
    throw new Error('Invalid jump aliases (maximum 4)')
  }
  const hosts = [...jumps, target]
  if (new Set(hosts.map((host) => host.toLowerCase())).size !== hosts.length) {
    throw new Error('Duplicate SSH aliases in route')
  }
  const args = [
    '-T', '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'PermitLocalCommand=no',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
  ]
  if (jumps.length) args.push('-J', jumps.join(','))
  args.push('--', target, 'true')
  return args
}

/** Read the saved preferences without loading unrelated credentials or starting SSH. */
export function readSavedAdminRoute(root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'redteam')) {
  let config
  try {
    config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
  } catch (error) {
    throw new Error(error.code === 'ENOENT'
      ? 'No saved Purge configuration; save the management route in Environment settings first'
      : 'Cannot read saved Purge configuration')
  }
  const route = config?.vpsAdminRoute
  if (!route || !route.target) throw new Error('No saved management route; save a target SSH alias first')
  if (typeof route.target !== 'string' || !Array.isArray(route.jumps) ||
      route.jumps.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid saved management route')
  }
  const target = route.target.trim()
  const jumps = route.jumps.map((item) => item.trim())
  buildAdminProbeArgs(target, jumps)
  return { target, jumps }
}

export function parseArgs(argv, loadSaved = readSavedAdminRoute) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--saved') return loadSaved()
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 2) {
    throw new Error('Usage: node scripts/vps-admin-check.mjs --saved | TARGET [JUMP1,JUMP2]')
  }
  const [target, via] = argv
  const jumps = via === undefined ? [] : via.split(',')
  buildAdminProbeArgs(target, jumps)
  return { target, jumps }
}

export async function checkAdminRoute(target, jumps = [], runner = execFile) {
  const args = buildAdminProbeArgs(target, jumps)
  const start = Date.now()
  return new Promise((resolve) => {
    runner('ssh', args, {
      timeout: 35000, windowsHide: true, maxBuffer: 64 * 1024,
    }, (error) => {
      resolve({
        ok: !error,
        target,
        jumps: [...jumps],
        durationMs: Date.now() - start,
        evidence: { scope: 'ssh_management', command: 'true', status: error ? 'failed' : 'verified', application: 'not_tested', udp: 'not_tested', egress: 'not_tested' },
        error: error ? (error.killed ? 'timeout' : 'ssh-failed') : null,
      })
    })
  })
}

async function main() {
  try {
    const { target, jumps } = parseArgs(process.argv.slice(2))
    const result = await checkAdminRoute(target, jumps)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
