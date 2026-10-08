import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  runMcpSecurityScan,
  type McpSecurityFinding,
  type McpSecurityProgress,
  type McpSecurityReport,
  type McpSecurityScanInput,
} from '../protocols/mcp-security.engine'
import { redactReport } from '../protocols/mcp-security/redact'
import { buildMcpSecurityHtmlReport } from '../protocols/mcp-security/report-html'
import { redactUrl } from '../protocols/mcp-security/wire'
import { logEvent } from '../lib/console-logger'
import { parseMcpAuth } from '../protocols/mcp-auth'

/**
 * MCP Security Scan IPC (issue #142).
 *
 *   mcp:security:scan       (request) → { scanId } — the scan runs async
 *   mcp:security:cancel     (scanId)  → { cancelled }
 *   mcp:security:exportHtml (report)  → { html } — self-contained report
 *
 * Events (main → every window, routed by `scanId` in the renderer):
 *   mcp:security:progress { scanId, done, total, current }
 *   mcp:security:finding  { scanId, finding }
 *   mcp:security:done     { scanId, report? , error? }
 *
 * Findings and the report are redacted by the engine (credential headers by
 * name, credential values scrubbed); `done` re-redacts as defence in depth.
 * The console log carries the target, flags and grade — never a header value.
 */

const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 60_000

const scans = new Map<string, AbortController>()

function broadcast(channel: string, payload: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  } catch {
    // best-effort: a window mid-teardown must not break the scan
  }
}

type ScanRequest = Pick<
  McpSecurityScanInput,
  'url' | 'transport' | 'headers' | 'auth' | 'oauthSessionId' | 'options'
>

/** Defensive copy of the renderer's request — only known, well-typed fields pass. */
function sanitizeRequest(raw: unknown): ScanRequest {
  if (!raw || typeof raw !== 'object') throw new Error('Missing scan request')
  const o = raw as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  if (!url) throw new Error('The MCP server URL is required')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid MCP server URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The security scan applies to http(s) MCP servers only')
  }
  const headers: Record<string, string> = {}
  if (o.headers && typeof o.headers === 'object') {
    for (const [k, v] of Object.entries(o.headers as Record<string, unknown>)) {
      if (typeof v === 'string' && k.trim()) headers[k] = v
    }
  }
  const opts =
    o.options && typeof o.options === 'object' ? (o.options as Record<string, unknown>) : {}
  const timeout =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? opts.timeoutMs
      : undefined
  // Authorization tab (MCP Auth) — same validator as `mcp:connect`.
  const auth = parseMcpAuth(o.auth)
  return {
    url,
    transport: o.transport === 'sse' ? 'sse' : 'http',
    headers,
    ...(auth ? { auth } : {}),
    ...(typeof o.oauthSessionId === 'string' && o.oauthSessionId
      ? { oauthSessionId: o.oauthSessionId }
      : {}),
    options: {
      rateLimitProbe: opts.rateLimitProbe === true,
      toolInvocationProbe: opts.toolInvocationProbe === true,
      ...(timeout !== undefined
        ? { timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(timeout))) }
        : {}),
    },
  }
}

function logFinished(scanId: string, req: ScanRequest, report: McpSecurityReport): void {
  logEvent({
    protocol: 'mcp',
    category: 'event',
    level: report.error
      ? 'error'
      : report.cancelled
        ? 'warning'
        : report.grade === 'A' || report.grade === 'B'
          ? 'success'
          : 'warning',
    url: redactUrl(req.url),
    durationMs: report.finishedAt - report.startedAt,
    message: report.error
      ? `MCP security scan: ${report.error}`
      : `MCP security scan ${report.cancelled ? 'cancelled' : 'finished'}: grade ${report.grade} (${report.score}/100) — ${report.summary.fail} failed, ${report.summary.warn} warnings`,
    // Metadata only — never a header value or token.
    meta: { scanId, grade: report.grade, score: report.score, ...report.summary },
    ...(report.error ? { error: { message: report.error } } : {}),
  })
}

/** Abort every running scan (app shutdown). */
export function mcpSecurityCancelAll(): void {
  for (const controller of scans.values()) controller.abort()
}

export function registerMcpSecurityHandlers(): void {
  ipcMain.handle('mcp:security:scan', async (_event, raw: unknown) => {
    try {
      const req = sanitizeRequest(raw)
      const scanId = `mcp-scan-${randomUUID()}`
      const controller = new AbortController()
      scans.set(scanId, controller)
      logEvent({
        protocol: 'mcp',
        category: 'event',
        url: redactUrl(req.url),
        message: `MCP security scan started (${req.transport}${req.options.rateLimitProbe ? ', rate-limit probe on' : ''}${req.options.toolInvocationProbe ? ', tool-invocation probe on' : ''})`,
        meta: {
          scanId,
          transport: req.transport,
          rateLimitProbe: req.options.rateLimitProbe,
          toolInvocationProbe: req.options.toolInvocationProbe === true,
          headerCount: Object.keys(req.headers ?? {}).length,
          oauth: !!req.oauthSessionId,
          // The type only — never a username, password, token or key.
          authType: req.auth?.type ?? 'none',
        },
      })
      // One macrotask later, so the IPC reply naming the scan reaches the
      // renderer before the first progress / finding event does.
      setImmediate(() => {
        runMcpSecurityScan({
          ...req,
          scanId,
          signal: controller.signal,
          onProgress: (p: McpSecurityProgress) =>
            broadcast('mcp:security:progress', { scanId, ...p }),
          onFinding: (finding: McpSecurityFinding) =>
            broadcast('mcp:security:finding', { scanId, finding }),
        })
          .then((report) => {
            broadcast('mcp:security:done', { scanId, report: redactReport(report) })
            try {
              logFinished(scanId, req, report)
            } catch {
              /* a broken logger must not hide the result */
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            broadcast('mcp:security:done', { scanId, error: message })
            logEvent({
              protocol: 'mcp',
              category: 'event',
              level: 'error',
              url: redactUrl(req.url),
              message: `MCP security scan failed: ${message}`,
              meta: { scanId },
              error: { message },
            })
          })
          .finally(() => scans.delete(scanId))
      })
      return { success: true, data: { scanId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mcp:security:cancel', async (_event, scanId: unknown) => {
    try {
      if (typeof scanId !== 'string') throw new Error('scanId is required')
      const controller = scans.get(scanId)
      controller?.abort()
      return { success: true, data: { cancelled: !!controller } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mcp:security:exportHtml', async (_event, report: unknown) => {
    try {
      return { success: true, data: { html: buildMcpSecurityHtmlReport(report) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
