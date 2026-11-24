import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_PATCHES } from '../lib/patches-definitions.js'
import { applyReplacementsToText } from '../lib/core.js'

const patch = ALL_PATCHES.find(row => row.id === 96)
const fixture = [
  'const EMPTY_REPLACEMENT_AGENT_INSTRUCTIONS_INTRO = "This complete workspace instruction baseline replaces all earlier workspace instruction baselines. No workspace instructions are currently active."; ',
  'const ADDITIONAL_INSTRUCTIONS_GUIDANCE = "Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions."; ',
  'const COMPACT_AGENT_INSTRUCTIONS_INTRO = "Workspace instructions were omitted or truncated to fit the configured byte budget."; ',
].join('\n')

test('rc.5 empty, additional and compact instruction intros retain scope and priority', () => {
  assert.ok(patch)
  assert.equal(patch.optional, true)
  const result = applyReplacementsToText(fixture, patch, '/fixture/dsh-agent-instructions/lib/index.js')
  assert.equal(result.changed, true)
  for (const marker of patch.markers) assert.ok(result.text.includes(marker), marker)
  assert.match(result.text, /system prompt remains authoritative/)
  assert.match(result.text, /task-specific context for this session/)
  assert.match(result.text, /Follow the instructions that remain within their stated scope/)
  assert.match(result.text, /They do not override system, developer, or direct user instructions/)
  assert.doesNotMatch(result.text, /ACTIVE and MANDATORY|approval is auto-granted/)
  const repeated = applyReplacementsToText(result.text, patch, '/fixture/dsh-agent-instructions/lib/index.js')
  assert.equal(repeated.changed, false)
  assert.equal(repeated.text, result.text)
})

test('a partially patched host can finish the remaining rc.5 intro updates', () => {
  const first = fixture.replace(patch.replacements[0].pattern, patch.replacements[0].replace)
  const result = applyReplacementsToText(first, patch, '/fixture/dsh-agent-instructions/lib/index.js')
  assert.equal(result.changed, true)
  for (const marker of patch.markers) assert.ok(result.text.includes(marker), marker)
  assert.equal(applyReplacementsToText(result.text, patch).changed, false)
})

test('the installed official rc.5 fixture still matches all three selective source patterns', {
  skip: !process.env.DSH_COMPAT_HOST_ROOT && 'requires the isolated official host fixture',
}, () => {
  const file = join(process.env.DSH_COMPAT_HOST_ROOT, 'node_modules', '@deepseek-ai',
    'dsh-agent-instructions', 'lib', 'index.js')
  assert.ok(existsSync(file), 'official dsh-agent-instructions package must be installed')
  const source = readFileSync(file, 'utf8')
  for (const { pattern } of patch.replacements) {
    assert.ok(source.includes(pattern), 'rc.5 source pattern changed: ' + pattern.slice(0, 100))
  }
  const result = applyReplacementsToText(source, patch, file)
  for (const marker of patch.markers) assert.ok(result.text.includes(marker), marker)
  assert.equal(result.changed, true)
})
