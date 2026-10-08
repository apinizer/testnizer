/**
 * Builds one v2 SDK `Server` (low-level) from a mock definition — the factory
 * behind `createMcpHandler` (one instance per HTTP request, either era) and
 * behind each legacy HTTP+SSE session (issue #140, v2 migration issue #152).
 *
 * Why the low-level `Server` and not `McpServer.registerTool(fromJsonSchema(…))`:
 *   - `McpServer`'s `tools/call` wraps EVERY error a tool handler throws into an
 *     `isError` result (server/dist/mcp-*.cjs `setToolRequestHandlers` → catch →
 *     `createToolError`), which would make error mode `jsonrpc` (a real
 *     JSON-RPC error with the configured code) impossible;
 *   - `tools/list` there re-emits the schema as `{ type: 'object', ...schema }`
 *     (`standardSchemaToJsonSchema`), i.e. not byte-for-byte.
 * Here `tools/list` returns the authored `inputSchema` verbatim and
 * `tools/call` validates arguments with the same ajv engine
 * (`args-validator.ts`), mirroring McpServer's "Input validation error"
 * isError result. The SDK still applies its own seams to these handlers:
 * result validation, `cacheHints` on list results, the `input_required`
 * checks and `requestState` verification (elicitation.ts).
 *
 * Handlers read the definition through `hooks.getDef()` at call time; with
 * one instance per request a hot reload reaches the very next request.
 */

import { randomUUID } from 'node:crypto'
import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  Server,
  UriTemplate,
  type CacheHint,
  type CallToolResult,
  type ReadResourceResult,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { renderTemplate, type TemplateContext } from '../mock/template'
import { mockJsonSchemaValidator, validateArgs } from './args-validator'
import { resolveElicitation, type ElicitationCodec } from './elicitation'
import type { MockMcpEra, MockMcpErrorMode, MockMcpServerDef, MockMcpTool } from './types'

export interface ServerHooks {
  /** Live definition (hot reload). */
  getDef(): MockMcpServerDef
  /** The protocol era this instance serves. */
  era: MockMcpEra
  /** Count one call against `key`; true when the error applies to this call. */
  rollError(key: string, everyN: number | undefined): boolean
  /** Env vars for template rendering, or undefined (no project scope). */
  loadEnv(): Record<string, string> | undefined
  /** Per-server `requestState` codec for elicitation. */
  codec: ElicitationCodec
}

/** The error mode a call to `tool` runs under (tool override beats server). */
export function effectiveErrorMode(
  def: MockMcpServerDef,
  tool: MockMcpTool | undefined,
): { mode: MockMcpErrorMode; counterKey: string } {
  if (tool?.error) return { mode: tool.error, counterKey: `tool:${tool.name}` }
  return { mode: def.errorMode, counterKey: '*' }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Never settles until the request is cancelled or its exchange closes. */
function hang(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

/** Request headers of the HTTP exchange (lower-cased), for `{{request.headers.x}}`. */
function headersOf(ctx: ServerContext): Record<string, string> {
  const out: Record<string, string> = {}
  ctx.http?.req?.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

interface RenderInput {
  method: string
  path: string
  headers: Record<string, string>
  args?: Record<string, unknown>
  params?: Record<string, string>
  extra?: Record<string, unknown>
}

function render(
  source: string,
  input: RenderInput,
  envVars: Record<string, string> | undefined,
): string {
  const args = input.args ?? {}
  const ctx: TemplateContext & Record<string, unknown> = {
    request: {
      method: input.method,
      path: input.path,
      headers: input.headers,
      query: {},
      params: input.params ?? {},
      body: args,
      bodyText: JSON.stringify(args),
    },
    envVars,
    args,
    params: input.params ?? {},
    now: new Date().toISOString(),
    timestamp: Date.now(),
    uuid: randomUUID(),
    ...input.extra,
  }
  return renderTemplate(source, ctx)
}

function toolResult(
  tool: MockMcpTool,
  args: Record<string, unknown>,
  input: RenderInput,
  envVars: Record<string, string> | undefined,
): CallToolResult {
  const { kind, body, isError } = tool.response
  const flag = isError ? { isError: true } : {}
  // After an elicitation round, an authored `responseTemplate` replaces the body.
  if (input.extra?.input !== undefined && tool.elicit?.responseTemplate !== undefined) {
    return {
      content: [
        { type: 'text', text: render(tool.elicit.responseTemplate, { ...input, args }, envVars) },
      ],
      ...flag,
    }
  }
  if (kind === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `Mock tool "${tool.name}" has an invalid JSON response body: ${(e as Error).message}`,
          },
        ],
        isError: true,
      }
    }
    const structured =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { result: parsed }
    return { content: [{ type: 'text', text: body }], structuredContent: structured, ...flag }
  }
  const text = kind === 'template' ? render(body, { ...input, args }, envVars) : body
  return { content: [{ type: 'text', text }], ...flag }
}

/**
 * `ttlMs` / `cacheScope` for the cacheable list results (2026-07-28 only).
 * Tolerates a definition built without the field (callers predating #152):
 * the SDK throws a RangeError for an invalid hint.
 */
function listCacheHints(ttlMs: number | undefined): Record<string, CacheHint> {
  const safe = typeof ttlMs === 'number' && Number.isSafeInteger(ttlMs) && ttlMs > 0 ? ttlMs : 0
  const hint: CacheHint = { ttlMs: safe, cacheScope: 'private' }
  return {
    'tools/list': hint,
    'prompts/list': hint,
    'resources/list': hint,
    'resources/templates/list': hint,
  }
}

export function createMockMcpSdkServer(hooks: ServerHooks): Server {
  const initial = hooks.getDef()
  const description = initial.description.trim()
  const server = new Server(
    { name: initial.name || 'Testnizer Mock MCP', version: '1.0.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
      ...(description ? { instructions: description } : {}),
      cacheHints: listCacheHints(initial.cacheTtlMs),
      jsonSchemaValidator: mockJsonSchemaValidator,
      requestState: { verify: hooks.codec.verify },
      // Never push server→client requests on a stateless legacy POST; the
      // elicitation scenario answers 2025-era calls with a note instead.
      inputRequired: { legacyShim: false },
    },
  )

  // ── tools ────────────────────────────────────────────────────
  server.setRequestHandler('tools/list', () => ({
    tools: hooks.getDef().tools.map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema as { type: 'object'; [key: string]: unknown },
    })),
  }))

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const def = hooks.getDef()
    const name = request.params.name
    const tool = def.tools.find((t) => t.name === name)
    if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Tool ${name} not found`)
    const args = (request.params.arguments ?? {}) as Record<string, unknown>

    const valid = validateArgs(tool.inputSchema, args)
    if (!valid.ok) {
      return {
        content: [
          {
            type: 'text',
            text: `Input validation error: Invalid arguments for tool ${name}: ${valid.message}`,
          },
        ],
        isError: true,
      }
    }

    const signal = ctx.mcpReq.signal
    if (tool.delayMs && tool.delayMs > 0) await sleep(tool.delayMs, signal)

    // `http` is decided at the HTTP layer (it never reaches a handler).
    const { mode, counterKey } = effectiveErrorMode(def, tool)
    if (mode.kind !== 'none' && mode.kind !== 'http' && hooks.rollError(counterKey, mode.everyN)) {
      if (mode.kind === 'jsonrpc') {
        throw new ProtocolError(
          mode.code ?? ProtocolErrorCode.InternalError,
          mode.message || 'Mock JSON-RPC error',
        )
      }
      if (mode.kind === 'isError') {
        return {
          content: [{ type: 'text', text: mode.message || `Mock tool error from ${name}` }],
          isError: true,
        }
      }
      return hang(signal) // timeout
    }

    const extra: Record<string, unknown> = { tool: name }
    if (tool.elicit) {
      const outcome = await resolveElicitation(name, tool.elicit, hooks.era, ctx, hooks.codec)
      if (outcome.kind === 'answer') return outcome.result
      extra.input = outcome.input
    }

    const result = toolResult(
      tool,
      args,
      { method: 'tools/call', path: def.path, headers: headersOf(ctx), extra },
      hooks.loadEnv(),
    )
    return server.projectCallToolResult(result, undefined)
  })

  // ── resources ────────────────────────────────────────────────
  server.setRequestHandler('resources/list', () => ({
    resources: hooks
      .getDef()
      .resources.filter((r) => !!r.uri)
      .map((r) => ({
        uri: r.uri as string,
        name: r.name,
        ...(r.title ? { title: r.title } : {}),
        ...(r.description ? { description: r.description } : {}),
        ...(r.mimeType ? { mimeType: r.mimeType } : {}),
      })),
  }))

  server.setRequestHandler('resources/templates/list', () => ({
    resourceTemplates: hooks
      .getDef()
      .resources.filter((r) => !!r.uriTemplate)
      .map((r) => ({
        uriTemplate: r.uriTemplate as string,
        name: r.name,
        ...(r.title ? { title: r.title } : {}),
        ...(r.description ? { description: r.description } : {}),
        ...(r.mimeType ? { mimeType: r.mimeType } : {}),
      })),
  }))

  server.setRequestHandler('resources/read', (request, ctx): ReadResourceResult => {
    const def = hooks.getDef()
    const uri = request.params.uri
    const content = (
      r: (typeof def.resources)[number],
      params: Record<string, string> | null,
    ): ReadResourceResult => {
      const mime = r.mimeType ? { mimeType: r.mimeType } : {}
      if (r.text === undefined && r.blob !== undefined) {
        return { contents: [{ uri, blob: r.blob, ...mime }] }
      }
      const raw = r.text ?? ''
      const text = params
        ? render(
            raw,
            {
              method: 'resources/read',
              path: def.path,
              headers: headersOf(ctx),
              params,
              extra: { uri },
            },
            hooks.loadEnv(),
          )
        : raw
      return { contents: [{ uri, text, ...mime }] }
    }

    const exact = def.resources.find((r) => r.uri === uri)
    if (exact) return content(exact, null)
    for (const r of def.resources) {
      if (!r.uriTemplate) continue
      let vars: Record<string, string | string[]> | null = null
      try {
        vars = new UriTemplate(r.uriTemplate).match(uri)
      } catch {
        vars = null
      }
      if (vars) {
        const params: Record<string, string> = {}
        for (const [k, v] of Object.entries(vars)) params[k] = Array.isArray(v) ? v.join(',') : v
        return content(r, params)
      }
    }
    // v2 answers a resources/read miss with -32602 on every revision (spec).
    throw new ResourceNotFoundError(uri, `Resource ${uri} not found`)
  })

  // ── prompts ──────────────────────────────────────────────────
  server.setRequestHandler('prompts/list', () => ({
    prompts: hooks.getDef().prompts.map((p) => ({
      name: p.name,
      ...(p.title ? { title: p.title } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.arguments?.length ? { arguments: p.arguments } : {}),
    })),
  }))

  server.setRequestHandler('prompts/get', (request, ctx) => {
    const def = hooks.getDef()
    const name = request.params.name
    const prompt = def.prompts.find((p) => p.name === name)
    if (!prompt)
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Prompt ${name} not found`)
    const args = request.params.arguments ?? {}
    const missing = (prompt.arguments ?? []).filter(
      (a) => a.required && (args[a.name] === undefined || args[a.name] === ''),
    )
    if (missing.length) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Invalid arguments for prompt ${name}: missing required argument${missing.length > 1 ? 's' : ''} ${missing.map((a) => a.name).join(', ')}`,
      )
    }
    const envVars = hooks.loadEnv()
    const headers = headersOf(ctx)
    return {
      ...(prompt.description ? { description: prompt.description } : {}),
      messages: prompt.messages.map((m) => ({
        role: m.role,
        content: {
          type: 'text' as const,
          text: render(
            m.text,
            { method: 'prompts/get', path: def.path, headers, args, extra: { prompt: name } },
            envVars,
          ),
        },
      })),
    }
  })

  return server
}
