/**
 * MCP host config paste / export (issue #139). Pure — no store, no IPC.
 *
 * Shapes (checked against each host's docs, 2026-10):
 *  - Claude Desktop `claude_desktop_config.json`:
 *      { "mcpServers": { "<name>": { "command", "args"?, "env"? } } }
 *    stdio ONLY — remote servers are added through Settings → Connectors, not
 *    this file (support.claude.com/en/articles/11175166). A remote server is
 *    therefore exported through the `mcp-remote` stdio bridge
 *    (github.com/geelen/mcp-remote): `npx -y mcp-remote <url> --transport
 *    http-only|sse-only [--allow-http] --header "Name:${VAR}"` with the header
 *    value in `env` (the no-space `Name:${VAR}` form dodges the Windows
 *    arg-escaping bug the mcp-remote README warns about). Parsing reverses it.
 *  - VS Code `.vscode/mcp.json`:
 *      { "servers": { "<name>": { "type": "stdio", "command", "args"?, "env"? }
 *                              | { "type": "http"|"sse", "url", "headers"? } },
 *        "inputs"?: [...] }
 *    `type` is required (code.visualstudio.com/docs/agents/reference/mcp-configuration).
 *    The file is JSONC — comments / trailing commas are tolerated here.
 *  - Cursor `.cursor/mcp.json`:
 *      { "mcpServers": { "<name>": { "type": "stdio", "command", "args"?, "env"? }
 *                                 | { "url", "headers"? } } }
 *    Remote entries carry no `type` (cursor.com/docs/context/mcp); the
 *    transport is guessed from the URL (`…/sse` → sse, else Streamable HTTP).
 *  - A bare single-server object (`{ "command": … }` / `{ "url": … }`) or a
 *    name → server map without the wrapper key is accepted too.
 */
import type { McpTransport } from '../types/mcp'
import { joinCommandLine, parseCommandLine } from './mcp-command-line'

export type McpConfigHost = 'claude-desktop' | 'vscode' | 'cursor'

export const MCP_CONFIG_HOSTS: { id: McpConfigHost; label: string }[] = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor' },
]

export interface ParsedMcpServer {
  name: string
  transport: McpTransport
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
}

export class McpConfigError extends Error {}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x) => ['string', 'number', 'boolean'].includes(typeof x)).map(String)
  return out.length > 0 ? out : undefined
}

function toStringRecord(v: unknown): Record<string, string> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (['string', 'number', 'boolean'].includes(typeof val)) out[k] = String(val)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Drop empty optional fields so parse / format outputs stay minimal. */
function clean(s: ParsedMcpServer): ParsedMcpServer {
  const out: ParsedMcpServer = { name: s.name, transport: s.transport }
  if (s.url) out.url = s.url
  if (s.command) out.command = s.command
  if (s.args && s.args.length > 0) out.args = s.args
  if (s.env && Object.keys(s.env).length > 0) out.env = s.env
  if (s.headers && Object.keys(s.headers).length > 0) out.headers = s.headers
  return out
}

export function guessTransportFromUrl(url: string): McpTransport {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '')
  return /\/sse$/i.test(path) ? 'sse' : 'http'
}

/**
 * One string-aware pass over JSON text. `onChar` returns how many source
 * characters it consumed (0 = keep `ch` as-is) — used to drop comments and
 * trailing commas without touching string contents.
 */
function scanOutsideStrings(text: string, onChar: (i: number) => number): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      continue
    }
    const skip = onChar(i)
    if (skip > 0) {
      i += skip - 1
      continue
    }
    out += ch
  }
  return out
}

/** Remove `//` and block comments, then trailing commas (JSONC → JSON). */
export function stripJsonc(text: string): string {
  const noComments = scanOutsideStrings(text, (i) => {
    if (text[i] !== '/') return 0
    if (text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      return (nl < 0 ? text.length : nl) - i
    }
    if (text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      return (end < 0 ? text.length : end + 2) - i
    }
    return 0
  })
  return scanOutsideStrings(noComments, (i) => {
    if (noComments[i] !== ',') return 0
    let j = i + 1
    while (j < noComments.length && /\s/.test(noComments[j])) j++
    return noComments[j] === '}' || noComments[j] === ']' ? 1 : 0
  })
}

const MCP_REMOTE_VALUE_FLAGS = new Set([
  '--host',
  '--callback-path',
  '--resource',
  '--auth-timeout',
  '--connect-timeout',
  '--headers-timeout',
  '--body-timeout',
  '--ignore-tool',
  '--protocol',
  '--static-oauth-client-metadata',
  '--static-oauth-client-info',
  '--client-metadata-url',
  '--token-endpoint',
  '--authorize-param',
])

/** `npx -y mcp-remote <url> --header "Name:${VAR}"` → the remote server it wraps. */
function unwrapMcpRemote(
  command: string,
  args: string[],
  env: Record<string, string> | undefined,
): Pick<ParsedMcpServer, 'transport' | 'url' | 'headers'> | null {
  const isBridge = (a: string): boolean => /^mcp-remote(@.+)?$/.test(a)
  let rest: string[]
  if (isBridge(command.split(/[\\/]/).pop() ?? '')) rest = args
  else {
    const idx = args.findIndex(isBridge)
    if (idx < 0) return null
    rest = args.slice(idx + 1)
  }
  let url: string | undefined
  let transportFlag: string | undefined
  const headers: Record<string, string> = {}
  const sub = (v: string): string => v.replace(/\$\{([^}]+)\}/g, (m, k: string) => env?.[k] ?? m)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--header' && i + 1 < rest.length) {
      const h = rest[++i]
      const colon = h.indexOf(':')
      if (colon > 0) headers[h.slice(0, colon).trim()] = sub(h.slice(colon + 1).trim())
    } else if (a === '--transport' && i + 1 < rest.length) transportFlag = rest[++i]
    else if (MCP_REMOTE_VALUE_FLAGS.has(a)) i++
    else if (!a.startsWith('-') && !url && /^https?:\/\//i.test(a)) url = a
  }
  if (!url) return null
  const transport: McpTransport = transportFlag?.startsWith('sse')
    ? 'sse'
    : transportFlag?.startsWith('http')
      ? 'http'
      : guessTransportFromUrl(url)
  return { transport, url, headers }
}

function normalizeEntry(name: string, raw: Obj): ParsedMcpServer | null {
  const type = (str(raw.type) ?? '').toLowerCase()
  const url = str(raw.url) ?? str(raw.serverUrl) ?? str(raw.httpUrl)
  const command = str(raw.command)
  if (type === 'stdio' || (!url && command)) {
    if (!command) return null
    const args = toStringArray(raw.args) ?? []
    const env = toStringRecord(raw.env)
    const remote = unwrapMcpRemote(command, args, env)
    if (remote) return clean({ name, ...remote })
    return clean({ name, transport: 'stdio', command, args, env })
  }
  if (!url) return null
  let transport: McpTransport
  if (type === 'sse') transport = 'sse'
  else if (['http', 'streamable-http', 'streamablehttp'].includes(type)) transport = 'http'
  else transport = guessTransportFromUrl(url)
  return clean({ name, transport, url, headers: toStringRecord(raw.headers) })
}

const looksLikeServer = (v: unknown): v is Obj =>
  isObj(v) && (!!str(v.command) || !!str(v.url) || !!str(v.serverUrl) || !!str(v.httpUrl))

function collectEntries(root: Obj): [string, Obj][] {
  const asEntries = (m: Obj): [string, Obj][] =>
    Object.entries(m).filter((e): e is [string, Obj] => isObj(e[1]))
  if (isObj(root.mcpServers)) return asEntries(root.mcpServers)
  if (isObj(root.servers)) return asEntries(root.servers)
  if (isObj(root.mcp) && isObj(root.mcp.servers)) return asEntries(root.mcp.servers)
  if (looksLikeServer(root)) return [[str(root.name) ?? 'server', root]]
  const values = Object.values(root)
  if (values.length > 0 && values.every(looksLikeServer)) return asEntries(root)
  return []
}

/** Parse a pasted host config into its server entries. Throws `McpConfigError`. */
export function parseMcpConfig(text: string): ParsedMcpServer[] {
  if (!text.trim()) throw new McpConfigError('Config is empty')
  let root: unknown
  try {
    root = JSON.parse(stripJsonc(text))
  } catch (e) {
    throw new McpConfigError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isObj(root)) throw new McpConfigError('Config must be a JSON object')
  const servers = collectEntries(root)
    .map(([name, raw]) => normalizeEntry(name, raw))
    .filter((s): s is ParsedMcpServer => s !== null)
  if (servers.length === 0) throw new McpConfigError('No MCP servers found in config')
  return servers
}

function headerEnvName(header: string, taken: Set<string>): string {
  const base = `MCP_HEADER_${
    header
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'VALUE'
  }`
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
  taken.add(name)
  return name
}

function needsAllowHttp(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

function claudeDesktopRemote(s: ParsedMcpServer): Obj {
  const args = ['-y', 'mcp-remote', s.url ?? '']
  args.push('--transport', s.transport === 'sse' ? 'sse-only' : 'http-only')
  if (needsAllowHttp(s.url ?? '')) args.push('--allow-http')
  const env: Record<string, string> = {}
  const taken = new Set<string>()
  for (const [name, value] of Object.entries(s.headers ?? {})) {
    const v = headerEnvName(name, taken)
    args.push('--header', `${name}:\${${v}}`)
    env[v] = value
  }
  return Object.keys(env).length > 0 ? { command: 'npx', args, env } : { command: 'npx', args }
}

function stdioEntry(s: ParsedMcpServer, withType: boolean): Obj {
  const entry: Obj = withType ? { type: 'stdio' } : {}
  entry.command = s.command ?? ''
  if (s.args && s.args.length > 0) entry.args = s.args
  if (s.env && Object.keys(s.env).length > 0) entry.env = s.env
  return entry
}

function remoteEntry(s: ParsedMcpServer, type?: string): Obj {
  const entry: Obj = type ? { type, url: s.url ?? '' } : { url: s.url ?? '' }
  if (s.headers && Object.keys(s.headers).length > 0) entry.headers = s.headers
  return entry
}

/** Render one server as the given host's config file. */
export function formatMcpConfig(server: ParsedMcpServer, host: McpConfigHost): string {
  const name = server.name || 'mcp-server'
  const stdio = server.transport === 'stdio'
  let doc: Obj
  if (host === 'vscode') {
    doc = {
      servers: { [name]: stdio ? stdioEntry(server, true) : remoteEntry(server, server.transport) },
    }
  } else if (host === 'cursor') {
    doc = { mcpServers: { [name]: stdio ? stdioEntry(server, true) : remoteEntry(server) } }
  } else {
    doc = {
      mcpServers: { [name]: stdio ? stdioEntry(server, false) : claudeDesktopRemote(server) },
    }
  }
  return JSON.stringify(doc, null, 2)
}

export function slugifyServerName(name: string | null | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'mcp-server'
}

/** Tab fields → server. stdio keeps its command line in the URL field. */
export function serverFromTabFields(input: {
  name: string
  transport: McpTransport
  url: string
  headers?: Record<string, string>
  env?: Record<string, string>
}): ParsedMcpServer {
  if (input.transport === 'stdio') {
    const { command, args } = parseCommandLine(input.url)
    return clean({ name: input.name, transport: 'stdio', command, args, env: input.env })
  }
  return clean({
    name: input.name,
    transport: input.transport,
    url: input.url.trim(),
    headers: input.headers,
  })
}

/** Server → the value the tab keeps in its URL field. */
export function tabUrlForServer(server: ParsedMcpServer): string {
  if (server.transport === 'stdio') return joinCommandLine(server.command ?? '', server.args ?? [])
  return server.url ?? ''
}
