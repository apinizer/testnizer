import { ipcMain, BrowserWindow, shell } from 'electron'
import {
  mcpOAuthCancel,
  mcpOAuthForget,
  mcpOAuthStart,
  type McpOAuthDone,
  type McpOAuthStartOptions,
  type McpOAuthStep,
} from '../protocols/mcp-oauth.engine'
import { logEvent } from '../lib/console-logger'

/**
 * MCP OAuth 2.1 debugger IPC (issue #141).
 *
 *   mcp:oauth:start  (options)        → { oauthSessionId } — the flow runs async
 *   mcp:oauth:cancel (oauthSessionId) → { cancelled }
 *   mcp:oauth:forget (oauthSessionId) → { forgotten } — drops the tokens
 *
 * Events (main → every window, routed by `oauthSessionId` in the renderer):
 *   mcp:oauth:step  { oauthSessionId, step }
 *   mcp:oauth:done  { oauthSessionId, ok, summary?, noAuthRequired?, cancelled?, error?, failedStep? }
 *
 * Step records and the done payload are already redacted by the engine; the
 * tokens / client secret / PKCE verifier never cross this boundary.
 */

function broadcast(channel: string, payload: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  } catch {
    // best-effort: a window mid-teardown must not break the flow
  }
}

/** Opens the authorization URL in the system browser — http(s) only, like `app:openExternal`. */
async function openInBrowser(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to open a non-http(s) authorization URL (${parsed.protocol})`)
  }
  await shell.openExternal(url)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** Defensive copy of the renderer's options — only known, well-typed fields pass. */
function sanitizeOptions(raw: unknown): McpOAuthStartOptions {
  if (!raw || typeof raw !== 'object') throw new Error('Missing OAuth options')
  const o = raw as Record<string, unknown>
  const url = str(o.url)
  if (!url) throw new Error('The MCP server URL is required')
  const headers: Record<string, string> = {}
  if (o.headers && typeof o.headers === 'object') {
    for (const [k, v] of Object.entries(o.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v
    }
  }
  const port = typeof o.callbackPort === 'number' ? Math.trunc(o.callbackPort) : undefined
  return {
    url: url.trim(),
    transport: o.transport === 'sse' ? 'sse' : 'http',
    headers,
    ...(str(o.clientId) ? { clientId: str(o.clientId) } : {}),
    ...(str(o.clientSecret) ? { clientSecret: str(o.clientSecret) } : {}),
    ...(str(o.scope) ? { scope: str(o.scope) } : {}),
    ...(port !== undefined && port >= 0 && port <= 65535 ? { callbackPort: port } : {}),
    // Issue #170: strictly opt-in — anything but a literal `true` keeps https required.
    ...(o.allowHttpAuthServer === true ? { allowHttpAuthServer: true } : {}),
  }
}

function logDone(done: McpOAuthDone, url: string, started: number): void {
  const summary = done.summary
  logEvent({
    protocol: 'mcp',
    category: 'connection',
    level: done.ok ? 'success' : done.cancelled ? 'warning' : 'error',
    url,
    durationMs: Date.now() - started,
    message: done.ok
      ? done.noAuthRequired
        ? 'MCP OAuth: the server does not require authorization'
        : `MCP OAuth: access token obtained from ${summary?.issuer ?? 'the authorization server'}`
      : `MCP OAuth flow ${done.cancelled ? 'cancelled' : `failed${done.failedStep ? ` at ${done.failedStep}` : ''}`}: ${done.error ?? 'unknown error'}`,
    // Metadata only — never a token or secret.
    meta: {
      oauthSessionId: done.oauthSessionId,
      ...(summary
        ? {
            clientId: summary.clientId,
            tokenType: summary.tokenType,
            hasRefreshToken: summary.hasRefreshToken,
            clientAuth: summary.clientAuthMethod,
          }
        : {}),
    },
    ...(done.ok || done.cancelled ? {} : { error: { message: done.error ?? 'unknown error' } }),
  })
}

export function registerMcpOAuthHandlers(): void {
  ipcMain.handle('mcp:oauth:start', async (_event, raw: unknown) => {
    try {
      const options = sanitizeOptions(raw)
      const started = Date.now()
      const { oauthSessionId, finished } = mcpOAuthStart(options, {
        openUrl: openInBrowser,
        onStep: (id: string, step: McpOAuthStep) =>
          broadcast('mcp:oauth:step', { oauthSessionId: id, step }),
        onDone: (done: McpOAuthDone) => broadcast('mcp:oauth:done', done),
      })
      // `finished` never rejects; the catch only guards a broken logger.
      finished.then((done) => logDone(done, options.url, started)).catch(() => {})
      logEvent({
        protocol: 'mcp',
        category: 'connection',
        message: `MCP OAuth flow started (${options.clientId ? 'manual client' : 'dynamic client registration'})`,
        url: options.url,
        meta: { oauthSessionId },
      })
      return { success: true, data: { oauthSessionId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mcp:oauth:cancel', async (_event, oauthSessionId: unknown) => {
    try {
      if (typeof oauthSessionId !== 'string') throw new Error('oauthSessionId is required')
      return { success: true, data: { cancelled: mcpOAuthCancel(oauthSessionId) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mcp:oauth:forget', async (_event, oauthSessionId: unknown) => {
    try {
      if (typeof oauthSessionId !== 'string') throw new Error('oauthSessionId is required')
      const forgotten = mcpOAuthForget(oauthSessionId)
      if (forgotten) {
        logEvent({
          protocol: 'mcp',
          category: 'connection',
          message: 'MCP OAuth token forgotten',
          meta: { oauthSessionId },
        })
      }
      return { success: true, data: { forgotten } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
