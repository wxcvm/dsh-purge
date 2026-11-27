/**
 * Restrict the local red-team workspace and its SQLite file permissions.
 * On Windows, chmod does not enforce ACLs, so permissions are not claimed
 * to be fixed there. Do not follow symlinks into user-managed locations.
 */
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'

export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('private storage requires a real directory')
  if (process.platform !== 'win32') chmodSync(path, 0o700)
}

export function privateFile(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('private storage requires a regular file')
  if (process.platform !== 'win32') chmodSync(path, 0o600)
}
