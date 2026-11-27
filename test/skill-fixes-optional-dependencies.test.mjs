import test from 'node:test'
import assert from 'node:assert/strict'
import { fixesForIssue, toolNameOfPath } from '../lib/redteam/skill-fixes.js'

test('NetSpy remains an optional user-supplied binary and is not presented as setup-managed', () => {
  const path = '$DSH_HOME/redteam/toolkit/netspy/netspy'
  assert.equal(toolNameOfPath(path), 'netspy')
  const fix = fixesForIssue({ kind: 'path-missing', skill: 'netspy-recon', paths: [path] })
  assert.match(fix, /可选/)
  assert.match(fix, /官方/)
  assert.match(fix, /netspy-recon/)
  assert.doesNotMatch(fix, /setup\.sh --yes/)
})
