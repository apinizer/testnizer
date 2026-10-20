/**
 * Issue #221 (Faz 0) — `src/shared/mock-kind.ts`, the single source of the
 * HTTP mock server kind. Unknown / absent values read as 'http' so an old row
 * or a file from another build lands in the HTTP section, unchanged.
 */
import { describe, it, expect } from 'vitest'
import {
  MOCK_SERVER_KINDS,
  isMockServerKind,
  normalizeMockServerKind,
} from '../../../src/shared/mock-kind'

describe('mock server kind (issue #221)', () => {
  it('lists exactly http, sse and ai — MCP is its own table, not a kind', () => {
    expect([...MOCK_SERVER_KINDS]).toEqual(['http', 'sse', 'ai'])
    expect(isMockServerKind('mcp')).toBe(false)
  })

  it('recognises every known kind as itself', () => {
    for (const k of MOCK_SERVER_KINDS) {
      expect(isMockServerKind(k)).toBe(true)
      expect(normalizeMockServerKind(k)).toBe(k)
    }
  })

  it('maps anything unknown or absent to http', () => {
    for (const raw of [undefined, null, '', 'x', 'mcp', 'SSE', ' sse', 'llm', 0, 1, true, {}, []]) {
      expect(isMockServerKind(raw)).toBe(false)
      expect(normalizeMockServerKind(raw)).toBe('http')
    }
  })
})
