/**
 * Per-endpoint JSON Schema body validation using Ajv (draft-07).
 *
 * Compiled validators are cached by their stringified schema so repeated
 * requests don't recompile.
 */

import Ajv, { type ValidateFunction } from 'ajv'
import type { SchemaValidation } from './types'

const ajv = new Ajv({ allErrors: true, strict: false })
const cache = new Map<string, ValidateFunction>()

export interface ValidationFailure {
  status: 400
  headers: Record<string, string>
  body: string
}

export type ValidationResult = { ok: true } | { ok: false; failure: ValidationFailure }

export function validateBody(config: SchemaValidation, body: unknown): ValidationResult {
  if (!config.enabled || !config.schema) return { ok: true }
  const key = JSON.stringify(config.schema)
  let validator = cache.get(key)
  if (!validator) {
    try {
      validator = ajv.compile(config.schema)
      cache.set(key, validator)
    } catch (e) {
      return {
        ok: false,
        failure: {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            error: 'invalid_schema',
            message: e instanceof Error ? e.message : String(e),
          }),
        },
      }
    }
  }
  if (validator(body)) return { ok: true }
  return {
    ok: false,
    failure: {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'validation_failed',
        message: 'Request body does not match the configured schema.',
        errors: validator.errors ?? [],
      }),
    },
  }
}

/** For tests — drops the compiled schema cache. */
export function clearSchemaCache(): void {
  cache.clear()
}
