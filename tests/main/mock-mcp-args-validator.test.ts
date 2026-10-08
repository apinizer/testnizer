/**
 * Mock MCP `tools/call` argument validation (issue #140) — schemas that carry
 * an `$id`. Ajv registers a compiled schema under its `$id`; on a shared
 * engine the EDITED version of a schema (same `$id`, new content) threw
 * "schema with key or id … already exists", so the second save of a tool was
 * refused until the app restarted.
 */
import { describe, expect, it } from 'vitest'
import { compileSchema, validateArgs } from '../../src/main/mock-mcp/args-validator'

describe('args-validator — schemas with an $id', () => {
  it('an edited schema with the same $id compiles again and validates by its new content', () => {
    const before = {
      $id: 'https://schemas.test/weather',
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    }
    const after = {
      ...before,
      properties: { city: { type: 'string' }, units: { enum: ['metric', 'imperial'] } },
      required: ['city', 'units'],
    }
    expect(compileSchema(before).ok).toBe(true)
    const second = compileSchema(after)
    expect(second.ok, second.ok ? '' : second.error).toBe(true)

    expect(validateArgs(before, { city: 'Ankara' })).toEqual({ ok: true })
    expect(validateArgs(after, { city: 'Ankara' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/units/),
    })
    expect(validateArgs(after, { city: 'Ankara', units: 'metric' })).toEqual({ ok: true })
  })

  it('$ref against the $id (relative and absolute) still resolves, across edits and dialects', () => {
    const make = (required: string[], dialect?: string) => ({
      ...(dialect ? { $schema: dialect } : {}),
      $id: 'https://schemas.test/range',
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/range' },
        b: { $ref: 'https://schemas.test/range#/$defs/range' },
      },
      $defs: { range: { type: 'object', required } },
    })
    for (const dialect of [undefined, 'https://json-schema.org/draft/2020-12/schema']) {
      const one = make(['from'], dialect)
      const two = make(['from', 'to'], dialect)
      expect(validateArgs(one, { a: { from: 1 }, b: { from: 1 } })).toEqual({ ok: true })
      expect(validateArgs(two, { a: { from: 1 }, b: { from: 1, to: 2 } })).toMatchObject({
        ok: false,
        message: expect.stringMatching(/\/a .*to/),
      })
      expect(validateArgs(two, { a: { from: 1, to: 2 }, b: { from: 1 } })).toMatchObject({
        ok: false,
        message: expect.stringMatching(/\/b .*to/),
      })
    }
  })
})
