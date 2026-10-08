/**
 * "New Mock MCP server" presets (issue #140) must produce configs the REAL
 * backend validator accepts — a preset that fails `validateMockMcpConfig`
 * would make "+ New" error out. Validated with the main-process normalisers +
 * validator themselves, not a renderer copy.
 */
import { describe, it, expect } from 'vitest'
import {
  buildPresetInput,
  MOCK_MCP_PRESET_IDS,
  suggestPort,
  uniqueName,
} from '../../src/renderer/components/mock-mcp/mock-mcp-presets'
import {
  normalizeCacheTtl,
  normalizeErrorMode,
  normalizeLegacyMode,
  normalizePath,
  normalizePrompts,
  normalizeResources,
  normalizeTools,
  PINNABLE_PROTOCOL_VERSIONS,
  validateMockMcpConfig,
} from '../../src/main/mock-mcp/config'
import { MOCK_MCP_PROTOCOL_VERSIONS } from '../../src/renderer/types/mock-mcp'

const ctx = { projectId: 'p-1', takenNames: [], takenPorts: [] }

describe('Mock MCP presets', () => {
  it.each(MOCK_MCP_PRESET_IDS)('preset "%s" passes the backend validator', (id) => {
    const input = buildPresetInput(id, ctx)
    const problem = validateMockMcpConfig({
      name: input.name,
      host: input.host ?? '127.0.0.1',
      port: input.port,
      path: normalizePath(input.path),
      legacySse: input.legacySse ?? false,
      authMode: input.authMode ?? 'none',
      latencyMs: input.latencyMs ?? 0,
      errorMode: normalizeErrorMode(input.errorMode ?? { kind: 'none' }),
      protocolPin: input.protocolPin ?? null,
      legacyMode: normalizeLegacyMode(input.legacyMode),
      cacheTtlMs: normalizeCacheTtl(input.cacheTtlMs),
      tools: normalizeTools(input.tools),
      resources: normalizeResources(input.resources ?? []),
      prompts: normalizePrompts(input.prompts ?? []),
    })
    expect(problem).toBeNull()
    expect(input.projectId).toBe('p-1')
    expect(input.tools?.length ?? 0).toBeGreaterThan(0)
    // issue #152: the era posture is explicit, not left to the backend default.
    expect(input.legacyMode).toBe('stateless')
    expect(input.cacheTtlMs).toBe(0)
  })

  it('every preset tool advertises an object input schema and a valid JSON body', () => {
    for (const id of MOCK_MCP_PRESET_IDS) {
      for (const tool of buildPresetInput(id, ctx).tools ?? []) {
        expect(tool.inputSchema.type, `${id}/${tool.name}`).toBe('object')
        if (tool.response.kind === 'json')
          expect(() => JSON.parse(tool.response.body)).not.toThrow()
      }
    }
  })

  it('the error server covers every error kind on a per-tool override, server mode stays none', () => {
    const input = buildPresetInput('errors', ctx)
    expect(input.errorMode).toBeUndefined()
    const kinds = new Set((input.tools ?? []).map((t) => t.error?.kind).filter(Boolean))
    expect([...kinds].sort()).toEqual(['http', 'isError', 'jsonrpc', 'timeout'])
  })

  it('auth requires a generated bearer token; slow adds 1500 ms latency', () => {
    const auth = buildPresetInput('auth', ctx)
    expect(auth.authMode).toBe('bearer')
    expect(auth.bearerToken).toMatch(/^mcp_[0-9a-f]+$/)
    expect(buildPresetInput('auth', ctx).bearerToken).not.toBe(auth.bearerToken)
    expect(buildPresetInput('slow', ctx).latencyMs).toBe(1500)
  })

  it('complex schemas exercise nested objects, arrays, enums and oneOf', () => {
    const text = JSON.stringify(buildPresetInput('schemas', ctx).tools)
    for (const kw of ['"oneOf"', '"enum"', '"items"', '"properties"']) expect(text).toContain(kw)
  })

  it('the protocol-pin select offers exactly the versions the backend accepts (SDK drift guard)', () => {
    expect([...MOCK_MCP_PROTOCOL_VERSIONS]).toEqual([...PINNABLE_PROTOCOL_VERSIONS])
  })

  it('picks a free name and port in the project', () => {
    expect(uniqueName('Echo MCP', ['Echo MCP', 'Echo MCP 2'])).toBe('Echo MCP 3')
    expect(uniqueName('new_tool', ['new_tool'], '_')).toBe('new_tool_2')
    expect(suggestPort([3100, 3101])).toBe(3102)
    const input = buildPresetInput('echo', { ...ctx, takenNames: ['Echo MCP'], takenPorts: [3100] })
    expect(input).toMatchObject({ name: 'Echo MCP 2', port: 3101 })
  })
})
