/**
 * Mock MCP editor draft → `mockMcp:server:update` payload (issue #140).
 * Pure functions: what the General / Scenarios / Tools forms send.
 */
import { describe, it, expect } from 'vitest'
import {
  cleanErrorMode,
  connectUrl,
  draftToPatch,
  generateBearerToken,
  parseSchemaText,
  serverToDraft,
  sseConnectUrl,
} from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import { sampleServer } from './mock-mcp-bridge-stub'

describe('draftToPatch', () => {
  it('round-trips an unchanged server into a full, backend-shaped patch', () => {
    const r = draftToPatch(serverToDraft(sampleServer()))
    expect(r.problem).toBeUndefined()
    expect(r.patch).toEqual({
      name: 'Echo MCP',
      description: '',
      host: '127.0.0.1',
      port: 3100,
      path: '/mcp',
      legacySse: false,
      protocolPin: null,
      legacyMode: 'stateless',
      cacheTtlMs: 0,
      authMode: 'none',
      bearerToken: '',
      latencyMs: 0,
      errorMode: { kind: 'none' },
      tools: [
        {
          name: 'echo',
          description: 'Echoes',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          response: { kind: 'template', body: '{{args.text}}' },
        },
      ],
      resources: [],
      prompts: [],
    })
  })

  it('carries General + Scenarios edits (trimmed name, pin, bearer, latency, error mode)', () => {
    const d = serverToDraft(sampleServer())
    const r = draftToPatch({
      ...d,
      name: '  Renamed  ',
      port: 0,
      path: ' /tools ',
      legacySse: true,
      protocolPin: '2025-06-18',
      authMode: 'bearer',
      bearerToken: 'secret',
      latencyMs: 250,
      errorMode: { kind: 'jsonrpc', code: -32001, message: 'boom', everyN: 3, httpStatus: 503 },
    })
    expect(r.patch).toMatchObject({
      name: 'Renamed',
      port: 0,
      path: '/tools',
      legacySse: true,
      protocolPin: '2025-06-18',
      authMode: 'bearer',
      bearerToken: 'secret',
      latencyMs: 250,
      // httpStatus is irrelevant for a JSON-RPC error and is dropped.
      errorMode: { kind: 'jsonrpc', code: -32001, message: 'boom', everyN: 3 },
    })
  })

  it('sends an empty pin as null (clears it) and omits blank optional tool fields', () => {
    const d = serverToDraft(sampleServer({ protocolPin: '2024-11-05' }))
    d.protocolPin = ''
    d.tools[0] = { ...d.tools[0], title: '  ', description: '', delayMs: 0, error: undefined }
    const tool = draftToPatch(d).patch?.tools?.[0]
    expect(draftToPatch(d).patch?.protocolPin).toBeNull()
    expect(tool).toBeDefined()
    expect(Object.keys(tool ?? {}).sort()).toEqual(['inputSchema', 'name', 'response'])
  })

  it('keeps a per-tool error override, cleaned for its kind', () => {
    const d = serverToDraft(sampleServer())
    d.tools[0] = { ...d.tools[0], delayMs: 40, error: { kind: 'http', httpStatus: 502, code: 1 } }
    expect(draftToPatch(d).patch?.tools?.[0]).toMatchObject({
      delayMs: 40,
      error: { kind: 'http', httpStatus: 502 },
    })
    expect(draftToPatch(d).patch?.tools?.[0].error).not.toHaveProperty('code')
  })

  it('blocks Save on schema text that is not JSON, not an object, or not type:object', () => {
    const d = serverToDraft(sampleServer())
    d.tools[0] = { ...d.tools[0], schemaText: '{ nope' }
    expect(draftToPatch(d).problem).toMatchObject({
      key: 'mockMcp.validation.schemaJson',
      tool: 'echo',
    })
    d.tools[0] = { ...d.tools[0], schemaText: '[1]' }
    expect(draftToPatch(d).problem?.key).toBe('mockMcp.validation.schemaNotObject')
    d.tools[0] = { ...d.tools[0], schemaText: '{"type":"string"}' }
    expect(draftToPatch(d).problem?.key).toBe('mockMcp.validation.schemaType')
  })

  it('cleans resources (exactly the set uri / template) and prompts (drops empty optionals)', () => {
    const d = serverToDraft(
      sampleServer({
        resources: [
          { uri: undefined, uriTemplate: 'mock://u/{id}', name: 'u', mimeType: '', text: 'x' },
        ],
        prompts: [
          {
            name: ' p ',
            description: '',
            arguments: [{ name: 'topic', description: '', required: false }],
            messages: [{ role: 'user', text: '{{args.topic}}' }],
          },
        ],
      }),
    )
    const p = draftToPatch(d).patch
    expect(p?.resources).toEqual([{ uriTemplate: 'mock://u/{id}', name: 'u', text: 'x' }])
    expect(p?.prompts).toEqual([
      {
        name: 'p',
        arguments: [{ name: 'topic' }],
        messages: [{ role: 'user', text: '{{args.topic}}' }],
      },
    ])
  })
})

describe('helpers', () => {
  it('cleanErrorMode keeps only the fields the kind uses; everyN 1 means every call', () => {
    expect(cleanErrorMode({ kind: 'none', code: 1, everyN: 4 })).toEqual({ kind: 'none' })
    expect(cleanErrorMode({ kind: 'isError', message: 'm', code: 5, everyN: 1 })).toEqual({
      kind: 'isError',
      message: 'm',
    })
    expect(cleanErrorMode({ kind: 'timeout', everyN: 2, message: 'x' })).toEqual({
      kind: 'timeout',
      everyN: 2,
    })
  })

  it('parseSchemaText accepts a type:object schema', () => {
    expect(parseSchemaText('{"type":"object"}').schema).toEqual({ type: 'object' })
  })

  it('connect URLs: live URL wins; otherwise built from host/port/path', () => {
    const s = { host: '0.0.0.0', port: 3100, path: '/mcp' }
    expect(connectUrl(s, null)).toBe('http://127.0.0.1:3100/mcp')
    expect(connectUrl(s, 'http://127.0.0.1:5555/mcp')).toBe('http://127.0.0.1:5555/mcp')
    expect(sseConnectUrl(s, null)).toBe('http://127.0.0.1:3100/mcp/sse')
    expect(sseConnectUrl({ ...s, path: '/' }, null)).toBe('http://127.0.0.1:3100/sse')
    expect(connectUrl({ host: '::1', port: 1, path: '/m' }, null)).toBe('http://[::1]:1/m')
  })

  it('generateBearerToken yields distinct, header-safe tokens', () => {
    const a = generateBearerToken()
    const b = generateBearerToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^mcp_[0-9a-f]{48}$/)
  })
})
