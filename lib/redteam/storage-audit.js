/**
 * Run the packaged ACL preview on demand. No caller-supplied paths, switches,
 * command strings, file contents or raw PowerShell errors cross the web bridge.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { win32 } from 'node:path'

const execFileAsync = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/protect-redteam-acl.ps1', import.meta.url))
const fields = ['inspected', 'broadRead', 'otherRead', 'inheritanceEnabled',
  'aclReadErrors', 'skippedReparse', 'enumerationErrors']

export function parseStorageAuditOutput(stdout) {
  const lines = String(stdout).split(/\r?\n/).filter(line => line.startsWith('ACL_AUDIT '))
  if (lines.length !== 1) return null
  try {
    const raw = JSON.parse(lines[0].slice('ACL_AUDIT '.length))
    if (!raw || fields.some(key => !Number.isSafeInteger(raw[key]) || raw[key] < 0)) return null
    const counts = Object.fromEntries(fields.map(key => [key, raw[key]]))
    if (['broadRead', 'otherRead', 'inheritanceEnabled'].some(key => counts[key] > counts.inspected)) return null
    if (!counts.inspected && !counts.aclReadErrors && !counts.enumerationErrors) return null
    return counts
  } catch { return null }
}

export async function inspectStorageAcl(root, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return { ok: false, status: 'unsupported' }
  if (typeof root !== 'string' || !root || !win32.isAbsolute(root)) {
    return { ok: false, status: 'unavailable' }
  }
  const run = options.run || execFileAsync
  const executable = win32.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  // Windows PowerShell must load its own built-in modules, not PowerShell 7's
  // inherited PSModulePath. Scope this to the child; never modify the parent.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.toLowerCase() !== 'psmodulepath'))
  env.PSModulePath = win32.join(win32.dirname(executable), 'Modules')
  try {
    // Process-scoped policy only for our packaged script, no profiles, shell
    // interpolation, -Apply or -Details. Never accept arguments from the API.
    const { stdout } = await run(executable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-Root', root,
    ], { windowsHide: true, timeout: 60000, maxBuffer: 65536, encoding: 'utf8', env })
    const counts = parseStorageAuditOutput(stdout)
    if (!counts) return { ok: false, status: 'invalid_response' }
    const partial = counts.aclReadErrors > 0 || counts.skippedReparse > 0 || counts.enumerationErrors > 0
    return { ok: true, status: partial ? 'partial' : 'complete', counts }
  } catch (error) {
    // Raw output and errors may contain user paths; do not serialize them.
    return { ok: false, status: error?.killed || error?.code === 'ETIMEDOUT' ? 'timeout' : 'unavailable' }
  }
}
