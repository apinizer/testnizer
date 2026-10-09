/**
 * Issue #154 (deferred review of #152) — the Mock MCP elicitation editor's
 * schema ⇄ rows conversion must round-trip what it cannot edit:
 *   - titled `oneOf: [{ const, title }]` enums stay `oneOf` (titles kept),
 *   - legacy `enumNames` follow the enum values when they are edited,
 *   - unsupported property shapes are carried verbatim, never coerced to string,
 *   - duplicate field names block Save with a readable problem.
 */
import { describe, expect, it } from 'vitest'
import {
  draftToElicit,
  duplicateElicitField,
  elicitToDraft,
  rowsToElicitSchema,
} from '../../src/renderer/components/mock-mcp/mock-mcp-elicit'
import {
  draftToPatch,
  serverToDraft,
  toolToDraft,
} from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import type { MockMcpElicit } from '../../src/renderer/types/mock-mcp'
import { sampleServer } from './mock-mcp-bridge-stub'
import { normalizeTools, validateMockMcpConfig } from '../../src/main/mock-mcp/config'

function elicitWith(properties: Record<string, unknown>, required?: string[]): MockMcpElicit {
  return {
    key: 'k',
    message: 'm',
    schema: { type: 'object', properties, ...(required ? { required } : {}) },
  }
}

describe('schema → rows → schema round trip', () => {
  it('keeps titled oneOf, enumNames, unsupported fields and extras unchanged', () => {
    const e = elicitWith(
      {
        tier: {
          type: 'string',
          title: 'Tier',
          oneOf: [
            { const: 'free', title: 'Free plan' },
            { const: 'pro', title: 'Pro plan' },
          ],
        },
        size: { type: 'string', enum: ['s', 'm'], enumNames: ['Small', 'Medium'] },
        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
        level: { type: 'integer', enum: [1, 2, 3] },
        nothing: {},
        name: { type: 'string', minLength: 1 },
      },
      ['tier', 'tags'],
    )
    expect(draftToElicit(elicitToDraft(e))).toEqual(e)
  })

  it('unsupported properties become read-only raw rows, not strings', () => {
    const d = elicitToDraft(
      elicitWith({ tags: { type: 'array', items: { type: 'string' } }, level: { enum: [1, 2] } }),
    )
    expect(d.fields.map((r) => r.type)).toEqual(['unsupported', 'unsupported'])
    expect(d.fields[0].raw).toEqual({ type: 'array', items: { type: 'string' } })
    // Renaming / requiring an unsupported row keeps its schema verbatim.
    d.fields[0] = { ...d.fields[0], name: 'labels', required: true }
    expect(rowsToElicitSchema(d.fields)).toEqual({
      type: 'object',
      properties: {
        labels: { type: 'array', items: { type: 'string' } },
        level: { enum: [1, 2] },
      },
      required: ['labels'],
    })
  })
})

describe('editing enum values', () => {
  it('a titled oneOf stays oneOf: kept titles follow their const, new values get one', () => {
    const d = elicitToDraft(
      elicitWith({
        tier: {
          type: 'string',
          oneOf: [
            { const: 'free', title: 'Free plan' },
            { const: 'pro', title: 'Pro plan' },
          ],
        },
      }),
    )
    expect(d.fields[0]).toMatchObject({ type: 'enum', enumText: 'free, pro' })
    d.fields[0] = { ...d.fields[0], enumText: 'pro, enterprise' }
    expect(rowsToElicitSchema(d.fields).properties).toEqual({
      tier: {
        type: 'string',
        oneOf: [
          { const: 'pro', title: 'Pro plan' },
          { const: 'enterprise', title: 'enterprise' },
        ],
      },
    })
  })

  it('enumNames are re-aligned to the edited values, never stale', () => {
    const d = elicitToDraft(
      elicitWith({ size: { type: 'string', enum: ['s', 'm'], enumNames: ['Small', 'Medium'] } }),
    )
    d.fields[0] = { ...d.fields[0], enumText: 'm, l, s' }
    expect(rowsToElicitSchema(d.fields).properties).toEqual({
      size: { type: 'string', enum: ['m', 'l', 's'], enumNames: ['Medium', 'l', 'Small'] },
    })
  })

  it('switching an enum row to another type drops enumNames / oneOf', () => {
    const d = elicitToDraft(
      elicitWith({
        size: { type: 'string', enum: ['s'], enumNames: ['Small'] },
        tier: { type: 'string', oneOf: [{ const: 'pro', title: 'Pro' }] },
      }),
    )
    d.fields = d.fields.map((r) => ({ ...r, type: 'string' as const }))
    expect(rowsToElicitSchema(d.fields).properties).toEqual({
      size: { type: 'string' },
      tier: { type: 'string' },
    })
  })
})

describe('duplicate field names', () => {
  it('are detected (trimmed, blanks ignored) and block Save with a problem', () => {
    const d = elicitToDraft(elicitWith({ a: { type: 'string' }, b: { type: 'number' } }))
    expect(duplicateElicitField(d)).toBeNull()
    d.fields[1] = { ...d.fields[1], name: ' a ' }
    expect(duplicateElicitField(d)).toBe('a')

    const tool = toolToDraft({
      name: 'ask',
      inputSchema: { type: 'object', properties: {} },
      response: { kind: 'text', body: 'ok' },
      elicit: elicitWith({ a: { type: 'string' } }),
    })
    if (!tool.elicit) throw new Error('elicit expected')
    tool.elicit = { ...tool.elicit, fields: [...tool.elicit.fields, { ...d.fields[1] }] }
    const r = draftToPatch({ ...serverToDraft(sampleServer()), tools: [tool] })
    expect(r.problem).toEqual({
      key: 'mockMcp.validation.elicitDuplicate',
      tool: 'ask',
      detail: 'a',
    })
  })
})

describe('what the backend makes of a round-tripped elicitation', () => {
  function validate(properties: Record<string, unknown>): {
    normalized: unknown
    problem: string | null
  } {
    const tool = toolToDraft({
      name: 'ask',
      inputSchema: { type: 'object', properties: {} },
      response: { kind: 'text', body: 'ok' },
      elicit: elicitWith(properties),
    })
    const patch = draftToPatch({ ...serverToDraft(sampleServer()), tools: [tool] }).patch
    if (!patch?.tools) throw new Error('patch expected')
    const tools = normalizeTools(patch.tools)
    return {
      normalized: tools[0].elicit?.schema,
      problem: validateMockMcpConfig({
        name: 'x',
        host: '127.0.0.1',
        port: 0,
        path: '/mcp',
        legacySse: false,
        authMode: 'none',
        latencyMs: 0,
        errorMode: { kind: 'none' },
        protocolPin: null,
        legacyMode: 'stateless',
        cacheTtlMs: 0,
        tools,
        resources: [],
        prompts: [],
      }),
    }
  }

  it('titled oneOf, enumNames and a typed non-string enum are kept and accepted', () => {
    const properties = {
      tier: { type: 'string', oneOf: [{ const: 'pro', title: 'Pro plan' }] },
      size: { type: 'string', enum: ['s', 'm'], enumNames: ['Small', 'Medium'] },
      level: { type: 'integer', enum: [1, 2, 3] },
    }
    const r = validate(properties)
    expect(r.normalized).toEqual({ type: 'object', properties })
    expect(r.problem).toBeNull()
  })

  it('a shape the protocol does not allow (array) is kept verbatim and the backend names it', () => {
    const r = validate({ tags: { type: 'array', items: { type: 'string' } } })
    expect(r.normalized).toEqual({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    })
    expect(r.problem).toMatch(
      /elicitation field "tags" must be a string, number, integer or boolean/,
    )
  })
})
