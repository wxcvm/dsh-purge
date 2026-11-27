import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installPreset } from '../lib/redteam/index.js'

function toolBlock(text, id) {
  const marker = '- id: ' + id
  const start = text.indexOf(marker)
  if (start < 0) return ''
  const rest = text.slice(start)
  const end = rest.slice(marker.length).search(/\n[ \t]*- id: /)
  return end < 0 ? rest : rest.slice(0, marker.length + end)
}

test('redteam keeps spawn enabled and disables fork across install and legacy self-heal', () => {
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'purge-redteam-fork-'))
  process.env.DSH_HOME = home
  try {
    installPreset({ force: true })
    const file = join(home, '.agent-presets', 'redteam', 'agent.cordis.yml')
    let text = readFileSync(file, 'utf8')
    assert.match(toolBlock(text, 'tool-subagent'), /disabled: false/)
    assert.match(toolBlock(text, 'tool-subagent-fork'), /disabled: true/)

    // Existing user profiles created by older Purge versions enabled fork.
    const original = text
    const start = original.indexOf('- id: tool-subagent-fork')
    const block = toolBlock(original, 'tool-subagent-fork')
    const end = start + block.length
    assert.ok(start >= 0 && end > start)
    assert.match(block, /disabled: true/)
    writeFileSync(file, original.slice(0, start)
      + block.replace('disabled: true', 'disabled: false')
      + original.slice(end), 'utf8')

    const repaired = installPreset()
    assert.equal(repaired.action, 'repaired')
    text = readFileSync(file, 'utf8')
    assert.match(toolBlock(text, 'tool-subagent'), /disabled: false/)
    assert.match(toolBlock(text, 'tool-subagent-fork'), /disabled: true/)

    assert.equal(installPreset().action, 'kept', 'the self-heal must be idempotent')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
