/**
 * Defaults, normalisation and validation for Mock MCP server configs.
 *
 * Shared by the repo (save-time validation → a readable `success:false`) and
 * the live server (start-time checks). Normalisers are tolerant: a row edited
 * by hand or by an older build parses into a usable shape rather than
 * throwing at request time.
 */

import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import { compileSchema } from './args-validator'
import type {
  MockMcpAuthMode,
  MockMcpErrorKind,
  MockMcpErrorMode,
  MockMcpPrompt,
  MockMcpResource,
  MockMcpServerDef,
  MockMcpTool,
} from './types'

export const DEFAULT_MCP_PATH = '/mcp'
export const DEFAULT_ERROR_MODE: MockMcpErrorMode = { kind: 'none' }
/** Protocol revisions the bundled SDK implements — the only valid pins. */
export const PINNABLE_PROTOCOL_VERSIONS: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS

const ERROR_KINDS: readonly MockMcpErrorKind[] = ['none', 'jsonrpc', 'isError', 'timeout', 'http']
const AUTH_MODES: readonly MockMcpAuthMode[] = ['none', 'bearer']
const MAX_LATENCY_MS = 10 * 60 * 1000

/** A fresh server is useful immediately: one echo tool, like the public echo mock. */
export function defaultTools(): MockMcpTool[] {
  return [
    {
      name: 'echo',
      description: 'Echoes the given text back.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to echo' } },
        required: ['text'],
      },
      response: { kind: 'template', body: '{{args.text}}' },
    },
  ]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function normalizeErrorMode(v: unknown): MockMcpErrorMode {
  if (!isRecord(v)) return { ...DEFAULT_ERROR_MODE }
  const kind = ERROR_KINDS.includes(v.kind as MockMcpErrorKind)
    ? (v.kind as MockMcpErrorKind)
    : 'none'
  const out: MockMcpErrorMode = { kind }
  const code = num(v.code)
  if (code !== undefined) out.code = Math.trunc(code)
  const message = str(v.message)
  if (message !== undefined) out.message = message
  const httpStatus = num(v.httpStatus)
  if (httpStatus !== undefined) out.httpStatus = Math.trunc(httpStatus)
  const everyN = num(v.everyN)
  if (everyN !== undefined) out.everyN = Math.trunc(everyN)
  return out
}

export function normalizeTools(v: unknown): MockMcpTool[] {
  if (!Array.isArray(v)) return []
  return v.filter(isRecord).map((t) => {
    const resp = isRecord(t.response) ? t.response : {}
    const kind =
      resp.kind === 'json' || resp.kind === 'template' || resp.kind === 'text' ? resp.kind : 'text'
    const tool: MockMcpTool = {
      name: str(t.name) ?? '',
      inputSchema: isRecord(t.inputSchema) ? t.inputSchema : { type: 'object' },
      response: { kind, body: str(resp.body) ?? '' },
    }
    if (resp.isError === true) tool.response.isError = true
    const title = str(t.title)
    if (title !== undefined) tool.title = title
    const description = str(t.description)
    if (description !== undefined) tool.description = description
    const delayMs = num(t.delayMs)
    if (delayMs !== undefined) tool.delayMs = Math.max(0, Math.trunc(delayMs))
    if (isRecord(t.error)) tool.error = normalizeErrorMode(t.error)
    return tool
  })
}

export function normalizeResources(v: unknown): MockMcpResource[] {
  if (!Array.isArray(v)) return []
  return v.filter(isRecord).map((r) => {
    const res: MockMcpResource = { name: str(r.name) ?? '' }
    for (const key of [
      'uri',
      'uriTemplate',
      'title',
      'description',
      'mimeType',
      'text',
      'blob',
    ] as const) {
      const val = str(r[key])
      if (val !== undefined) res[key] = val
    }
    return res
  })
}

export function normalizePrompts(v: unknown): MockMcpPrompt[] {
  if (!Array.isArray(v)) return []
  return v.filter(isRecord).map((p) => {
    const prompt: MockMcpPrompt = {
      name: str(p.name) ?? '',
      messages: (Array.isArray(p.messages) ? p.messages : []).filter(isRecord).map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        text: str(m.text) ?? '',
      })),
    }
    const title = str(p.title)
    if (title !== undefined) prompt.title = title
    const description = str(p.description)
    if (description !== undefined) prompt.description = description
    if (Array.isArray(p.arguments)) {
      prompt.arguments = p.arguments.filter(isRecord).map((a) => {
        const arg: { name: string; description?: string; required?: boolean } = {
          name: str(a.name) ?? '',
        }
        const d = str(a.description)
        if (d !== undefined) arg.description = d
        if (a.required === true) arg.required = true
        return arg
      })
    }
    return prompt
  })
}

/** Normalise a path: leading slash, no trailing slash (except root). */
export function normalizePath(p: string | undefined | null): string {
  let out = (p ?? '').trim() || DEFAULT_MCP_PATH
  if (!out.startsWith('/')) out = `/${out}`
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** Join `<base><suffix>` without a double slash when the base is the root. */
export function subPath(base: string, suffix: string): string {
  return base === '/' ? suffix : `${base}${suffix}`
}

type ValidatableConfig = Pick<
  MockMcpServerDef,
  | 'name'
  | 'host'
  | 'port'
  | 'path'
  | 'authMode'
  | 'latencyMs'
  | 'errorMode'
  | 'protocolPin'
  | 'tools'
  | 'resources'
  | 'prompts'
>

function errorModeProblem(mode: MockMcpErrorMode, where: string): string | null {
  if (!ERROR_KINDS.includes(mode.kind)) return `${where}: unknown error kind "${mode.kind}"`
  if (mode.everyN !== undefined && (!Number.isInteger(mode.everyN) || mode.everyN < 1)) {
    return `${where}: everyN must be a whole number ≥ 1`
  }
  if (
    mode.httpStatus !== undefined &&
    (!Number.isInteger(mode.httpStatus) || mode.httpStatus < 400 || mode.httpStatus > 599)
  ) {
    return `${where}: httpStatus must be between 400 and 599`
  }
  return null
}

/** Returns a user-facing problem description, or null when the config is valid. */
export function validateMockMcpConfig(cfg: ValidatableConfig): string | null {
  if (!cfg.name || !cfg.name.trim()) return 'Name is required'
  if (!cfg.host || !cfg.host.trim()) return 'Host is required'
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) {
    return 'Port must be a whole number between 0 and 65535'
  }
  if (!cfg.path.startsWith('/')) return 'Path must start with "/"'
  if (cfg.path.startsWith('/.well-known')) return 'Path must not be under /.well-known'
  if (!AUTH_MODES.includes(cfg.authMode)) return `Unknown auth mode "${cfg.authMode}"`
  if (!Number.isInteger(cfg.latencyMs) || cfg.latencyMs < 0 || cfg.latencyMs > MAX_LATENCY_MS) {
    return `Latency must be a whole number of milliseconds between 0 and ${MAX_LATENCY_MS}`
  }
  const modeProblem = errorModeProblem(cfg.errorMode, 'Error mode')
  if (modeProblem) return modeProblem
  if (cfg.protocolPin && !PINNABLE_PROTOCOL_VERSIONS.includes(cfg.protocolPin)) {
    return `Protocol pin "${cfg.protocolPin}" is not a version this mock implements (supported: ${PINNABLE_PROTOCOL_VERSIONS.join(', ')})`
  }

  const toolNames = new Set<string>()
  for (const t of cfg.tools) {
    if (!t.name || !t.name.trim()) return 'Every tool needs a name'
    if (toolNames.has(t.name)) return `Duplicate tool name "${t.name}"`
    toolNames.add(t.name)
    if (t.inputSchema.type !== 'object') {
      return `Tool "${t.name}": inputSchema must be a JSON Schema with "type": "object"`
    }
    const compiled = compileSchema(t.inputSchema)
    if (!compiled.ok)
      return `Tool "${t.name}": inputSchema is not a valid JSON Schema — ${compiled.error}`
    if (t.response.kind === 'json') {
      try {
        JSON.parse(t.response.body)
      } catch {
        return `Tool "${t.name}": response body is not valid JSON`
      }
    }
    if (t.error) {
      const p = errorModeProblem(t.error, `Tool "${t.name}" error override`)
      if (p) return p
    }
  }

  const uris = new Set<string>()
  for (const r of cfg.resources) {
    if (!r.name || !r.name.trim()) return 'Every resource needs a name'
    const hasUri = !!r.uri && !!r.uri.trim()
    const hasTemplate = !!r.uriTemplate && !!r.uriTemplate.trim()
    if (hasUri === hasTemplate) {
      return `Resource "${r.name}": set exactly one of uri or uriTemplate`
    }
    const key = (r.uri ?? r.uriTemplate) as string
    if (uris.has(key)) return `Duplicate resource "${key}"`
    uris.add(key)
  }

  const promptNames = new Set<string>()
  for (const p of cfg.prompts) {
    if (!p.name || !p.name.trim()) return 'Every prompt needs a name'
    if (promptNames.has(p.name)) return `Duplicate prompt name "${p.name}"`
    promptNames.add(p.name)
    for (const a of p.arguments ?? []) {
      if (!a.name || !a.name.trim()) return `Prompt "${p.name}": every argument needs a name`
    }
  }
  return null
}
