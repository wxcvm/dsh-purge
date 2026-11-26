import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  holdOwnedPresetAlive, scheduleClearOwnedSelectedDefault, cancelClearOwnedSelectedDefault,
} from '../lib/preset-default.js'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'purge-owned-preset-life-'))
  const profile = join(home, 'profiles', 'work')
  const preset = join(home, '.agent-presets', 'redteam')
  mkdirSync(profile, { recursive: true })
  mkdirSync(preset, { recursive: true })
  const file = join(profile, 'cordis.patch.yml')
  writeFileSync(file, 'selectedDefault: redteam\n')
  t.after(() => { cancelClearOwnedSelectedDefault(); rmSync(home, { recursive: true, force: true }) })
  return { home, file, preset }
}

test('hot reload preserves selected preset while any apply is active, but true unload cleans it', async t => {
  const { home, file, preset } = fixture(t)
  const ctx = { agentPresets: { async list() { return [] } } }
  const releaseOld = holdOwnedPresetAlive()
  const releaseSecond = holdOwnedPresetAlive()
  releaseOld()
  releaseOld() // duplicate effect cleanup must not decrement the other owner
  scheduleClearOwnedSelectedDefault({ ctx, dshHome: home, delayMs: 6 })
  await sleep(35)
  assert.match(readFileSync(file, 'utf8'), /selectedDefault: redteam/)
  assert.equal(existsSync(preset), true, 'one surviving apply must protect the files')

  releaseSecond()
  scheduleClearOwnedSelectedDefault({ ctx, dshHome: home, delayMs: 6 })
  await sleep(35)
  assert.match(readFileSync(file, 'utf8'), /selectedDefault: standard/)
  assert.equal(existsSync(preset), false, 'true unload removes the stale preset directory')
})

test('a new apply protects selected default even after the dispose timer starts', async t => {
  const { home, file } = fixture(t)
  let resolveList
  const ctx = { agentPresets: { list() {
    return new Promise(resolve => { resolveList = resolve })
  } } }
  const releaseOld = holdOwnedPresetAlive()
  releaseOld()
  scheduleClearOwnedSelectedDefault({ ctx, dshHome: home, delayMs: 5 })
  await sleep(25)
  assert.equal(typeof resolveList, 'function', 'async registry check must be in flight')
  const releaseReplacement = holdOwnedPresetAlive()
  resolveList([])
  await sleep(25)
  assert.match(readFileSync(file, 'utf8'), /selectedDefault: redteam/,
    'late async registry result must not clear a newly active plugin')
  releaseReplacement()
  scheduleClearOwnedSelectedDefault({ ctx: { agentPresets: { list: async () => [] } },
    dshHome: home, delayMs: 5 })
  await sleep(30)
  assert.match(readFileSync(file, 'utf8'), /selectedDefault: standard/)
})

test('a preset still declared by the host registry is never swept after transient dispose', async t => {
  const { home, file, preset } = fixture(t)
  scheduleClearOwnedSelectedDefault({ dshHome: home, delayMs: 5,
    ctx: { agentPresets: { list: async () => [{ id: 'redteam' }] } } })
  await sleep(30)
  assert.match(readFileSync(file, 'utf8'), /selectedDefault: redteam/)
  assert.equal(existsSync(preset), true)
  cancelClearOwnedSelectedDefault()
})
