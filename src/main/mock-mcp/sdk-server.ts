/**
 * Builds one SDK `Server` (low-level) per MCP session from a mock definition.
 *
 * Why the low-level `Server` and not `McpServer.registerTool`: on SDK 1.29
 * `registerTool` only accepts zod schemas, so a user's JSON Schema would have
 * to be converted to zod and back — lossy for anything beyond the common
 * subset ($ref, oneOf/anyOf, formats, nested constraints), which is exactly
 * what a "complex schema" mock exists to exercise. Here `tools/list` returns
 * the authored `inputSchema` verbatim and `tools/call` validates arguments
 * against that same schema with ajv, mirroring McpServer's "Input validation
 * error" isError result.
 *
 * Handlers read the definition through `hooks.getDef()` at call time, so a
 * hot-reloaded definition reaches live sessions without reconnecting.
 */

import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  InitializeRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
  type InitializeResult,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { renderTemplate, type TemplateContext } from '../mock/template'
import { validateArgs } from './args-validator'
import type { MockMcpErrorMode, MockMcpServerDef, MockMcpTool } from './types'

/** JSON-RPC error code MCP uses for an unknown resource URI. */
export const RESOURCE_NOT_FOUND = -32002

export interface SessionHooks {
  /** Live definition (hot reload). */
  getDef(): MockMcpServerDef
  /** Effective protocol pin for this session (`?rev=` beats the server's pin). */
  pin: string | null
  /** Count one call against `key`; true when the error applies to this call. */
  rollError(key: string, everyN: number | undefined): boolean
  /** Env vars for template rendering, or undefined (no project scope). */
  loadEnv(): Record<string, string> | undefined
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

/** Never settles until the request is cancelled or its session closes. */
function hang(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

function flattenHeaders(
  h: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h ?? {})) {
    if (Array.isArray(v)) out[k.toLowerCase()] = v.join(', ')
    else if (v !== undefined) out[k.toLowerCase()] = String(v)
  }
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

function unsupportedVersion(requested: string, pin: string): McpError {
  const supported = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(pin) ? [pin] : []
  const message = supported.length
    ? `Unsupported protocol version: ${requested} (supported versions: ${supported.join(', ')})`
    : `Unsupported protocol version: ${requested} (this mock is pinned to ${pin}, which the bundled MCP SDK does not implement)`
  return new McpError(ErrorCode.InvalidParams, message, { supported, requested })
}

export function createMockMcpSdkServer(hooks: SessionHooks): Server {
  const initial = hooks.getDef()
  const serverInfo = { name: initial.name || 'Testnizer Mock MCP', version: '1.0.0' }
  const capabilities = {
    tools: { listChanged: true },
    resources: { listChanged: true },
    prompts: { listChanged: true },
  }
  const server = new Server(serverInfo, {
    capabilities,
    ...(initial.description.trim() ? { instructions: initial.description } : {}),
  })

  // ── initialize: protocol pin ─────────────────────────────────
  // Replaces the SDK's own handler only to add the pin check; the result
  // mirrors Server#_oninitialize (negotiate within SUPPORTED_PROTOCOL_VERSIONS).
  server.setRequestHandler(InitializeRequestSchema, (request): InitializeResult => {
    const requested = request.params.protocolVersion
    if (hooks.pin && requested !== hooks.pin) throw unsupportedVersion(requested, hooks.pin)
    const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION
    const description = hooks.getDef().description.trim()
    return {
      protocolVersion,
      capabilities,
      serverInfo,
      ...(description ? { instructions: description } : {}),
    }
  })

  // ── tools ────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: hooks.getDef().tools.map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema as { type: 'object'; [key: string]: unknown },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const def = hooks.getDef()
    const name = request.params.name
    const tool = def.tools.find((t) => t.name === name)
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`)
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

    if (tool.delayMs && tool.delayMs > 0) await sleep(tool.delayMs, extra.signal)

    // `http` is decided at the HTTP layer (it never reaches a handler).
    const { mode, counterKey } = effectiveErrorMode(def, tool)
    if (mode.kind !== 'none' && mode.kind !== 'http' && hooks.rollError(counterKey, mode.everyN)) {
      if (mode.kind === 'jsonrpc') {
        throw new McpError(
          mode.code ?? ErrorCode.InternalError,
          mode.message || 'Mock JSON-RPC error',
        )
      }
      if (mode.kind === 'isError') {
        return {
          content: [{ type: 'text', text: mode.message || `Mock tool error from ${name}` }],
          isError: true,
        }
      }
      return hang(extra.signal) // timeout
    }

    const headers = flattenHeaders(extra.requestInfo?.headers)
    return toolResult(
      tool,
      args,
      { method: 'tools/call', path: def.path, headers, extra: { tool: name } },
      hooks.loadEnv(),
    )
  })

  // ── resources ────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
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

  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
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

  server.setRequestHandler(ReadResourceRequestSchema, (request, extra): ReadResourceResult => {
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
              headers: flattenHeaders(extra.requestInfo?.headers),
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
    throw new McpError(RESOURCE_NOT_FOUND, `Resource ${uri} not found`, { uri })
  })

  // ── prompts ──────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: hooks.getDef().prompts.map((p) => ({
      name: p.name,
      ...(p.title ? { title: p.title } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.arguments?.length ? { arguments: p.arguments } : {}),
    })),
  }))

  server.setRequestHandler(GetPromptRequestSchema, (request, extra) => {
    const def = hooks.getDef()
    const name = request.params.name
    const prompt = def.prompts.find((p) => p.name === name)
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Prompt ${name} not found`)
    const args = request.params.arguments ?? {}
    const missing = (prompt.arguments ?? []).filter(
      (a) => a.required && (args[a.name] === undefined || args[a.name] === ''),
    )
    if (missing.length) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for prompt ${name}: missing required argument${missing.length > 1 ? 's' : ''} ${missing.map((a) => a.name).join(', ')}`,
      )
    }
    const envVars = hooks.loadEnv()
    const headers = flattenHeaders(extra.requestInfo?.headers)
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
