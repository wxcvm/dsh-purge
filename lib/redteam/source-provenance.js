import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md']

function identifyLicense(content) {
  const text = String(content || '').replace(/^\uFEFF/, '').trimStart()
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/i.exec(text)
  if (spdx) return spdx[1]
  if (/^MIT License\b/im.test(text)) return 'MIT'
  if (/Apache License,?\s*Version 2\.0/i.test(text)) return 'Apache-2.0'
  if (/BSD 3-Clause License/i.test(text)) return 'BSD-3-Clause'
  if (/BSD 2-Clause License/i.test(text)) return 'BSD-2-Clause'
  if (/ISC License/i.test(text)) return 'ISC'
  if (/The Unlicense/i.test(text)) return 'Unlicense'
  const gpl = /GNU GENERAL PUBLIC LICENSE[\s\S]{0,160}?Version (2|3)/i.exec(text)
  if (gpl) return /or later/i.test(text) ? 'GPL-' + gpl[1] + '.0-or-later' : 'GPL-' + gpl[1] + '.0-only'
  return null
}

/** Read only a regular, bounded root license file; never follow a repository symlink. */
export function readSourceLicense(root) {
  for (const name of LICENSE_FILES) {
    let stat
    try {
      stat = lstatSync(join(root, name))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      return { license: null, licenseFile: null, licenseStatus: 'unavailable' }
    }
    if (!stat.isFile() || stat.size > 64 * 1024) {
      return { license: null, licenseFile: name, licenseStatus: 'unavailable' }
    }
    try {
      const license = identifyLicense(readFileSync(join(root, name), 'utf8'))
      return { license, licenseFile: name, licenseStatus: license ? 'identified' : 'unrecognized' }
    } catch {
      return { license: null, licenseFile: name, licenseStatus: 'unavailable' }
    }
  }
  return { license: null, licenseFile: null, licenseStatus: 'not-declared' }
}

/** Report the exact checked-out HEAD and its local root license without network access. */
export function inspectGitSource(root, execute = execFileSync) {
  let revision = null
  try {
    const output = execute('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, maxBuffer: 1024,
    })
    const value = String(output).trim()
    if (/^[a-f0-9]{40}$/i.test(value)) revision = value.toLowerCase()
  } catch { /* status remains useful even when Git metadata cannot be read */ }
  return { revision, ...readSourceLicense(root) }
}
