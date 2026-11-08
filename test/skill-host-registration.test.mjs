import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { handleSkillOp } from '../lib/redteam/ui.js'

const dir = fileURLToPath(new URL('../skills/redteam/', import.meta.url))
const path = fileURLToPath(new URL('../skills/redteam/active-scan.md', import.meta.url))
const body = readFileSync(path, 'utf8')

test('offline skill inventory does not impersonate native host registration', async () => {
  const result = await handleSkillOp({ get: () => undefined }, { op: 'skillCatalog', refresh: true })
  assert.equal(result.ok, true)
  assert.equal(result.registryState, 'unavailable')
  assert.equal(result.hostListedCount, 0)
  const skill = result.items.find((item) => item.name === 'active-scan' && item.library === 'redteam')
  assert.ok(skill)
  assert.equal(skill.hostListed, false)
  assert.ok(skill.availability === 'available' || skill.availability === 'unknown')
})

test('native scope listing is reported as a host listing but not an execution proof', async () => {
  const seen = []
  const ctx = {
    get(name) {
      if (name === 'agentPresets') return { standingKeyFor: async () => 'redteam-scope' }
      if (name === 'skills') return {
        async list(arg) {
          seen.push(['list', arg.scope])
          return [{
            name: 'active-scan', description: 'scan', library: 'redteam',
            resourceBase: { kind: 'directory', path: dir },
          }]
        },
        async get(name, arg) {
          seen.push(['get', name, arg.scope])
          return { name, content: body, path }
        },
      }
      return undefined
    },
  }
  const result = await handleSkillOp(ctx, { op: 'skillCatalog', refresh: true })
  assert.equal(result.ok, true)
  assert.equal(result.registryState, 'listed')
  assert.equal(result.hostListedCount, 1)
  assert.equal(result.items.find((item) => item.name === 'active-scan').hostListed, true)
  assert.deepEqual(seen[0], ['list', 'redteam-scope'])
})

test('an official-only native list cannot masquerade as redteam registration', async () => {
  const ctx = {
    get(name) {
      if (name === 'agentPresets') return { standingKeyFor: () => 'redteam-scope' }
      if (name === 'skills') return {
        list: async () => [{ name: 'office-doc', description: 'doc', library: 'official' }],
        get: async () => undefined,
      }
      return undefined
    },
  }
  const result = await handleSkillOp(ctx, { op: 'skillCatalog', refresh: true })
  assert.equal(result.ok, true)
  assert.equal(result.registryState, 'no-redteam')
  assert.equal(result.hostListedCount, 0)
  assert.equal(result.items.find((item) => item.name === 'active-scan').hostListed, false)
  assert.ok(result.items.some((item) => item.library === 'official'))
})
