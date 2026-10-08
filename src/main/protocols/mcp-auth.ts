/**
 * Authorization tab of an MCP request (MCP Auth) — pure, Electron-free, no
 * SDK import: shared by the client connect (`mcp.engine.ts`) and the
 * Security Scan's authenticated requests (`mcp-security.engine.ts`), and the
 * one validator both IPC handlers run on the renderer's `auth` payload.
 */

/**
 * The MCP request's Authorization tab, `{{var}}`-resolved by the renderer.
 * Same shape as the HTTP `AuthConfig` for `basic` / `bearer` / `apiKey`;
 * `none` and `oauth2` add nothing here (the OAuth token comes from the
 * session's fetch wrapper).
 */
export interface McpAuthOptions {
  type: 'none' | 'basic' | 'bearer' | 'api-key' | 'oauth2'
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
}

const AUTH_TYPES = new Set<McpAuthOptions['type']>(['none', 'basic', 'bearer', 'api-key', 'oauth2'])

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Defensive copy of the renderer's `auth` — a known `type` and string fields
 * only; anything else is dropped (`undefined`) rather than crashing a connect
 * or a scan.
 */
export function parseMcpAuth(raw: unknown): McpAuthOptions | undefined {
  if (!isRecord(raw)) return undefined
  const type = raw.type as McpAuthOptions['type']
  if (typeof type !== 'string' || !AUTH_TYPES.has(type)) return undefined
  const out: McpAuthOptions = { type }
  if (isRecord(raw.basic)) {
    out.basic = { username: str(raw.basic.username), password: str(raw.basic.password) }
  }
  if (isRecord(raw.bearer)) {
    out.bearer = { token: str(raw.bearer.token) }
    if (typeof raw.bearer.prefix === 'string') out.bearer.prefix = raw.bearer.prefix
  }
  if (isRecord(raw.apiKey)) {
    out.apiKey = {
      key: str(raw.apiKey.key),
      value: str(raw.apiKey.value),
      in: raw.apiKey.in === 'query' ? 'query' : 'header',
    }
  }
  return out
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

/**
 * Add `name` unless the user already set it (case-insensitive). undici's
 * "invalid header value" error echoes the value, so a credential with a stray
 * line break (multi-line env var) is refused here without echoing it.
 */
function setUnlessPresent(headers: Record<string, string>, name: string, value: string): void {
  if (hasHeader(headers, name)) return
  if (/[\r\n]/.test(value)) {
    throw new Error(`Authorization value for "${name}" contains a line break`)
  }
  headers[name] = value
}

/**
 * Effective URL + headers of an http / sse request: the Authorization tab
 * fills only what the user did not set — an explicit custom header row with
 * the same name (case-insensitive) wins, exactly like the HTTP engine's
 * Headers tab vs auth config (issue #48). The OAuth session token, when
 * present, is applied later by `createMcpOAuthFetch` and wins over both.
 *
 * `api-key` in `query` adds `key=value` to the URL (keeping any existing
 * query; a parameter of that name already in the URL wins). Callers must
 * keep the ORIGINAL url for logs / results — the returned one carries the
 * key. Never mutates `headers`.
 */
export function applyMcpAuth(
  url: string,
  headers: Record<string, string> | undefined,
  auth: McpAuthOptions | undefined,
): { url: string; headers: Record<string, string> } {
  const out: Record<string, string> = { ...(headers ?? {}) }
  if (!auth) return { url, headers: out }
  switch (auth.type) {
    case 'basic': {
      // RFC 7617 §2: the first `:` separates user from password — strip any
      // in the username, as the HTTP engine does.
      const username = (auth.basic?.username ?? '').replace(/:/g, '')
      const password = auth.basic?.password ?? ''
      if (username || password) {
        const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
        setUnlessPresent(out, 'Authorization', `Basic ${encoded}`)
      }
      break
    }
    case 'bearer': {
      const token = (auth.bearer?.token ?? '').trim()
      if (token) {
        const prefix = (auth.bearer?.prefix ?? '').trim() || 'Bearer'
        setUnlessPresent(out, 'Authorization', `${prefix} ${token}`)
      }
      break
    }
    case 'api-key': {
      const key = (auth.apiKey?.key ?? '').trim()
      if (!key) break
      const value = auth.apiKey?.value ?? ''
      if (auth.apiKey?.in === 'query') {
        const u = new URL(url)
        if (u.searchParams.has(key)) break
        u.searchParams.set(key, value)
        return { url: u.toString(), headers: out }
      }
      setUnlessPresent(out, key, value)
      break
    }
    default:
      break
  }
  return { url, headers: out }
}
