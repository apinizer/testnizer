/**
 * AI Chat Tools tab configuration (issue #180) — pure helpers, no store / IPC.
 *
 * A server is either a reference to one of the project's saved MCP requests
 * (its connection, headers, auth and timeout are read from that row at Send
 * time) or an ad-hoc server typed here (URL or stdio command line + headers /
 * env). Saved with the request through the 'ai' snapshot: header / env rows
 * follow the AI header rule — a credential-named row with a LITERAL value is
 * session-only (dropped on save and from the tab snapshot); `{{var}}` is kept.
 * The same goes for a literal credential in the URL (`user:pass@`,
 * `?api_key=…`), in the stdio command line (`--token …`) and an env value
 * that is a URL with `user:pass@` (issue #180).
 * "Run tools without asking" is never saved with the request (a project
 * pulled from git must not arrive with it on) — it is per tab, on this machine.
 */
import { makeId } from './utils'
import {
  stripCredentialHeaders,
  hasSessionOnlyCredentialHeader,
  isTemplateOnlyValue,
} from './ai-chat-config'
import { isCredentialArgName, isCredentialHeaderName } from '../../shared/credential-headers'
import { joinCommandLine, tokenizeCommandLine } from '../../shared/mcp-call'
import { hasUrlCredentials } from '../../shared/ai-stdio-env'
import type { KeyValuePair } from '../types'
import type { AiStdioEnvEntry } from '../../shared/ai-chat-types'

export type AiToolServerSource = 'saved' | 'adhoc'
export type AiToolTransport = 'http' | 'sse' | 'stdio'

export interface AiToolInfo {
  name: string
  description?: string
}

export interface AiToolServerConfig {
  id: string
  source: AiToolServerSource
  /** Display name (saved: the request's name when picked; ad-hoc: typed). */
  name: string
  enabled: boolean
  /** saved: the MCP request row. */
  requestId?: string
  requestKind?: 'endpoint' | 'request'
  /**
   * saved: the referenced MCP request is not in this project (a Duplicate /
   * Import as new found no copy of it) — `requestId` is gone.
   */
  missing?: boolean
  /** ad-hoc: transport + URL (or the stdio command line). */
  transport?: AiToolTransport
  url?: string
  headers?: KeyValuePair[]
  envVars?: KeyValuePair[]
  /** MCP tool names switched off (new tools are on by default). */
  disabledTools: string[]
}

/** The last "Load tools" result per server — UI state, not saved with the request. */
export interface AiToolCatalogEntry {
  tools?: AiToolInfo[]
  error?: string
  /** Untrusted stdio server: the card + main's one-time token for exactly this subject. */
  untrusted?: {
    commandLine: string
    envNames: string[]
    env?: AiStdioEnvEntry[]
    trustToken?: string
  }
  loading?: boolean
}

export function newAdhocServer(): AiToolServerConfig {
  return {
    id: makeId(),
    source: 'adhoc',
    name: '',
    enabled: true,
    transport: 'http',
    url: '',
    headers: [{ id: makeId(), key: '', value: '', enabled: true }],
    envVars: [],
    disabledTools: [],
  }
}

export function newSavedServer(ref: {
  requestId: string
  requestKind: 'endpoint' | 'request'
  name: string
}): AiToolServerConfig {
  return {
    id: makeId(),
    source: 'saved',
    name: ref.name,
    enabled: true,
    requestId: ref.requestId,
    requestKind: ref.requestKind,
    disabledTools: [],
  }
}

/** Display label of a server (never empty). */
export function serverLabel(s: AiToolServerConfig): string {
  if (s.name.trim()) return s.name.trim()
  if (s.source === 'adhoc' && s.url?.trim()) return s.url.trim()
  return 'MCP server'
}

// ─── Literal credentials in an ad-hoc URL / command line / env (issue #180) ──
// Same rule as credential headers: a LITERAL secret works for this session but
// is not saved with the request nor written to the tab snapshot; a value that
// is only `{{variable}}` references is kept.

/** A non-empty value that is not only `{{var}}` references. */
const isLiteral = (v: string): boolean => v.trim() !== '' && !isTemplateOnlyValue(v)

const decodeName = (raw: string): string => {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)([^/\s@?#]*)@/i

/**
 * A server URL without literal credentials: `user:pass@` and credential-named
 * query params (`?api_key=…`, `&token=…` — the argument rule) are removed.
 * Works on templated URLs (`{{base}}/mcp?token=…`) that `new URL` rejects.
 */
export function stripUrlCredentials(raw: string): string {
  let url = raw
  const ui = USERINFO.exec(url)
  if (ui && ui[2].split(':').some(isLiteral)) url = ui[1] + url.slice(ui[0].length)
  const q = url.indexOf('?')
  if (q < 0) return url
  const hashAt = url.indexOf('#', q)
  const query = url.slice(q + 1, hashAt < 0 ? undefined : hashAt)
  const hash = hashAt < 0 ? '' : url.slice(hashAt)
  const kept = query.split('&').filter((pair) => {
    const i = pair.indexOf('=')
    if (i <= 0) return true
    return !(isCredentialArgName(decodeName(pair.slice(0, i))) && isLiteral(pair.slice(i + 1)))
  })
  if (kept.length === query.split('&').length) return url
  const rest = kept.filter(Boolean).join('&')
  return `${url.slice(0, q)}${rest ? `?${rest}` : ''}${hash}`
}

const FLAG = /^--?[A-Za-z]/
const isCredentialFlag = (flag: string): boolean => {
  const name = flag.replace(/^-+/, '')
  return FLAG.test(flag) && !/^no-/i.test(name) && isCredentialArgName(name)
}

/**
 * A stdio command line without literal credentials: `--api-key=…`,
 * `--token …`, `--password …` (flag + value) are removed, and URL arguments
 * lose their credentials (`stripUrlCredentials`). Unchanged text is returned
 * as typed (no re-quoting).
 */
export function stripCommandLineCredentials(raw: string): string {
  const tokens = tokenizeCommandLine(raw)
  const out: string[] = []
  let changed = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const inline = /^(--?[^=\s]+)=(.*)$/.exec(t)
    if (i > 0 && inline && isCredentialFlag(inline[1]) && isLiteral(inline[2])) {
      changed = true
      continue
    }
    const next = tokens[i + 1]
    if (i > 0 && !inline && isCredentialFlag(t) && next !== undefined && !next.startsWith('-')) {
      if (isLiteral(next)) {
        changed = true
        i++
        continue
      }
    }
    const safe = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? stripUrlCredentials(t) : t
    if (safe !== t) changed = true
    out.push(safe)
  }
  if (!changed) return raw
  const [command = '', ...args] = out
  return joinCommandLine(command, args)
}

/** The URL / command line as saved: literal credentials removed. */
export function savedServerTarget(transport: AiToolTransport | undefined, url: string): string {
  return transport === 'stdio' ? stripCommandLineCredentials(url) : stripUrlCredentials(url)
}

/** An env row that is session-only: a credential name, or a URL value with `user:pass@`. */
function isSessionOnlyEnvRow(row: KeyValuePair): boolean {
  if (isCredentialHeaderName(row.key ?? '') && !isTemplateOnlyValue(row.value ?? '')) return true
  const ui = USERINFO.exec((row.value ?? '').trim())
  return !!ui && hasUrlCredentials(row.value ?? '') && ui[2].split(':').some(isLiteral)
}

/** Env rows as saved: credential-named literal values and URL credentials dropped. */
export function stripSessionOnlyEnv(rows: KeyValuePair[] | undefined): KeyValuePair[] {
  return (rows ?? []).filter((r) => !isSessionOnlyEnvRow(r))
}

/** Any literal credential in an ad-hoc server (session-only note). */
export function hasSessionOnlyServerCredential(servers: readonly AiToolServerConfig[]): boolean {
  return servers.some(
    (s) =>
      s.source === 'adhoc' &&
      (hasSessionOnlyCredentialHeader(s.headers) ||
        (s.envVars ?? []).some((r) => isSessionOnlyEnvRow(r) && (r.value ?? '').trim() !== '') ||
        savedServerTarget(s.transport, s.url ?? '') !== (s.url ?? '')),
  )
}

/** The servers as saved with the request / written to the tab snapshot: no literal secrets. */
export function savedToolServersOf(servers: readonly AiToolServerConfig[]): AiToolServerConfig[] {
  return servers.map((s) => {
    const out: AiToolServerConfig = {
      id: s.id,
      source: s.source,
      name: s.name,
      enabled: s.enabled,
      disabledTools: [...s.disabledTools],
    }
    if (s.source === 'saved') {
      if (s.requestId) out.requestId = s.requestId
      if (s.requestKind) out.requestKind = s.requestKind
      if (s.missing) out.missing = true
      return out
    }
    out.transport = s.transport ?? 'http'
    out.url = savedServerTarget(out.transport, s.url ?? '')
    out.headers = stripCredentialHeaders(s.headers)
    out.envVars = stripSessionOnlyEnv(s.envVars)
    return out
  })
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function kvRows(raw: unknown): KeyValuePair[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRec).map((r) => ({
    id: typeof r.id === 'string' && r.id ? r.id : makeId(),
    key: typeof r.key === 'string' ? r.key : '',
    value: typeof r.value === 'string' ? r.value : '',
    enabled: r.enabled !== false,
  }))
}

/** Tolerant read of saved `toolServers` (older rows have none; unknown shapes dropped). */
export function readToolServers(raw: unknown): AiToolServerConfig[] {
  if (!Array.isArray(raw)) return []
  const out: AiToolServerConfig[] = []
  for (const r of raw) {
    if (!isRec(r)) continue
    const source: AiToolServerSource = r.source === 'saved' ? 'saved' : 'adhoc'
    const base: AiToolServerConfig = {
      id: typeof r.id === 'string' && r.id ? r.id : makeId(),
      source,
      name: typeof r.name === 'string' ? r.name : '',
      enabled: r.enabled !== false,
      disabledTools: Array.isArray(r.disabledTools)
        ? r.disabledTools.filter((t): t is string => typeof t === 'string')
        : [],
    }
    if (source === 'saved') {
      base.requestKind = r.requestKind === 'endpoint' ? 'endpoint' : 'request'
      if (typeof r.requestId === 'string' && r.requestId) base.requestId = r.requestId
      else if (r.missing === true) base.missing = true
      else continue
    } else {
      base.transport = r.transport === 'sse' || r.transport === 'stdio' ? r.transport : 'http'
      base.url = savedServerTarget(base.transport, typeof r.url === 'string' ? r.url : '')
      base.headers = stripCredentialHeaders(kvRows(r.headers))
      base.envVars = stripSessionOnlyEnv(kvRows(r.envVars))
    }
    out.push(base)
  }
  return out
}
