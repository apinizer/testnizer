/**
 * `src/shared/mcp-response.ts` — the ONE MCP result → `pm.response` /
 * assertions / verdict adapter shared by Send (renderer) and Run (main),
 * issues #160 / #161. Plus the `pm.mcp` binding in `buildScriptBindings`.
 */
import { describe, it, expect } from 'vitest'
import {
  mcpOutcomeToResponse,
  mcpScriptInfo,
  type McpCallOutcome,
} from '../../../src/shared/mcp-response'
import { buildScriptBindings, createPmResponse, type PmLike } from '../../../src/shared/script'
import { endpointDidPass } from '../../../src/shared/runner-verdict'
import { makeFakePm } from './helpers'

const timing = { durationMs: 42, sizeBytes: 99 }

describe('mcpOutcomeToResponse', () => {
  it('text-only tool → 200 OK, text/plain, blocks joined with \\n, timing carried', () => {
    const o: McpCallOutcome = {
      capability: 'tool',
      name: 'echo',
      result: {
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ],
      },
      timing,
    }
    expect(mcpOutcomeToResponse(o)).toEqual({
      code: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      body: 'line 1\nline 2',
      cookies: [],
      responseTime: 42,
      responseSize: 99,
    })
  })

  it('structuredContent wins → JSON body, application/json', () => {
    const r = mcpOutcomeToResponse({
      capability: 'tool',
      name: 'sum',
      result: { content: [{ type: 'text', text: '5' }], structuredContent: { sum: 5 } },
      timing,
    })!
    expect(r.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(r.body)).toEqual({ sum: 5 })
    expect(createPmResponse(r).json()).toEqual({ sum: 5 })
  })

  it('isError tool → 500 Tool Error (fails a check-less row via the shared verdict)', () => {
    const r = mcpOutcomeToResponse({
      capability: 'tool',
      name: 'fail',
      result: { content: [{ type: 'text', text: 'boom' }], isError: true },
      timing,
    })!
    expect(r.code).toBe(500)
    expect(r.statusText).toBe('Tool Error')
    expect(r.body).toBe('boom')
    const row = { status: r.code, error: undefined, assertions: [], skipped: 0 }
    expect(endpointDidPass(row as never)).toBe(false)
  })

  it('a non-text block (image) → JSON of the whole result', () => {
    const result = {
      content: [
        { type: 'text', text: 'here' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    }
    const r = mcpOutcomeToResponse({ capability: 'tool', name: 'img', result, timing })!
    expect(r.headers['content-type']).toBe('application/json')
    expect(JSON.parse(r.body)).toEqual(result)
  })

  it('an empty content array is not "all text" → JSON of the result', () => {
    const r = mcpOutcomeToResponse({ capability: 'tool', name: 't', result: { content: [] } })!
    expect(r.headers['content-type']).toBe('application/json')
    expect(JSON.parse(r.body)).toEqual({ content: [] })
  })

  it('resource text contents → joined text/plain', () => {
    const r = mcpOutcomeToResponse({
      capability: 'resource',
      name: 'test://greeting',
      result: {
        contents: [
          { uri: 'test://a', text: 'Hello' },
          { uri: 'test://b', text: 'World' },
        ],
      },
      timing,
    })!
    expect(r).toMatchObject({ code: 200, body: 'Hello\nWorld' })
    expect(r.headers['content-type']).toBe('text/plain')
  })

  it('resource blob contents → JSON of contents', () => {
    const contents = [{ uri: 'test://pixel.png', mimeType: 'image/png', blob: 'iVBO' }]
    const r = mcpOutcomeToResponse({
      capability: 'resource',
      name: 'test://pixel.png',
      result: { contents },
    })!
    expect(r.headers['content-type']).toBe('application/json')
    expect(JSON.parse(r.body)).toEqual(contents)
  })

  it('prompt → JSON of messages', () => {
    const messages = [{ role: 'user', content: { type: 'text', text: 'Summarize' } }]
    const r = mcpOutcomeToResponse({
      capability: 'prompt',
      name: 'summarize',
      result: { description: 'd', messages },
      timing,
    })!
    expect(r.code).toBe(200)
    expect(r.headers['content-type']).toBe('application/json')
    expect(JSON.parse(r.body)).toEqual(messages)
  })

  it('no timing → responseTime 0, responseSize = UTF-8 bytes of the result JSON', () => {
    const result = { content: [{ type: 'text', text: 'ğ' }] }
    const r = mcpOutcomeToResponse({ capability: 'tool', name: 'x', result })!
    expect(r.responseTime).toBe(0)
    expect(r.responseSize).toBe(new TextEncoder().encode(JSON.stringify(result)).length)
  })

  it('error / cancelled / input_required → null (no response)', () => {
    expect(
      mcpOutcomeToResponse({ capability: 'tool', name: 'x', error: 'ECONNREFUSED' }),
    ).toBeNull()
    expect(
      mcpOutcomeToResponse({ capability: 'tool', name: 'x', cancelled: true, error: 'cancelled' }),
    ).toBeNull()
    expect(mcpOutcomeToResponse({ capability: 'tool', name: 'x' })).toBeNull()
    expect(
      mcpOutcomeToResponse({
        capability: 'tool',
        name: 'x',
        result: {
          resultType: 'input_required',
          __mcp: { kind: 'input_required', inputRequests: {} },
        },
      }),
    ).toBeNull()
  })

  it('the engine-private __mcp marker never reaches the body', () => {
    const r = mcpOutcomeToResponse({
      capability: 'tool',
      name: 'x',
      result: {
        content: [{ type: 'image', data: 'A', mimeType: 'image/png' }],
        __mcp: { kind: 'x' },
      },
    })!
    expect(r.body).not.toContain('__mcp')
  })
})

describe('mcpScriptInfo', () => {
  it('tool: capability / name / isError / structuredContent / content', () => {
    const result = {
      content: [{ type: 'text', text: '5' }],
      structuredContent: { sum: 5 },
      isError: false,
    }
    expect(mcpScriptInfo({ capability: 'tool', name: 'sum', result, timing })).toEqual({
      capability: 'tool',
      name: 'sum',
      isError: false,
      result,
      structuredContent: { sum: 5 },
      content: result.content,
    })
  })

  it('tool isError → isError true', () => {
    const info = mcpScriptInfo({
      capability: 'tool',
      name: 'f',
      result: { content: [], isError: true },
    })!
    expect(info.isError).toBe(true)
    expect(info.structuredContent).toBeUndefined()
  })

  it('resource → content = contents, prompt → content = messages, never isError', () => {
    const contents = [{ uri: 'u', text: 't' }]
    expect(
      mcpScriptInfo({ capability: 'resource', name: 'u', result: { contents, isError: true } }),
    ).toMatchObject({ capability: 'resource', name: 'u', isError: false, content: contents })
    const messages = [{ role: 'user', content: { type: 'text', text: 'x' } }]
    expect(mcpScriptInfo({ capability: 'prompt', name: 'p', result: { messages } })).toMatchObject({
      capability: 'prompt',
      isError: false,
      content: messages,
    })
  })

  it('error / cancelled → null', () => {
    expect(mcpScriptInfo({ capability: 'tool', name: 'x', error: 'boom' })).toBeNull()
    expect(mcpScriptInfo({ capability: 'tool', name: 'x', cancelled: true })).toBeNull()
  })
})

describe('pm.mcp binding (buildScriptBindings)', () => {
  it('is undefined for a non-MCP request', () => {
    const { pm, ctx } = makeFakePm()
    buildScriptBindings(ctx)
    expect(pm.mcp).toBeUndefined()
  })

  it('exposes ctx.mcp as pm.mcp — and through the insomnia alias', () => {
    const info = mcpScriptInfo({
      capability: 'tool',
      name: 'echo',
      result: { content: [{ type: 'text', text: 'hi' }] },
    })!
    const { ctx } = makeFakePm()
    const { bindings } = buildScriptBindings({ ...ctx, mcp: info })
    expect((bindings.pm as PmLike).mcp).toBe(info)
    expect((bindings.insomnia as { mcp?: unknown }).mcp).toBe(info)
  })
})
