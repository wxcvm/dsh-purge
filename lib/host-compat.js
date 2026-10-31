/**
 * Small source-level adapters for DSH's public tool interfaces.
 *
 * DSH 0.2.2 requires an explicit object-openness declaration, including nested
 * authored parameter schemas. Older plugin definitions omitted it to mean an
 * open object. Preserve that meaning instead of turning it into a closed schema.
 * This module does not alter tool execution, permission checks, or activation.
 */

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function schemaMap(value) {
  if (!record(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, schema]) => [key, normalizeObjectSchemas(schema)]))
}

/**
 * Copy a JSON/authoring schema and make previously implicit open objects explicit.
 * Only schema-bearing keywords are traversed: enum/const/default are data and
 * must not be interpreted as schemas, even if a value contains a `type` field.
 */
export function normalizeObjectSchemas(schema) {
  if (!record(schema)) return schema
  const next = { ...schema }
  const objectType = schema.type === 'object'
    || (Array.isArray(schema.type) && schema.type.includes('object'))
  if (objectType && !Object.hasOwn(schema, 'additionalProperties')) next.additionalProperties = true
  for (const key of ['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas']) {
    if (Object.hasOwn(schema, key)) next[key] = schemaMap(schema[key])
  }
  for (const key of ['items', 'not', 'contains', 'if', 'then', 'else', 'propertyNames', 'additionalProperties']) {
    if (record(schema[key])) next[key] = normalizeObjectSchemas(schema[key])
  }
  for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
    if (Array.isArray(schema[key])) next[key] = schema[key].map(normalizeObjectSchemas)
  }
  return next
}

/**
 * Normalize either a public raw ToolDefinition or defineTool's property-map
 * authoring form, preserving function identity and all non-schema metadata.
 */
export function normalizeToolDefinition(definition) {
  if (!record(definition)) throw new TypeError('tool definition must be an object')
  const next = { ...definition }
  if (record(definition.parameters)) {
    const parameters = definition.parameters
    const rawSchema = typeof parameters.type === 'string' || Array.isArray(parameters.type)
      || typeof parameters.$ref === 'string'
    next.parameters = rawSchema ? normalizeObjectSchemas(parameters) : schemaMap(parameters)
  }
  if (record(definition.output)) {
    next.output = { ...definition.output }
    if (Object.hasOwn(definition.output, 'schema')) {
      next.output.schema = normalizeObjectSchemas(definition.output.schema)
    }
  }
  return next
}

/** Run the host's own defineTool compiler; never replace its input validation. */
export function defineCompatibleTool(defineTool, definition) {
  if (typeof defineTool !== 'function') throw new TypeError('host defineTool is unavailable')
  return defineTool(normalizeToolDefinition(definition))
}

/** Register using the host's own registry and preserve its exact disposer. */
export function registerCompatibleTool(registry, definition, options) {
  if (!registry || typeof registry.register !== 'function') throw new TypeError('host tool registry is unavailable')
  return registry.register(normalizeToolDefinition(definition), options)
}
