/**
 * Restrict the local red-team workspace and its SQLite file permissions.
 * On Windows, chmod does not enforce ACLs, so permissions are not claimed
 * to be fixed there. Do not follow symlinks into user-managed locations.
 */
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'

export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return
  const stat = lstatSync(path)
  if (stat.isDirectory() && !stat.isSymbolicLink()) chmodSync(path, 0o700)
}

export function privateFile(path) {
  if (process.platform === 'win32') return
  const stat = lstatSync(path)
  if (stat.isFile() && !stat.isSymbolicLink()) chmodSync(path, 0o600)
}
