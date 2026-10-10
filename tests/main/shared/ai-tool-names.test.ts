/**
 * Issue #180 — tool names offered to the LLM: namespaced per server,
 * sanitized to the strictest provider rule (letter first, `[a-zA-Z0-9_-]`,
 * ≤ 64 — OpenAI / Anthropic / Gemini OpenAI-compat), unique across servers,
 * mapped back through the table (never parsed).
 */
import { describe, expect, it } from 'vitest'
import {
  AI_TOOL_NAME_RE,
  buildToolNameTable,
  wireToolName,
} from '../../../src/shared/ai-tool-names'

describe('wireToolName', () => {
  it('namespaces and sanitizes', () => {
    expect(wireToolName('Weather API', 'get forecast')).toBe('Weather_API__get_forecast')
    expect(wireToolName('Hava Durumu ğüşiöç', 'çağır')).toMatch(AI_TOOL_NAME_RE)
  })

  it('starts with a letter (Gemini) and stays ≤ 64', () => {
    expect(wireToolName('1st-server', 'x')).toMatch(/^[a-zA-Z]/)
    const long = wireToolName('s'.repeat(80), 't'.repeat(80))
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long).toMatch(AI_TOOL_NAME_RE)
  })
})

describe('buildToolNameTable', () => {
  it('two servers with the same name and the same tool get distinct names that map back', () => {
    const table = buildToolNameTable([
      { serverId: 'srv-1', server: 'Files', tool: 'read' },
      { serverId: 'srv-2', server: 'Files', tool: 'read' },
      { serverId: 'srv-2', server: 'Files', tool: 'write' },
    ])
    const names = [...table.keys()]
    expect(new Set(names).size).toBe(3)
    for (const n of names) expect(n).toMatch(AI_TOOL_NAME_RE)
    const back = [...table.values()].map((r) => `${r.serverId}/${r.tool}`)
    expect(back).toEqual(['srv-1/read', 'srv-2/read', 'srv-2/write'])
  })

  it('names that only differ after sanitizing / truncation do not collide', () => {
    const table = buildToolNameTable([
      { serverId: 'a', server: 'x y', tool: 'z' },
      { serverId: 'b', server: 'x.y', tool: 'z' },
      { serverId: 'c', server: 'p'.repeat(70), tool: 'one' },
      { serverId: 'd', server: 'p'.repeat(70), tool: 'one' },
    ])
    expect(table.size).toBe(4)
    for (const n of table.keys()) expect(n.length).toBeLessThanOrEqual(64)
  })

  it('a server called a__b does not confuse the mapping (lookup, not parsing)', () => {
    const table = buildToolNameTable([
      { serverId: 's1', server: 'a__b', tool: 'c' },
      { serverId: 's2', server: 'a', tool: 'b__c' },
    ])
    expect(table.size).toBe(2)
    const refs = [...table.values()]
    expect(refs.map((r) => r.serverId).sort()).toEqual(['s1', 's2'])
  })
})
