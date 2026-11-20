import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  toggleCwdSelection, readCwdSelections, planCwdRuleInject,
  filterDeselectedNativeInstructionMessages,
} from '../lib/rules.js'

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-native-instructions-'))
  const cwd = path.join(home, 'project')
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true })
  const file = path.join(cwd, 'AGENTS.local.md')
  fs.writeFileSync(file, 'Native file content, not a Purge prompt')
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return { home, cwd, file }
}
const native = (paths = ['AGENTS.local.md']) => ({
  role: 'user', content: [{ type: 'text', text: 'native instructions' }],
  source: { kind: 'agent-instructions', form: 'instructions',
    baseline: true, changes: paths.map(path => ({ action: 'set', scope: path, path })) },
})
const user = { role: 'user', content: [{ type: 'text', text: 'real user task' }], source: { kind: 'input' } }

test('without per-project user choice native Harness instructions are untouched', t => {
  const { home, cwd } = fixture(t)
  const messages = [native(), user]
  const result = filterDeselectedNativeInstructionMessages(home, cwd, messages)
  assert.equal(result.messages, messages)
  assert.equal(result.suppressed, 0)
})

test('unchecking AGENTS.local.md stops the Purge plan and native single-file message', async t => {
  const { home, cwd, file } = fixture(t)
  await toggleCwdSelection(home, file, true, cwd)
  assert.match(planCwdRuleInject(home, cwd).text, /Native file content/)
  await toggleCwdSelection(home, file, false, cwd)
  assert.deepEqual(readCwdSelections(home, cwd), [])
  assert.equal(planCwdRuleInject(home, cwd).text, '')
  const result = filterDeselectedNativeInstructionMessages(home, cwd, [native(), user])
  assert.deepEqual(result.messages, [user])
  assert.equal(result.suppressed, 1)
  assert.equal(result.mixed, 0)
  await toggleCwdSelection(home, file, true, cwd)
  assert.equal(filterDeselectedNativeInstructionMessages(home, cwd, [native(), user]).suppressed, 0)
})

test('mixed host messages are not silently removed with unrelated global instructions', async t => {
  const { home, cwd, file } = fixture(t)
  await toggleCwdSelection(home, file, false, cwd)
  const messages = [native(['$DSH_HOME/AGENTS.md', 'AGENTS.local.md']), user]
  const result = filterDeselectedNativeInstructionMessages(home, cwd, messages)
  assert.equal(result.messages, messages)
  assert.equal(result.suppressed, 0)
  assert.equal(result.mixed, 1)
})

test('typed source and exact project file identity are required', async t => {
  const { home, cwd, file } = fixture(t)
  await toggleCwdSelection(home, file, false, cwd)
  const namedOther = native(['CLAUDE.local.md'])
  const untyped = { ...native(), source: { kind: 'user-input' } }
  const messages = [namedOther, untyped, user]
  assert.equal(filterDeselectedNativeInstructionMessages(home, cwd, messages).messages, messages)
  const other = path.join(home, 'unrelated')
  fs.mkdirSync(path.join(other, '.git'), { recursive: true })
  assert.equal(filterDeselectedNativeInstructionMessages(home, other, [native()]).suppressed, 0)
})

test('native source filter is connected to actual agent pre-step wrapper', () => {
  const code = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(code, /rules\.filterDeselectedNativeInstructionMessages\(home, cwd, withoutMnemon\)/)
  assert.match(code, /ctx\.on\("agent\/pre-step", wrap, \{ global: true, prepend: true \}\)/)
})
