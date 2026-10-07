/**
 * Mock MCP editor draft ⇄ backend DTO (issue #140). Pure — no React, no IPC —
 * so "what the form sends to `mockMcp:server:update`" is unit-testable.
 *
 * The editor edits a local draft and Save sends ONE full patch: tools /
 * resources / prompts are always sent whole (the backend replaces them), the
 * scalars are always sent too, `protocolPin: null` clears the pin.
 */
import type {
  MockMcpErrorMode,
  MockMcpPrompt,
  MockMcpResource,
  MockMcpServer,
  MockMcpServerDraft,
  MockMcpServerPatch,
  MockMcpTool,
  MockMcpToolDraft,
} from '../../types/mock-mcp'

let keySeq = 0
export function newDraftKey(): string {
  keySeq += 1
  return `k${keySeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function toolToDraft(tool: MockMcpTool): MockMcpToolDraft {
  const { inputSchema, ...rest } = tool
  return { ...rest, key: newDraftKey(), schemaText: JSON.stringify(inputSchema, null, 2) }
}

export function blankToolDraft(name: string): MockMcpToolDraft {
  return toolToDraft({
    name,
    description: '',
    inputSchema: { type: 'object', properties: {} },
    response: { kind: 'text', body: 'ok' },
  })
}

export function serverToDraft(s: MockMcpServer): MockMcpServerDraft {
  return {
    name: s.name,
    description: s.description,
    host: s.host,
    port: s.port,
    path: s.path,
    legacySse: s.legacySse,
    protocolPin: s.protocolPin,
    authMode: s.authMode,
    bearerToken: s.bearerToken,
    latencyMs: s.latencyMs,
    errorMode: { ...s.errorMode },
    tools: s.tools.map(toolToDraft),
    resources: s.resources.map((r) => ({ ...r })),
    prompts: s.prompts.map((p) => ({
      ...p,
      arguments: p.arguments?.map((a) => ({ ...a })),
      messages: p.messages.map((m) => ({ ...m })),
    })),
  }
}

/** Keep only the fields the chosen kind uses, so the stored row stays tidy. */
export function cleanErrorMode(mode: MockMcpErrorMode): MockMcpErrorMode {
  const out: MockMcpErrorMode = { kind: mode.kind }
  if (mode.kind === 'none') return out
  if (mode.kind === 'jsonrpc' && mode.code !== undefined) out.code = mode.code
  if ((mode.kind === 'jsonrpc' || mode.kind === 'isError') && mode.message) {
    out.message = mode.message
  }
  if (mode.kind === 'http' && mode.httpStatus !== undefined) out.httpStatus = mode.httpStatus
  if (mode.everyN !== undefined && mode.everyN > 1) out.everyN = mode.everyN
  return out
}

export type SchemaParse =
  | { schema: Record<string, unknown>; problem?: undefined }
  | { schema?: undefined; problem: 'json' | 'notObject' | 'typeObject'; detail?: string }

/** Parse a tool's input schema text; it must be a JSON object with `"type": "object"`. */
export function parseSchemaText(text: string): SchemaParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { problem: 'json', detail: (e as Error).message }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { problem: 'notObject' }
  }
  const schema = parsed as Record<string, unknown>
  if (schema.type !== 'object') return { problem: 'typeObject' }
  return { schema }
}

/** Optional string: trimmed-empty → omitted. */
function opt(v: string | undefined): string | undefined {
  return v !== undefined && v.trim() !== '' ? v : undefined
}

/** `base` plus every extra that is not `undefined` — keeps optional keys absent, not `undefined`. */
function withOptional<T extends object>(base: T, extras: Partial<T>): T {
  const out = { ...base }
  for (const key of Object.keys(extras) as (keyof T)[]) {
    const v = extras[key]
    if (v !== undefined) out[key] = v as T[keyof T]
  }
  return out
}

export function draftToTool(d: MockMcpToolDraft, schema: Record<string, unknown>): MockMcpTool {
  const response: MockMcpTool['response'] = { kind: d.response.kind, body: d.response.body }
  if (d.response.isError) response.isError = true
  return withOptional<MockMcpTool>(
    { name: d.name.trim(), inputSchema: schema, response },
    {
      title: opt(d.title),
      description: opt(d.description),
      delayMs: d.delayMs !== undefined && d.delayMs > 0 ? d.delayMs : undefined,
      error: d.error ? cleanErrorMode(d.error) : undefined,
    },
  )
}

export function cleanResource(r: MockMcpResource): MockMcpResource {
  return withOptional<MockMcpResource>(
    { name: r.name.trim() },
    {
      uri: opt(r.uri),
      uriTemplate: opt(r.uriTemplate),
      title: opt(r.title),
      description: opt(r.description),
      mimeType: opt(r.mimeType),
      text: r.text !== undefined && r.text !== '' ? r.text : undefined,
      blob: opt(r.blob),
    },
  )
}

export function cleanPrompt(p: MockMcpPrompt): MockMcpPrompt {
  const args = (p.arguments ?? []).map((a) =>
    withOptional<{ name: string; description?: string; required?: boolean }>(
      { name: a.name.trim() },
      { description: opt(a.description), required: a.required ? true : undefined },
    ),
  )
  return withOptional<MockMcpPrompt>(
    { name: p.name.trim(), messages: p.messages.map((m) => ({ role: m.role, text: m.text })) },
    {
      title: opt(p.title),
      description: opt(p.description),
      arguments: args.length > 0 ? args : undefined,
    },
  )
}

export type DraftProblem = {
  /** i18n key; `{tool}` / `{detail}` are substituted by the caller. */
  key: string
  tool: string
  detail: string
}

export type PatchResult =
  | { patch: MockMcpServerPatch; problem?: undefined }
  | { patch?: undefined; problem: DraftProblem }

/**
 * Build the `update` payload. Only problems the backend cannot report
 * clearly (unparseable schema text) are caught here; everything else —
 * duplicate names, uri vs uriTemplate, ranges — is validated by the backend
 * and its message is shown as-is.
 */
export function draftToPatch(draft: MockMcpServerDraft): PatchResult {
  const tools: MockMcpTool[] = []
  for (const d of draft.tools) {
    const parsed = parseSchemaText(d.schemaText)
    if (!parsed.schema) {
      const key =
        parsed.problem === 'json'
          ? 'mockMcp.validation.schemaJson'
          : parsed.problem === 'notObject'
            ? 'mockMcp.validation.schemaNotObject'
            : 'mockMcp.validation.schemaType'
      return { problem: { key, tool: d.name || '?', detail: parsed.detail ?? '' } }
    }
    tools.push(draftToTool(d, parsed.schema))
  }
  return {
    patch: {
      name: draft.name.trim(),
      description: draft.description,
      host: draft.host.trim(),
      port: draft.port,
      path: draft.path.trim(),
      legacySse: draft.legacySse,
      protocolPin: draft.protocolPin || null,
      authMode: draft.authMode,
      bearerToken: draft.bearerToken,
      latencyMs: draft.latencyMs,
      errorMode: cleanErrorMode(draft.errorMode),
      tools,
      resources: draft.resources.map(cleanResource),
      prompts: draft.prompts.map(cleanPrompt),
    },
  }
}

/** URL the server is (or would be) reachable at. Live state wins over config. */
export function connectUrl(
  server: Pick<MockMcpServer, 'host' | 'port' | 'path'>,
  liveUrl: string | null | undefined,
): string {
  if (liveUrl) return liveUrl
  const host = server.host === '0.0.0.0' || server.host === '::' ? '127.0.0.1' : server.host
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${hostPart}:${server.port}${server.path}`
}

/** Legacy SSE URL (`<path>/sse`) — only meaningful with `legacySse` on. */
export function sseConnectUrl(
  server: Pick<MockMcpServer, 'host' | 'port' | 'path'>,
  liveSseUrl: string | null | undefined,
): string {
  if (liveSseUrl) return liveSseUrl
  const base = connectUrl(server, null)
  return server.path === '/' ? `${base.replace(/\/$/, '')}/sse` : `${base}/sse`
}

/** Cryptographically random bearer token for the "Generate" button. */
export function generateBearerToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `mcp_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
