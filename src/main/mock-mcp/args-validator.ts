/**
 * JSON Schema validation of `tools/call` arguments against the tool's own
 * `inputSchema` — the user's schema, verbatim (no zod round-trip).
 *
 * Draft-07 by default (ajv's default dialect, same as the HTTP mock's
 * schema validation); a schema that declares `$schema` 2020-12 / 2019-09 is
 * compiled with the matching ajv dialect. MCP 2025-11-25 makes 2020-12 the
 * default dialect, but the common subset (type/properties/required/enum/…)
 * behaves identically under draft-07. `format` is not enforced (no
 * ajv-formats) — a mock should not be stricter than the servers it imitates.
 */

import Ajv, { type ValidateFunction } from 'ajv'
import Ajv2019 from 'ajv/dist/2019'
import Ajv2020 from 'ajv/dist/2020'
import type { JsonSchemaObject } from './types'

// `logger: false`: unknown keywords/formats (e.g. `format: "date"` without
// ajv-formats) are ignored silently instead of warning on every compile.
const OPTS = { allErrors: true, strict: false, logger: false } as const
const draft07 = new Ajv(OPTS)
const draft2019 = new Ajv2019(OPTS)
const draft2020 = new Ajv2020(OPTS)

const cache = new Map<string, ValidateFunction>()

function engineFor(schema: JsonSchemaObject): Ajv {
  const declared = typeof schema.$schema === 'string' ? schema.$schema : ''
  if (declared.includes('2020-12')) return draft2020
  if (declared.includes('2019-09')) return draft2019
  return draft07
}

export type CompileResult = { ok: true; validate: ValidateFunction } | { ok: false; error: string }

export function compileSchema(schema: JsonSchemaObject): CompileResult {
  const key = JSON.stringify(schema)
  const hit = cache.get(key)
  if (hit) return { ok: true, validate: hit }
  try {
    const validate = engineFor(schema).compile(schema)
    cache.set(key, validate)
    return { ok: true, validate }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Validate call arguments. A schema that does not compile never blocks a call
 * (saving already rejects those; this is the belt for rows edited elsewhere).
 */
export function validateArgs(
  schema: JsonSchemaObject,
  args: unknown,
): { ok: true } | { ok: false; message: string } {
  const compiled = compileSchema(schema)
  if (!compiled.ok) return { ok: true }
  if (compiled.validate(args)) return { ok: true }
  const message = (compiled.validate.errors ?? [])
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}`.trim())
    .join('; ')
  return { ok: false, message: message || 'arguments do not match the input schema' }
}
