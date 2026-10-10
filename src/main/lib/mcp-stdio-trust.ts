/**
 * Local trust for stdio MCP servers in unattended runs (VS Code workspace-trust
 * style). A stdio MCP request IS a command line: a project pulled from git can
 * carry one that runs anything on the next Run / Test Suite / Scheduler tick.
 *
 * Rule: a run may spawn a stdio server only if the user has connected that
 * exact server from its MCP tab on THIS computer (an explicit Connect click —
 * `mcp:connect`). The trust record lives in the LOCAL settings store
 * (electron-store `settings.json`, key `mcpStdioTrust`) — never in the
 * project database, the project file or a git export.
 *
 * The key is a sha256 over the project id, the RESOLVED command, its args and
 * the resolved stdio environment. The env is part of it on purpose: a pulled
 * project that keeps a trusted `node server.js` but adds
 * `NODE_OPTIONS=--require ./evil.js` must not inherit the trust. Only the hash
 * is stored, never the command line or env values.
 *
 * Recorded by the `mcp:connect` IPC handler only — NOT by the engine's
 * `mcpConnect`, which runs also use (a run must never trust itself).
 */
import { createHash } from 'node:crypto'
import { tokenizeCommandLine } from '../../shared/mcp-call'

export const STDIO_TRUST_STORE_KEY = 'mcpStdioTrust'

/** Run-row text of an untrusted stdio server. */
export const MCP_STDIO_UNTRUSTED_MESSAGE =
  'This stdio MCP server has not been trusted on this computer. Connect to it once from its MCP tab to allow it in runs.'

export interface StdioTrustSubject {
  projectId?: string
  /** The connect options as `mcp:connect` / `mcpCallOnce` get them. */
  command?: string
  args?: readonly string[]
  url?: string
  env?: Record<string, string>
}

/** `{ command, args }` exactly as the engine will spawn them (quote-aware split when no args). */
function commandLineOf(s: StdioTrustSubject): string[] {
  if (s.command && Array.isArray(s.args)) return [s.command, ...s.args]
  return tokenizeCommandLine(s.command || s.url || '')
}

export function stdioTrustKey(s: StdioTrustSubject): string {
  const env = Object.entries(s.env ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256')
    .update(JSON.stringify(['v1', s.projectId ?? '', commandLineOf(s), env]))
    .digest('hex')
}

interface TrustStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/** Trusted keys of this session — survives a store that failed to load. */
const memory = new Set<string>()
let override: TrustStore | null | undefined
let storePromise: Promise<TrustStore | null> | null = null

/** Test seam: an in-memory store (or `null` = no store); `undefined` restores electron-store. */
export function setStdioTrustStoreForTests(store: TrustStore | null | undefined): void {
  override = store
  storePromise = null
  memory.clear()
}

async function getStore(): Promise<TrustStore | null> {
  if (override !== undefined) return override
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const { default: Store } = await import('electron-store')
        // The settings file the settings handler writes (local app data only).
        return new Store({ name: 'settings' }) as unknown as TrustStore
      } catch {
        return null
      }
    })()
  }
  return storePromise
}

function recordOf(raw: unknown): Record<string, number> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, number>) }
    : {}
}

/** Remember this server as trusted (the user connected it from its tab). Never throws. */
export async function trustStdioServer(s: StdioTrustSubject): Promise<void> {
  const key = stdioTrustKey(s)
  memory.add(key)
  try {
    const store = await getStore()
    if (!store) return
    const all = recordOf(store.get(STDIO_TRUST_STORE_KEY))
    all[key] = Date.now()
    store.set(STDIO_TRUST_STORE_KEY, all)
  } catch {
    /* the in-memory record still trusts it for this session */
  }
}

/** Has the user connected this exact server (command, args, env, project) here? */
export async function isStdioServerTrusted(s: StdioTrustSubject): Promise<boolean> {
  const key = stdioTrustKey(s)
  if (memory.has(key)) return true
  try {
    const store = await getStore()
    if (!store) return false
    return key in recordOf(store.get(STDIO_TRUST_STORE_KEY))
  } catch {
    return false
  }
}
