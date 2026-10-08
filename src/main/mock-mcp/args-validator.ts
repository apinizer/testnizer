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
 *
 * `mockJsonSchemaValidator` exposes the same engine through the v2 SDK's
 * `jsonSchemaValidator` provider interface, so the SDK-side checks (the
 * server's elicitation-response validation, `fromJsonSchema` for
 * `acceptedContent`) judge input exactly like `tools/call` does.
 */

import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from '@modelcontextprotocol/server'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
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

/**
 * A private engine of the same dialect. Ajv registers every schema carrying
 * an `$id` (at any depth) under that id, so compiling an EDITED schema with
 * the same `$id` on a shared instance throws "schema with key or id … already
 * exists" — the second save would be refused until a restart. Such schemas
 * get their own instance (the content-keyed cache still compiles each
 * variant once); `$id` stays in place, so `$ref`s resolve against it as
 * authored.
 */
function isolatedEngineFor(schema: JsonSchemaObject): Ajv {
  const declared = typeof schema.$schema === 'string' ? schema.$schema : ''
  if (declared.includes('2020-12')) return new Ajv2020(OPTS)
  if (declared.includes('2019-09')) return new Ajv2019(OPTS)
  return new Ajv(OPTS)
}

export type CompileResult = { ok: true; validate: ValidateFunction } | { ok: false; error: string }

export function compileSchema(schema: JsonSchemaObject): CompileResult {
  const key = JSON.stringify(schema)
  const hit = cache.get(key)
  if (hit) return { ok: true, validate: hit }
  try {
    const engine = key.includes('"$id"') ? isolatedEngineFor(schema) : engineFor(schema)
    const validate = engine.compile(schema)
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
  return { ok: false, message: formatErrors(compiled.validate.errors) }
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  const message = (errors ?? [])
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}`.trim())
    .join('; ')
  return message || 'value does not match the schema'
}

/** The ajv engine above as a v2 SDK validator provider (strict: a bad schema fails). */
export const mockJsonSchemaValidator: jsonSchemaValidator = {
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const compiled = compileSchema(schema as JsonSchemaObject)
    return (input: unknown) => {
      if (!compiled.ok) return { valid: false, data: undefined, errorMessage: compiled.error }
      if (compiled.validate(input))
        return { valid: true, data: input as T, errorMessage: undefined }
      return { valid: false, data: undefined, errorMessage: formatErrors(compiled.validate.errors) }
    }
  },
}
