/**
 * MCP Authorization tab (MCP Auth, issue #139 follow-up) — the pure half of
 * the per-tab auth state in `mcp.store.ts`: defaults, a tolerant parser for
 * saved / persisted configs, the `{{var}}` resolution Connect sends to main,
 * and the config-tab rules of the strip under the connection bar.
 *
 * Kept out of `mcp.store.ts` (already large) and free of store / IPC imports
 * so it unit-tests without a bridge mock.
 */
import type {
  McpAuthConfig,
  McpAuthType,
  McpConfigTab,
  McpConnectAuth,
  McpTransport,
} from '../types/mcp'
import { resolveVariables } from '../lib/variable-resolver'

export const MCP_AUTH_TYPES: readonly McpAuthType[] = [
  'none',
  'basic',
  'bearer',
  'api-key',
  'oauth2',
]

export function defaultMcpAuth(): McpAuthConfig {
  return { type: 'none' }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Saved metadata / localStorage → a well-formed config. Unknown types fall
 * back to `none`; sub-objects are kept for every type so switching the type
 * back and forth does not lose what the user typed.
 */
export function normalizeMcpAuth(raw: unknown): McpAuthConfig {
  if (!isRecord(raw)) return defaultMcpAuth()
  const type = MCP_AUTH_TYPES.includes(raw.type as McpAuthType) ? (raw.type as McpAuthType) : 'none'
  const out: McpAuthConfig = { type }
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

/**
 * The `auth` Connect sends to main: `{{var}}` resolved in every field, and
 * nothing for a type that adds no credential (`none`; `oauth2`, whose token
 * main injects from the session) or for an empty config — so an untouched
 * tab sends exactly what it sent before this tab existed.
 */
export function resolveMcpAuth(
  auth: McpAuthConfig,
  vars: Record<string, string>,
): McpConnectAuth | undefined {
  const r = (v: string | undefined): string => resolveVariables(v ?? '', vars)
  switch (auth.type) {
    case 'basic': {
      const username = r(auth.basic?.username)
      const password = r(auth.basic?.password)
      if (!username && !password) return undefined
      return { type: 'basic', basic: { username, password } }
    }
    case 'bearer': {
      const token = r(auth.bearer?.token).trim()
      if (!token) return undefined
      const prefix = r(auth.bearer?.prefix).trim()
      return { type: 'bearer', bearer: prefix ? { token, prefix } : { token } }
    }
    case 'api-key': {
      const key = r(auth.apiKey?.key).trim()
      if (!key) return undefined
      return {
        type: 'api-key',
        apiKey: { key, value: r(auth.apiKey?.value), in: auth.apiKey?.in ?? 'header' },
      }
    }
    default:
      return undefined
  }
}

/** UTF-8 safe base64 — renderer code must not lean on the `Buffer` polyfill. */
function base64Utf8(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''))
}

/** Add `name` unless a header of that name is already set (case-insensitive). */
function setUnlessPresent(headers: Record<string, string>, name: string, value: string): boolean {
  const lower = name.toLowerCase()
  if (Object.keys(headers).some((k) => k.toLowerCase() === lower)) return false
  headers[name] = value
  return true
}

/**
 * The renderer twin of main's `applyMcpAuth` (src/main/protocols/mcp-auth.ts),
 * for the config EXPORT: the Authorization tab becomes a header — or, for an
 * API key `in: 'query'`, a URL parameter — of the exported server, so a pasted
 * config authenticates the way Connect does. Same precedence: a custom header
 * with the same name (case-insensitive) wins, and so does a query parameter
 * already in the URL. `auth` is `resolveMcpAuth`'s output (nothing for none /
 * oauth2 / empty). `applied` says whether a credential went into the output.
 * Keep in step with main's version.
 */
export function applyMcpAuth(
  url: string,
  headers: Record<string, string>,
  auth: McpConnectAuth | undefined,
): { url: string; headers: Record<string, string>; applied: boolean } {
  const out = { ...headers }
  let applied = false
  switch (auth?.type) {
    case 'basic': {
      // RFC 7617 §2: the first `:` separates user from password.
      const username = (auth.basic?.username ?? '').replace(/:/g, '')
      const password = auth.basic?.password ?? ''
      if (username || password) {
        const value = `Basic ${base64Utf8(`${username}:${password}`)}`
        applied = setUnlessPresent(out, 'Authorization', value)
      }
      break
    }
    case 'bearer': {
      const token = (auth.bearer?.token ?? '').trim()
      if (token) {
        const prefix = (auth.bearer?.prefix ?? '').trim() || 'Bearer'
        applied = setUnlessPresent(out, 'Authorization', `${prefix} ${token}`)
      }
      break
    }
    case 'api-key': {
      const key = (auth.apiKey?.key ?? '').trim()
      if (!key) break
      const value = auth.apiKey?.value ?? ''
      if (auth.apiKey?.in !== 'query') {
        applied = setUnlessPresent(out, key, value)
        break
      }
      try {
        const u = new URL(url.trim())
        if (u.searchParams.has(key)) break
        u.searchParams.set(key, value)
        return { url: u.toString(), headers: out, applied: true }
      } catch {
        // Not a URL yet (empty, or an unresolved {{var}}): the modal renders
        // live while the user types, so export the URL untouched.
      }
      break
    }
    default:
      break
  }
  return { url, headers: out, applied }
}

/** Tabs of the config strip for a transport: stdio has no HTTP headers, http / sse no env. */
export function availableConfigTabs(transport: McpTransport): McpConfigTab[] {
  return transport === 'stdio' ? ['auth', 'env'] : ['auth', 'headers']
}

/** The stored tab when the transport offers it, else Authorization (derived — never written back). */
export function effectiveConfigTab(tab: McpConfigTab, transport: McpTransport): McpConfigTab {
  return availableConfigTabs(transport).includes(tab) ? tab : 'auth'
}
