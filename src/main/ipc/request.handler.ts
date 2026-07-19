import { ipcMain } from 'electron'
import {
  executeHttpRequest,
  HttpRequestOptions,
  stripUrlCredentials,
  fetchOAuth2Token,
  type OAuth2GrantConfig,
} from '../protocols/http.engine'
import * as historyRepo from '../db/history.repo'
import { listCertificatesForHost } from '../db/certificate.repo'
import { URL } from 'url'
import { readFileSync } from 'fs'
import { resolve, extname } from 'path'
import { realpathSync, statSync } from 'fs'
import { decryptSecret } from '../lib/secure-storage'
import { logRequestResponse } from '../lib/console-logger'
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

type CertReadResult = { buf: Buffer } | { error: string }

/** Human-readable, actionable reason for a filesystem error on a cert path. */
function describeCertFsError(err: NodeJS.ErrnoException, filePath: string): string {
  if (err?.code === 'ENOENT') return `file not found: ${filePath}`
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    return (
      `permission denied reading ${filePath}. On macOS an app cannot read ` +
      `~/Downloads, ~/Desktop or ~/Documents without access — re-select the ` +
      `certificate in Project Settings (Testnizer copies it into its own storage ` +
      `on pick), move it to another folder, or grant Testnizer access under ` +
      `System Settings › Privacy & Security › Files and Folders.`
    )
  }
  return `cannot read ${filePath}: ${err?.message ?? String(err)}`
}

/**
 * Read certificate/key material with safety rails (symlink resolution,
 * extension whitelist, size cap) but return a DESCRIPTIVE reason on failure
 * instead of a bare null. A configured client cert that silently failed to load
 * used to send the request with NO certificate at all, so the server answered
 * with a confusing "missing credential" error and the user never learned their
 * .pem was unreadable (e.g. it sat in a macOS-protected folder).
 */
function readCertFile(filePath: string): CertReadResult {
  let abs: string
  try {
    // Resolve symlinks first so an attacker can't bypass the extension
    // whitelist by symlinking `attack.pem -> /etc/passwd` (the *target* is what
    // matters for file content, not the link name).
    abs = realpathSync(resolve(filePath))
  } catch (e) {
    return { error: describeCertFsError(e as NodeJS.ErrnoException, filePath) }
  }
  const ext = extname(abs).toLowerCase()
  if (!ALLOWED_CERT_EXTS.has(ext)) {
    return {
      error: `unsupported file type "${ext || '(none)'}" — expected one of ${[...ALLOWED_CERT_EXTS].join(', ')} (${filePath})`,
    }
  }
  try {
    const st = statSync(abs)
    if (!st.isFile()) return { error: `not a regular file: ${filePath}` }
    if (st.size > MAX_CERT_BYTES) {
      return {
        error: `certificate file is larger than the ${MAX_CERT_BYTES}-byte limit: ${filePath}`,
      }
    }
    return { buf: readFileSync(abs) }
  } catch (e) {
    return { error: describeCertFsError(e as NodeJS.ErrnoException, filePath) }
  }
}

export interface CertLoadResult {
  certificates?: HttpRequestOptions['certificates']
  /**
   * Set when a matched, ENABLED client cert could not be loaded. The request
   * must then fail fast with this message rather than silently go out
   * unauthenticated (which the server rejects with a cryptic error).
   */
  error?: string
}

/**
 * Resolve the CA + client certificates configured for a request's host. Exported
 * so the mTLS pipeline is exercised by the REAL code in tests (previously the
 * tests reimplemented this inline, which is exactly why the host-match /
 * silent-read-failure bugs slipped through).
 */
export function loadCertificatesFor(projectId: string | undefined, url: string): CertLoadResult {
  if (!projectId) return {}
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return {}
  }
  const rows = listCertificatesForHost(projectId, host)
  if (rows.length === 0) return {}
  const caCerts: Buffer[] = []
  let clientCert: { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string } | undefined
  for (const r of rows) {
    const passphrase = decryptSecret(r.passphrase) ?? undefined
    if (r.kind === 'ca' && r.crt_path) {
      // CA certs are additive trust anchors — a read failure is non-fatal (the
      // connection may still verify against the system trust store).
      const res = readCertFile(r.crt_path)
      if ('buf' in res) caCerts.push(res.buf)
    } else if (r.kind === 'client') {
      if (r.pfx_path) {
        const res = readCertFile(r.pfx_path)
        if ('error' in res)
          return { error: `Client certificate for ${host} could not be loaded — ${res.error}` }
        clientCert = { pfx: res.buf, passphrase }
      } else if (r.crt_path && r.key_path) {
        const certRes = readCertFile(r.crt_path)
        if ('error' in certRes)
          return { error: `Client certificate for ${host} could not be loaded — ${certRes.error}` }
        const keyRes = readCertFile(r.key_path)
        if ('error' in keyRes)
          return {
            error: `Client certificate key for ${host} could not be loaded — ${keyRes.error}`,
          }
        clientCert = { cert: certRes.buf, key: keyRes.buf, passphrase }
      }
    }
  }
  return { certificates: { caCerts: caCerts.length ? caCerts : undefined, clientCert } }
}

// Map of in-flight request IDs → AbortController, so the renderer can call
// request:cancel(id) to abort a long-running request (e.g. a user-initiated
// "cancel" during a slow response).
const pendingRequests = new Map<string, AbortController>()

export function registerRequestHandlers(): void {
  // OAuth 2.0 "Get New Access Token" — used by the Auth tab button. Performs a
  // client_credentials / password grant and returns the token so the UI can
  // store it. The same grant runs automatically at request time, but this lets
  // users fetch + inspect a token up front.
  ipcMain.handle('oauth2:getToken', async (_event, config: OAuth2GrantConfig) => {
    try {
      const res = await fetchOAuth2Token(config)
      return {
        success: true,
        data: {
          accessToken: res.accessToken,
          tokenType: res.tokenType,
          expiresIn: res.expiresIn,
        },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

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
        // attempt to pull matching CA / client certs from the project config.
        // A configured-but-unreadable client cert throws here so the request
        // fails fast with a clear message instead of silently going out
        // without the certificate (the reported mTLS bug).
        if (options._projectId && !options.certificates) {
          const { certificates, error } = loadCertificatesFor(options._projectId, options.url)
          if (error) throw new Error(error)
          if (certificates) {
            options = { ...options, certificates }
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

        // Postman-style console: a single entry per request/response cycle
        // (logRequestResponse below). The previous "log request before send" call
        // produced an extra row that had only the URL — no headers / body
        // visible when expanded — and was the most common confusion in user
        // testing. Keeping just the response entry mirrors Postman's
        // Console which collapses request + response into one collapsible
        // log line.
        const protocolName: 'http' | 'soap' | 'graphql' =
          options._protocol === 'soap' || options._protocol === 'graphql'
            ? options._protocol
            : 'http'

        const result = await executeHttpRequest(options)

        // … and the response (or error). Use the actualRequest that was
        // built by the engine so we report exactly what hit the wire.
        logRequestResponse({
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
          // Strip `user:pass@host` credentials from the persisted URL.
          // The runtime/UI already sanitise actualRequest.url, but the
          // history table and the request_snapshot blob were keeping the
          // raw user-typed URL — which means a `https://admin:secret@…`
          // URL bar entry leaked to disk and was visible in History panel
          // exports forever. Credentials should ride on the Authorization
          // header (auth.basic), not in the URL.
          const sanitizedUrl = stripUrlCredentials(options.url)
          historyRepo.addHistory({
            workspace_id: options._workspaceId,
            project_id: options._projectId,
            endpoint_id: options._endpointId,
            protocol: options._protocol || 'http',
            method: options.method,
            url: sanitizedUrl,
            status_code: result.status,
            duration_ms: result.timing?.total ? Math.round(result.timing.total) : undefined,
            request_snapshot: JSON.stringify({
              method: options.method,
              url: sanitizedUrl,
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
              // Persist the binary flag so a base64 image / PDF body restored
              // from history previews as the original file instead of showing
              // its base64 as plain text (issue #25 follow-up).
              bodyEncoding: result.bodyEncoding,
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
          logRequestResponse({
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
