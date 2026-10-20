/**
 * What the mock editor offers per server kind (issue #221, design Ek D
 * §D.2.4) — renderer-only presentation, the engine never reads the kind.
 *
 *  - body types offered in the response editor: `http` keeps today's list,
 *    `sse` adds the stream type and keeps JSON / text for side endpoints and
 *    error bodies, `ai` offers JSON until the `llm` type lands (Faz 2);
 *  - the HTTP-only endpoint tools (OpenAPI / Postman import, JWKS serve);
 *  - the badge text shared by the sidebar row and the editor header.
 */
import { normalizeMockServerKind, type MockServerKind } from '../../../shared/mock-kind'
import type { MockBodyType, MockServer } from '../../types'

const BODY_TYPES: Record<MockServerKind, readonly MockBodyType[]> = {
  http: ['json', 'xml', 'text', 'html'],
  sse: ['sse', 'json', 'text'],
  ai: ['json'],
}

/**
 * The body types the select lists for `kind`, plus the response's current
 * value when the kind does not offer it (a project file may carry any type;
 * the engine still serves it) — so the controlled select always shows the
 * stored value and nothing changes silently.
 */
export function bodyTypeOptions(kind: unknown, current: MockBodyType): MockBodyType[] {
  const list = [...BODY_TYPES[normalizeMockServerKind(kind)]]
  if (!list.includes(current)) list.push(current)
  return list
}

/** OpenAPI / Postman import and "Serve JWKS" only make sense on an HTTP server. */
export function showsHttpEndpointTools(kind: unknown): boolean {
  return normalizeMockServerKind(kind) === 'http'
}

/** A Mocks-panel row / editor header kind: the HTTP-table kinds plus Mock MCP. */
export type MockBadgeKind = MockServerKind | 'mcp'

export const KIND_BADGE: Record<MockBadgeKind, string> = {
  http: 'HTTP',
  mcp: 'MCP',
  sse: 'SSE',
  ai: 'AI',
}

/** The servers of one kind (one Mocks-panel group); a row without a known kind counts as HTTP. */
export function serversOfKind(servers: MockServer[], kind: MockServerKind): MockServer[] {
  return servers.filter((s) => normalizeMockServerKind(s.kind) === kind)
}
