/**
 * What the mock editor offers per server kind (issue #221, design Ek D
 * §D.2.4) — renderer-only presentation, the engine never reads the kind.
 *
 *  - body types offered in the response editor: `http` keeps today's list,
 *    `sse` adds the stream type and keeps JSON / text for side endpoints and
 *    error bodies, `ai` offers the AI reply type (`llm`) and JSON for side
 *    endpoints (`GET /v1/models`) and error bodies (429 / 500 / 401);
 *  - the HTTP-only endpoint tools (OpenAPI / Postman import, JWKS serve);
 *  - the badge text shared by the sidebar row and the editor header.
 */
import { normalizeMockServerKind, type MockServerKind } from '../../../shared/mock-kind'
import type { MockBodyType, MockServer } from '../../types'

const BODY_TYPES: Record<MockServerKind, readonly MockBodyType[]> = {
  http: ['json', 'xml', 'text', 'html'],
  sse: ['sse', 'json', 'text'],
  ai: ['llm', 'json'],
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

/** Whether a server of `kind` offers `bodyType` in the response editor's list. */
export function kindOffersBodyType(kind: unknown, bodyType: MockBodyType): boolean {
  return BODY_TYPES[normalizeMockServerKind(kind)].includes(bodyType)
}

/**
 * The body types of `bodyTypes` a server of `kind` does not offer — what the
 * "Server type" change warns about (issue #222). Sorted, each listed once.
 */
export function bodyTypesNotOffered(
  kind: unknown,
  bodyTypes: readonly MockBodyType[],
): MockBodyType[] {
  return [...new Set(bodyTypes.filter((b) => !kindOffersBodyType(kind, b)))].sort()
}

/** i18n keys of the body types' human labels (the select and the type-change confirm). */
const BODY_TYPE_LABEL_KEYS: Record<MockBodyType, string> = {
  json: 'mock.bodyTypeLabel.json',
  xml: 'mock.bodyTypeLabel.xml',
  text: 'mock.bodyTypeLabel.text',
  html: 'mock.bodyTypeLabel.html',
  sse: 'mock.bodyTypeLabel.sse',
  llm: 'mock.bodyTypeLabel.llm',
}

/** "AI reply" for `llm`, "SSE stream" for `sse`, … — never the raw stored value. */
export function bodyTypeLabel(t: (key: string) => string, bodyType: MockBodyType): string {
  const key = BODY_TYPE_LABEL_KEYS[bodyType]
  return key ? t(key) : bodyType
}

/**
 * The "Change the server type?" body (PM review #21): a real singular /
 * plural ("1 response uses …", "4 responses use …") and the body types by
 * their labels, not the stored `llm` / `sse`.
 */
export function serverTypeConfirmBody(
  t: (key: string) => string,
  o: { count: number; kind: string; types: readonly MockBodyType[] },
): string {
  const key = o.count === 1 ? 'mock.serverTypeConfirmBodyOne' : 'mock.serverTypeConfirmBody'
  return t(key)
    .replace('{count}', String(o.count))
    .replace('{kind}', o.kind)
    .replace('{types}', o.types.map((b) => bodyTypeLabel(t, b)).join(', '))
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

/**
 * Mocks-panel search (issue #226): every word of `query` must match the
 * server's name (substring), its kind label (prefix — "s" / "sse", so one
 * letter does not pull in every kind) or its port (substring). Case-insensitive;
 * an empty query matches everything. The displayed address is not matched: a
 * Mock MCP row shows `http://…`, and "http" must list the HTTP servers only.
 */
export function matchesMockQuery(
  query: string,
  server: { name: string; kind: MockBadgeKind; port: number },
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const name = server.name.toLowerCase()
  const kind = KIND_BADGE[server.kind].toLowerCase()
  const port = String(server.port)
  return words.every((w) => name.includes(w) || kind.startsWith(w) || port.includes(w))
}
