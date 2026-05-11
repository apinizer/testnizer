import { ipcMain } from 'electron'
import { executeHttpRequest, HttpRequestOptions } from '../protocols/http.engine'
import * as historyRepo from '../db/history.repo'
import { listCertificatesForHost } from '../db/certificate.repo'
import { URL } from 'url'
import { readFileSync } from 'fs'
import { resolve, extname } from 'path'
import { realpathSync, statSync } from 'fs'
import { decryptSecret } from '../lib/secure-storage'
import { logRequest, logResponse } from '../lib/console-logger'
import { getCipherPreset, normaliseTlsVersion } from '../lib/tls-presets'

/**
 * Renderer-side TLS payload. The renderer doesn't import the main-process
 * preset constants — it sends the preset name and we resolve to the cipher
 * string here. Custom presets are passed through verbatim.
 */
interface TlsPayload {
  minVersion?: string
  maxVersion?: string
  cipherPreset?: 'modern' | 'intermediate' | 'legacy' | 'custom'
  ciphersCustom?: string
}

function resolveTlsPayload(payload: TlsPayload | undefined): HttpRequestOptions['tls'] {
  if (!payload) return undefined
  const min = normaliseTlsVersion(payload.minVersion)
  const max = normaliseTlsVersion(payload.maxVersion)
  let ciphers: string | undefined
  if (payload.cipherPreset === 'custom') {
    const c = (payload.ciphersCustom ?? '').trim()
    if (c.length > 0) ciphers = c
  } else if (payload.cipherPreset && payload.cipherPreset !== 'modern') {
    // 'modern' is Node's default — only override for intermediate/legacy.
    ciphers = getCipherPreset(payload.cipherPreset)
  }
  if (!min && !max && !ciphers) return undefined
  return { minVersion: min, maxVersion: max, ciphers }
}

// Whitelist of extensions we are willing to read as certificate material.
// Anything else is rejected outright — even if a malicious DB row points
// at a system file, we simply refuse to touch it.
const ALLOWED_CERT_EXTS = new Set(['.crt', '.cer', '.pem', '.key', '.pfx', '.p12'])

// Cap cert file size so a corrupted DB row pointing at e.g. a multi-GB log
// file can't OOM the main process.
const MAX_CERT_BYTES = 1024 * 1024 // 1 MiB

function safeReadCertFile(filePath: string): Buffer | null {
  try {
    // Resolve symlinks first so an attacker can't bypass the extension
    // whitelist by symlinking `attack.pem -> /etc/passwd` (the *target*
    // is what matters for file content, not the link name).
    const abs = realpathSync(resolve(filePath))
    const ext = extname(abs).toLowerCase()
    if (!ALLOWED_CERT_EXTS.has(ext)) return null
    const st = statSync(abs)
    if (!st.isFile()) return null
    if (st.size > MAX_CERT_BYTES) return null
    return readFileSync(abs)
  } catch {
    return null
  }
}

function loadCertificatesFor(
  projectId: string | undefined,
  url: string,
): HttpRequestOptions['certificates'] {
  if (!projectId) return undefined
  try {
    const host = new URL(url).hostname
    const rows = listCertificatesForHost(projectId, host)
    if (rows.length === 0) return undefined
    const caCerts: Buffer[] = []
    let clientCert: { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string } | undefined
    for (const r of rows) {
      const passphrase = decryptSecret(r.passphrase) ?? undefined
      if (r.kind === 'ca' && r.crt_path) {
        const buf = safeReadCertFile(r.crt_path)
        if (buf) caCerts.push(buf)
      } else if (r.kind === 'client') {
        if (r.pfx_path) {
          const pfx = safeReadCertFile(r.pfx_path)
          if (pfx) clientCert = { pfx, passphrase }
        } else if (r.crt_path && r.key_path) {
          const cert = safeReadCertFile(r.crt_path)
          const key = safeReadCertFile(r.key_path)
          if (cert && key) clientCert = { cert, key, passphrase }
        }
      }
    }
    return { caCerts: caCerts.length ? caCerts : undefined, clientCert }
  } catch {
    return undefined
  }
}

// Map of in-flight request IDs → AbortController, so the renderer can call
// request:cancel(id) to abort a long-running request (e.g. a user-initiated
// "cancel" during a slow response).
const pendingRequests = new Map<string, AbortController>()

export function registerRequestHandlers(): void {
  ipcMain.handle(
    'request:send',
    async (
      _event,
      options: HttpRequestOptions & {
        _workspaceId?: string
        _projectId?: string
        _endpointId?: string
        _protocol?: string
        _requestId?: string
        _tabId?: string
        /** Renderer-side TLS payload — resolved into engine-shaped `tls` here. */
        tls?: TlsPayload | HttpRequestOptions['tls']
      },
    ) => {
      const requestId = options._requestId
      let controller: AbortController | undefined
      try {
        // If a project is known and no certificates were explicitly provided,
        // attempt to pull matching CA / client certs from the project configuration.
        if (options._projectId && !options.certificates) {
          const certs = loadCertificatesFor(options._projectId, options.url)
          if (certs) {
            options = { ...options, certificates: certs }
          }
        }
        // Renderer sends `cipherPreset` / `ciphersCustom`; resolve to the actual
        // OpenSSL cipher string here so the engine never has to know about
        // presets.
        if (options.tls && 'cipherPreset' in (options.tls as TlsPayload)) {
          const resolved = resolveTlsPayload(options.tls as TlsPayload)
          options = { ...options, tls: resolved }
        }
        if (requestId) {
          controller = new AbortController()
          pendingRequests.set(requestId, controller)
          options = { ...options, signal: controller.signal }
        }

        // Postman-style console: log the request before sending. We log a
        // light-weight stub here; the full headers/body come from
        // `result.actualRequest` (already populated by the engine) in the
        // response log call below.
        const protocolName: 'http' | 'soap' | 'graphql' =
          options._protocol === 'soap' || options._protocol === 'graphql'
            ? options._protocol
            : 'http'
        logRequest({
          protocol: protocolName,
          method: options.method,
          url: options.url,
          tabId: options._tabId,
        })

        const result = await executeHttpRequest(options)

        // … and the response (or error). Use the actualRequest that was
        // built by the engine so we report exactly what hit the wire.
        logResponse({
          protocol: protocolName,
          method: result.actualRequest?.method ?? options.method,
          url: result.actualRequest?.url ?? options.url,
          status: result.status,
          statusText: result.statusText,
          durationMs: result.timing?.total,
          sizeBytes: result.bodySize,
          requestHeaders: result.actualRequest?.headers,
          requestBody: result.actualRequest?.body,
          responseHeaders: result.headers,
          responseBody: result.body,
          error: result.error ? { message: result.error } : undefined,
          tabId: options._tabId,
        })

        // Auto-save to history
        try {
          historyRepo.addHistory({
            workspace_id: options._workspaceId,
            project_id: options._projectId,
            endpoint_id: options._endpointId,
            protocol: options._protocol || 'http',
            method: options.method,
            url: options.url,
            status_code: result.status,
            duration_ms: result.timing?.total ? Math.round(result.timing.total) : undefined,
            request_snapshot: JSON.stringify({
              method: options.method,
              url: options.url,
              params: options.params,
              headers: options.headers,
              body: options.body,
              auth: options.auth,
            }),
            response_snapshot: JSON.stringify({
              status: result.status,
              statusText: result.statusText,
              headers: result.headers,
              body: result.body && result.body.length <= 500_000 ? result.body : undefined,
              bodySize: result.bodySize,
              timing: result.timing,
              error: result.error,
            }),
          })
        } catch {
          // History save failure should not affect request result
        }

        return { success: true, data: result }
      } catch (e) {
        // Even when the engine throws (e.g. invalid URL/cert), surface a
        // response-style error log so the user sees the failure in the
        // Postman-style console.
        const protocolName: 'http' | 'soap' | 'graphql' =
          options._protocol === 'soap' || options._protocol === 'graphql'
            ? options._protocol
            : 'http'
        try {
          logResponse({
            protocol: protocolName,
            method: options.method,
            url: options.url,
            error: { message: (e as Error).message },
            tabId: options._tabId,
          })
        } catch {
          /* logger must never break the request */
        }
        return { success: false, error: (e as Error).message }
      } finally {
        if (requestId) pendingRequests.delete(requestId)
      }
    },
  )

  ipcMain.handle('request:cancel', async (_event, requestId: string) => {
    try {
      const controller = pendingRequests.get(requestId)
      if (!controller) return { success: true, data: false }
      controller.abort()
      pendingRequests.delete(requestId)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
