/**
 * The kind of an HTTP mock server (`mock_servers.kind`) — the single source
 * shared by the main process (repo validation, row → view) and the renderer
 * (Mocks sidebar sections, the New mock server dialog, the editor).
 *
 * A kind is an authoring / presentation profile, NOT an engine switch: every
 * kind runs on the same HTTP mock engine (`src/main/mock/`), which never reads
 * this value — what a request gets is decided by the response rows
 * (`body_type`, `stream_config`). The kind picks the sidebar section, the
 * presets, the body types the editor offers and the "Open in …" button.
 *
 * Mock MCP is deliberately NOT a kind here: it is its own table
 * (`mock_mcp_servers`) with its own engine.
 *
 * The kind is fixed at creation (there is no update path); only a project
 * file can change it. Pure and import-free so both bundles can use it.
 */

export const MOCK_SERVER_KINDS = ['http', 'sse', 'ai'] as const

export type MockServerKind = (typeof MOCK_SERVER_KINDS)[number]

export function isMockServerKind(raw: unknown): raw is MockServerKind {
  return typeof raw === 'string' && (MOCK_SERVER_KINDS as readonly string[]).includes(raw)
}

/**
 * Unknown / empty → `'http'`: a row written before the column existed, a
 * project file from another build, or a corrupt value. Read-side only — the
 * stored value is left as it is so a git round-trip stays byte-identical.
 */
export function normalizeMockServerKind(raw: unknown): MockServerKind {
  return isMockServerKind(raw) ? raw : 'http'
}
