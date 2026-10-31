import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  defineCompatibleTool,
  normalizeObjectSchemas,
  normalizeToolDefinition,
  registerCompatibleTool,
} from '../lib/host-compat.js'

test('nested legacy objects become explicitly open without mutating the original', () => {
  const input = {
    type: 'object',
    properties: {
      rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
      choice: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    },
  }
  const before = structuredClone(input)
  const output = normalizeObjectSchemas(input)
  assert.equal(output.additionalProperties, true)
  assert.equal(output.properties.rows.items.additionalProperties, true)
  assert.equal(output.properties.choice.oneOf[0].additionalProperties, true)
  assert.deepEqual(input, before)
  assert.notEqual(output, input)
})

test('explicit closed/open schemas and primitive schema values keep their meaning', () => {
  const input = { type: 'object', additionalProperties: false, properties: { open: { type: 'object', additionalProperties: true } } }
  const output = normalizeObjectSchemas(input)
  assert.equal(output.additionalProperties, false)
  assert.equal(output.properties.open.additionalProperties, true)
  assert.equal(normalizeObjectSchemas(false), false)
  assert.equal(normalizeObjectSchemas(true), true)
})

test('enum, const, and default records are values, not schema nodes', () => {
  const payload = { type: 'object', tag: 'literal payload' }
  const schema = { type: 'object', const: payload, enum: [payload], default: payload }
  const output = normalizeObjectSchemas(schema)
  assert.deepEqual(output.const, payload)
  assert.deepEqual(output.enum, [payload])
  assert.deepEqual(output.default, payload)
  assert.equal(Object.hasOwn(output.const, 'additionalProperties'), false)
})

test('raw registry definitions retain callbacks, metadata, and required fields', () => {
  const execute = async () => ({ ok: true })
  const render = (_args, value) => [{ type: 'text', text: String(value.ok) }]
  const input = {
    name: 'compat_probe', description: 'fixture only',
    parameters: { type: 'object', required: ['value'], properties: { value: { type: 'object' } } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } }, render },
    timeoutMs: 1000, execute,
  }
  const output = normalizeToolDefinition(input)
  assert.equal(output.execute, execute)
  assert.equal(output.output.render, render)
  assert.equal(output.timeoutMs, 1000)
  assert.deepEqual(output.parameters.required, ['value'])
  assert.equal(output.parameters.properties.value.additionalProperties, true)
  assert.equal(output.output.schema.additionalProperties, false)
})

test('authoring property maps preserve parameters named type and schema', () => {
  const input = {
    name: 'author_probe',
    parameters: { type: { type: 'string' }, schema: { type: 'object' } },
    output: { schema: { type: 'string' }, render: () => [] }, execute: async () => '',
  }
  const output = defineCompatibleTool(definition => definition, input)
  assert.deepEqual(output.parameters.type, { type: 'string' })
  assert.equal(output.parameters.schema.additionalProperties, true)
  assert.equal(Object.hasOwn(input.parameters.schema, 'additionalProperties'), false)
})

test('compatible registration preserves host options, receiver, and disposer', () => {
  const release = () => {}
  const options = { when: () => true }
  const registry = { register(definition, seenOptions) {
    assert.equal(this, registry)
    assert.equal(definition.parameters.additionalProperties, true)
    assert.equal(seenOptions, options)
    return release
  } }
  assert.equal(registerCompatibleTool(registry, { parameters: { type: 'object' } }, options), release)
  assert.throws(() => registerCompatibleTool(null, {}), /registry/)
  assert.throws(() => defineCompatibleTool(null, {}), /defineTool/)
})

test('optional actual host compiler accepts normalized nested schemas', {
  skip: !process.env.DSH_COMPAT_TOOLS_MODULE && !process.env.DSH_COMPAT_HOST_ROOT
    && 'set DSH_COMPAT_HOST_ROOT or DSH_COMPAT_TOOLS_MODULE to an isolated host fixture',
}, async () => {
  const specifier = process.env.DSH_COMPAT_TOOLS_MODULE
    || createRequire(join(process.env.DSH_COMPAT_HOST_ROOT, 'package.json')).resolve('@deepseek-ai/dsh-tools')
  const host = await import(specifier.startsWith('file:') ? specifier : pathToFileURL(specifier).href)
  const tool = defineCompatibleTool(host.defineTool, {
    name: 'compat_host_probe', description: 'inert schema fixture',
    parameters: { row: { type: 'object', required: true, properties: { label: { type: 'string' } } } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => 'probe',
  })
  assert.equal(tool.parameters.properties.row.additionalProperties, true)
  assert.equal(await tool.execute({ row: { label: 'fixture', extra: 'preserved' } }, {}), 'probe')
})
