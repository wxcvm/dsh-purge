import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { installPreset } from '../lib/redteam/index.js'

function toolRow(rows, id) {
  for (const row of rows || []) {
    if (row?.id === id) return row
    const nested = toolRow(row?.config, id)
    if (nested) return nested
  }
  return null
}

function readRows(file) {
  return parseDocument(readFileSync(file, 'utf8')).toJS()
}

test('redteam keeps spawn enabled and disables fork across install and legacy self-heal', () => {
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'purge-redteam-fork-'))
  process.env.DSH_HOME = home
  try {
    installPreset({ force: true })
    const file = join(home, '.agent-presets', 'redteam', 'agent.cordis.yml')
    let rows = readRows(file)
    assert.equal(toolRow(rows, 'tool-subagent')?.disabled, false)
    assert.equal(toolRow(rows, 'tool-subagent-fork')?.disabled, true)

    // Existing user profiles created by older Purge versions enabled fork.
    const original = readFileSync(file, 'utf8')
    const start = original.indexOf('- id: tool-subagent-fork')
    const next = original.indexOf('\n    - id: ', start + 1)
    assert.ok(start >= 0 && next > start)
    const block = original.slice(start, next)
    assert.match(block, /disabled: true/)
    writeFileSync(file, original.slice(0, start)
      + block.replace('disabled: true', 'disabled: false')
      + original.slice(next), 'utf8')

    const repaired = installPreset()
    assert.equal(repaired.action, 'repaired')
    rows = readRows(file)
    assert.equal(toolRow(rows, 'tool-subagent')?.disabled, false)
    assert.equal(toolRow(rows, 'tool-subagent-fork')?.disabled, true)

    assert.equal(installPreset().action, 'kept', 'the self-heal must be idempotent')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
