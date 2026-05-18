// src/main/protocols/curl-shim.ts
//
// Legacy-TLS sidecar. Electron 33 ships with BoringSSL, which dropped TLS
// 1.0 / 1.1 at build time — passing `minVersion: 'TLSv1'` to `https.Agent`
// fails fast with ERR_SSL_INVALID_COMMAND. Several Apinizer customers
// (banks, government API gateways) still operate backends that only speak
// these protocols, and Testnizer ships as a client tool, so we cannot
// dictate the server side.
//
// The fix: detect a TLS 1.0/1.1 request at the HTTP engine entry point and
// route it through the operating system's `curl` binary, which links
// against whichever TLS stack the OS provides (Schannel on Windows, Secure
// Transport / OpenSSL on macOS, OpenSSL/GnuTLS on Linux) — all three keep
// TLS 1.0/1.1 negotiable. curl is bundled with Windows 10 1803+, macOS, and
// every modern Linux distro, so the dependency footprint is zero.
//
// This module is intentionally self-contained so the main code path stays
// on axios for the 99% case.

import { spawn } from 'node:child_process'
import { writeFile, mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { HttpRequestOptions } from './http.engine'
import { getJarCookieHeader, storeResponseCookies } from './http.engine'

// Local type mirrors — the renderer types live outside the main-process
// tsconfig's include list, so we duplicate the small subset we need
// (matches http.engine.ts's own local mirror pattern).
interface CurlResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

interface CurlResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

interface CurlConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: number
}

/**
 * Mirror of the local `ApiResponse` shape used inside http.engine.ts.
 * Defined here with `protocol: 'http'` (literal) so the engine's stricter
 * return type accepts our value without a cast at the route site.
 */
export interface CurlApiResponse {
  requestId: string
  protocol: 'http'
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing: CurlResponseTiming
  error?: string
  cookies?: CurlResponseCookie[]
  actualRequest?: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
  consoleLogs?: CurlConsoleLog[]
}

/**
 * Memoised availability probe. Spawning curl --version once is cheap (~5ms)
 * but cacheing avoids the syscall on every legacy-TLS request thereafter.
 */
let curlAvailable: boolean | null = null
let curlVersion: string | null = null

export async function isCurlAvailable(): Promise<boolean> {
  if (curlAvailable !== null) return curlAvailable
  curlAvailable = await new Promise<boolean>((resolve) => {
    try {
      const proc = spawn('curl', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      proc.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      proc.on('error', () => resolve(false))
      proc.on('exit', (code) => {
        if (code === 0) {
          // First line: `curl 7.x.y (...)` — keep for diagnostics.
          curlVersion = out.split('\n')[0]?.trim() ?? null
          resolve(true)
        } else {
          resolve(false)
        }
      })
    } catch {
      resolve(false)
    }
  })
  return curlAvailable
}

export function getCurlVersion(): string | null {
  return curlVersion
}

/**
 * Returns true when this request can only complete through the curl sidecar
 * (its TLS bounds touch the BoringSSL-disabled versions). Used at engine
 * entry to decide routing.
 */
export function shouldUseCurlSidecar(tls?: { minVersion?: string; maxVersion?: string }): boolean {
  if (!tls) return false
  const legacy = (v: string | undefined): boolean => v === 'TLSv1' || v === 'TLSv1.1'
  return legacy(tls.minVersion) || legacy(tls.maxVersion)
}

interface CurlStats {
  http_code: number
  size_download: number
  time_total: number
  time_namelookup: number
  time_connect: number
  time_appconnect: number
  time_starttransfer: number
}

/**
 * Build the argv passed to `curl`. Pure function — no I/O, no temp files —
 * so it's covered by unit tests. The caller is responsible for translating
 * file-backed options (CA bundle, client cert, request body) into temp
 * files first, then handing the paths to this function.
 */
export function buildCurlArgs(input: {
  url: string
  method: string
  headers: Record<string, string>
  cookieHeader?: string
  bodyMode: 'none' | 'stdin' | 'formdata' | 'urlencoded'
  formdataFields?: Array<
    { type: 'text'; name: string; value: string } | { type: 'file'; name: string; filePath: string }
  >
  urlencodedFields?: Array<{ name: string; value: string }>
  tls: { minVersion?: string; maxVersion?: string; ciphers?: string }
  sslVerification: boolean
  followRedirects: boolean
  timeoutMs: number
  proxy?: { host: string; port: number; auth?: { username: string; password: string } } | null
  proxyDisabled: boolean
  caCertPath?: string
  clientCertPath?: string
  clientCertType?: 'PEM' | 'P12'
  clientKeyPath?: string
  clientCertPassphrase?: string
  basicAuth?: { username: string; password: string }
  digestAuth?: { username: string; password: string }
  ntlmAuth?: { username: string; password: string; domain?: string }
  headersDumpPath: string
  bodyOutputPath: string
}): string[] {
  const args: string[] = [
    '-sS', // silent; show errors on stderr
    '-X',
    input.method.toUpperCase(),
    '-D',
    input.headersDumpPath, // dump response headers
    '-o',
    input.bodyOutputPath, // dump response body
    '--no-buffer',
    '--no-progress-meter',
    '--max-time',
    String(Math.max(1, Math.round(input.timeoutMs / 1000))),
  ]

  // `-w` stat format. Stable JSON keys so we can JSON.parse stdout — no
  // locale weirdness from comma-as-decimal Windows builds of curl.
  args.push(
    '-w',
    '{"http_code":%{http_code},"size_download":%{size_download},"time_total":%{time_total},"time_namelookup":%{time_namelookup},"time_connect":%{time_connect},"time_appconnect":%{time_appconnect},"time_starttransfer":%{time_starttransfer}}',
  )

  // TLS protocol pins. `--tlsv1.0` forces the FLOOR; `--tls-max 1.0` caps.
  // We translate min/max independently so callers can request e.g. a server
  // restricted to TLS 1.0 only by setting both to TLSv1.
  const tlsFlag = (v: string | undefined): string | undefined => {
    if (v === 'TLSv1') return '1.0'
    if (v === 'TLSv1.1') return '1.1'
    if (v === 'TLSv1.2') return '1.2'
    if (v === 'TLSv1.3') return '1.3'
    return undefined
  }
  const tlsMin = tlsFlag(input.tls.minVersion)
  const tlsMax = tlsFlag(input.tls.maxVersion)
  if (tlsMin) args.push(`--tlsv${tlsMin}`)
  if (tlsMax) args.push('--tls-max', tlsMax)
  if (input.tls.ciphers && input.tls.ciphers.trim()) {
    // curl accepts OpenSSL cipher strings via `--ciphers`. For TLS 1.3 you'd
    // use `--tls13-ciphers`; we pass through to `--ciphers` which is what
    // the existing UI populates.
    args.push('--ciphers', input.tls.ciphers.trim())
  }

  if (!input.sslVerification) args.push('-k')

  if (input.followRedirects) {
    args.push('-L', '--max-redirs', '5')
  }

  // Proxy. `--noproxy '*'` tells curl to bypass system env vars (mirrors
  // axios `proxy: false`). Custom proxy URL is constructed cleanly so an
  // auth string with `@` in the username doesn't break the parse.
  if (input.proxyDisabled) {
    args.push('--noproxy', '*')
  } else if (input.proxy) {
    args.push('-x', `${input.proxy.host}:${input.proxy.port}`)
    if (input.proxy.auth) {
      args.push('--proxy-user', `${input.proxy.auth.username}:${input.proxy.auth.password}`)
    }
  }

  if (input.caCertPath) args.push('--cacert', input.caCertPath)

  if (input.clientCertPath) {
    if (input.clientCertType === 'P12') {
      args.push('--cert-type', 'P12')
      const cert = input.clientCertPassphrase
        ? `${input.clientCertPath}:${input.clientCertPassphrase}`
        : input.clientCertPath
      args.push('--cert', cert)
    } else {
      const cert = input.clientCertPassphrase
        ? `${input.clientCertPath}:${input.clientCertPassphrase}`
        : input.clientCertPath
      args.push('--cert', cert)
      if (input.clientKeyPath) args.push('--key', input.clientKeyPath)
    }
  }

  if (input.basicAuth) {
    args.push('-u', `${input.basicAuth.username}:${input.basicAuth.password}`, '--basic')
  } else if (input.digestAuth) {
    args.push('-u', `${input.digestAuth.username}:${input.digestAuth.password}`, '--digest')
  } else if (input.ntlmAuth) {
    const user = input.ntlmAuth.domain
      ? `${input.ntlmAuth.domain}\\${input.ntlmAuth.username}`
      : input.ntlmAuth.username
    args.push('-u', `${user}:${input.ntlmAuth.password}`, '--ntlm')
  }

  // Headers. Curl drops Content-Length if we set body via stdin; let it
  // recompute by NOT forwarding a user-supplied Content-Length when we
  // pipe a body. Cookies are forwarded via -b which curl merges with -L
  // redirects correctly.
  for (const [k, v] of Object.entries(input.headers)) {
    if (k.toLowerCase() === 'content-length' && input.bodyMode !== 'none') continue
    args.push('-H', `${k}: ${v}`)
  }
  if (input.cookieHeader) args.push('-b', input.cookieHeader)

  // Body
  switch (input.bodyMode) {
    case 'stdin':
      // The body is piped to curl's stdin; @- tells it to read from there.
      // Use --data-binary so newlines aren't stripped (which `-d` does).
      args.push('--data-binary', '@-')
      break
    case 'urlencoded':
      if (input.urlencodedFields) {
        for (const f of input.urlencodedFields) {
          args.push('--data-urlencode', `${f.name}=${f.value}`)
        }
      }
      break
    case 'formdata':
      if (input.formdataFields) {
        for (const f of input.formdataFields) {
          if (f.type === 'text') {
            args.push('-F', `${f.name}=${f.value}`)
          } else {
            // Wrap with @ to upload as file. Quoting the path with semicolons
            // is unnecessary because we hand args verbatim to spawn (no shell).
            args.push('-F', `${f.name}=@${f.filePath}`)
          }
        }
      }
      break
    case 'none':
    default:
      break
  }

  // URL must come AFTER all option args.
  args.push(input.url)
  return args
}

/**
 * Parse the headers file curl dumps via `-D`. Curl writes a status line for
 * every leg of the redirect chain, blank lines between them; the FINAL leg
 * is what we want to surface as the response. Returns the parsed headers
 * plus the status line of the final leg.
 */
export function parseCurlHeaders(rawDump: string): {
  statusLine: string
  status: number
  statusText: string
  headers: Record<string, string>
  setCookieHeaders: string[]
} {
  // Split into legs by blank line. The first non-empty line of each leg is
  // its `HTTP/x y Reason` status line.
  const normalised = rawDump.replace(/\r\n/g, '\n')
  const legs = normalised.split(/\n\n+/).filter((leg) => leg.trim().length > 0)
  const finalLeg = legs[legs.length - 1] ?? ''
  const lines = finalLeg.split('\n').filter((l) => l.length > 0)

  let statusLine = ''
  const headers: Record<string, string> = {}
  const setCookieHeaders: string[] = []
  for (const line of lines) {
    if (line.startsWith('HTTP/')) {
      statusLine = line
      continue
    }
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key.toLowerCase() === 'set-cookie') {
      setCookieHeaders.push(value)
    }
    // Keep the LAST occurrence for simple keys (consistent with axios shape).
    // Multi-value semantics for Set-Cookie are preserved separately above.
    headers[key] = value
  }

  let status = 0
  let statusText = ''
  if (statusLine) {
    const m = /^HTTP\/[\d.]+\s+(\d+)(?:\s+(.+))?$/.exec(statusLine)
    if (m) {
      status = parseInt(m[1], 10)
      statusText = m[2] ?? ''
    }
  }
  return { statusLine, status, statusText, headers, setCookieHeaders }
}

interface CurlExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

function spawnCurl(
  args: string[],
  stdinBody: Buffer | null,
  signal?: AbortSignal,
): Promise<CurlExecResult> {
  return new Promise((resolve) => {
    const proc = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    if (signal) {
      const abort = (): void => {
        try {
          proc.kill('SIGTERM')
        } catch {
          /* ignore */
        }
      }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }

    proc.on('error', (err) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: (err as Error).message,
        exitCode: -1,
      })
    })
    proc.on('exit', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
      })
    })

    if (stdinBody) {
      proc.stdin.end(stdinBody)
    } else {
      proc.stdin.end()
    }
  })
}

/**
 * Map a curl exit code to a human-readable error. Curl's exit codes are
 * documented at https://curl.se/libcurl/c/libcurl-errors.html; we surface
 * the most common ones with clearer text so users see "Connection refused"
 * rather than "exit 7".
 */
function describeCurlExit(code: number | null, stderr: string): string {
  if (code === 0) return ''
  const tail = stderr.trim().split('\n').pop() ?? ''
  const friendly = (msg: string): string => (tail ? `${msg} — ${tail}` : msg)
  switch (code) {
    case 6:
      return friendly('DNS lookup failed')
    case 7:
      return friendly('Connection refused')
    case 28:
      return friendly('Request timed out')
    case 35:
      return friendly('TLS handshake failed')
    case 51:
    case 60:
      return friendly('TLS certificate verification failed')
    case 56:
      return friendly('Network read error')
    case 58:
      return friendly('Could not load client certificate')
    case 59:
      return friendly('Could not use specified cipher')
    case 77:
      return friendly('Could not load CA bundle')
    default:
      return tail || `curl exited with status ${code}`
  }
}

/**
 * Execute an HttpRequestOptions through the system curl. Returns the same
 * ApiResponse shape the axios path produces so callers don't have to know
 * which sidecar handled the request.
 */
export async function executeViaCurl(options: HttpRequestOptions): Promise<CurlApiResponse> {
  const requestId = randomUUID()
  const t0 = performance.now()

  if (!(await isCurlAvailable())) {
    return {
      requestId,
      protocol: 'http',
      timing: { total: Math.round(performance.now() - t0) },
      error:
        'TLS 1.0/1.1 requires the system `curl` binary, which was not found on this machine. Install curl (https://curl.se/download.html) and restart Testnizer.',
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'testnizer-curl-'))
  const headersDumpPath = join(tempDir, 'response-headers.txt')
  const bodyOutputPath = join(tempDir, 'response-body.bin')
  const extraTempFiles: string[] = []

  try {
    // ── URL + query params ───────────────────────────────────
    const url = new URL(options.url)
    if (options.params) {
      for (const p of options.params) {
        if (p.enabled && p.key) url.searchParams.append(p.key, p.value)
      }
    }

    // ── Headers (cookies join with the jar later) ────────────
    const headers: Record<string, string> = {}
    if (options.headers) {
      for (const h of options.headers) {
        if (h.enabled && h.key) headers[h.key] = h.value
      }
    }

    // ── Auth ─────────────────────────────────────────────────
    let basicAuth: { username: string; password: string } | undefined
    let digestAuth: { username: string; password: string } | undefined
    let ntlmAuth: { username: string; password: string; domain?: string } | undefined
    if (options.auth && options.auth.type !== 'none') {
      const a = options.auth
      if (a.type === 'basic' && a.basic) basicAuth = a.basic
      else if (a.type === 'digest' && a.digest) digestAuth = a.digest
      else if (a.type === 'ntlm' && a.ntlm) ntlmAuth = a.ntlm
      else if (a.type === 'bearer' && a.bearer) {
        const prefix = a.bearer.prefix || 'Bearer'
        headers['Authorization'] = `${prefix} ${a.bearer.token}`
      } else if (a.type === 'oauth2' && a.oauth2?.token) {
        headers['Authorization'] = `Bearer ${a.oauth2.token}`
      } else if (a.type === 'api-key' && a.apiKey) {
        if (a.apiKey.in === 'header') headers[a.apiKey.key] = a.apiKey.value
        else url.searchParams.append(a.apiKey.key, a.apiKey.value)
      }
      // Hawk + AWS signature: not auto-handled here. Users picking TLS 1.0
      // with those auth schemes are vanishingly rare; they can pre-compute
      // the Authorization header in a pre-request script.
    }

    // ── Body ─────────────────────────────────────────────────
    let bodyMode: 'none' | 'stdin' | 'formdata' | 'urlencoded' = 'none'
    let stdinBody: Buffer | null = null
    let formdataFields:
      | Array<
          | { type: 'text'; name: string; value: string }
          | { type: 'file'; name: string; filePath: string }
        >
      | undefined
    let urlencodedFields: Array<{ name: string; value: string }> | undefined

    if (options.body && options.body.type !== 'none') {
      switch (options.body.type) {
        case 'json':
          stdinBody = Buffer.from(options.body.content ?? '', 'utf8')
          bodyMode = 'stdin'
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
          break
        case 'xml':
          stdinBody = Buffer.from(options.body.content ?? '', 'utf8')
          bodyMode = 'stdin'
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/xml'
          break
        case 'text':
          stdinBody = Buffer.from(options.body.content ?? '', 'utf8')
          bodyMode = 'stdin'
          if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain'
          break
        case 'html':
          stdinBody = Buffer.from(options.body.content ?? '', 'utf8')
          bodyMode = 'stdin'
          if (!headers['Content-Type']) headers['Content-Type'] = 'text/html'
          break
        case 'javascript':
          stdinBody = Buffer.from(options.body.content ?? '', 'utf8')
          bodyMode = 'stdin'
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/javascript'
          break
        case 'urlencoded': {
          urlencodedFields = []
          if (options.body.urlEncoded) {
            for (const item of options.body.urlEncoded) {
              if (item.enabled) urlencodedFields.push({ name: item.key, value: item.value })
            }
          }
          bodyMode = 'urlencoded'
          break
        }
        case 'form-data': {
          formdataFields = []
          if (options.body.formData) {
            for (const item of options.body.formData) {
              if (!item.enabled || !item.key) continue
              if (item.type === 'file' && item.filePath) {
                try {
                  const st = await stat(item.filePath)
                  if (!st.isFile()) continue
                } catch {
                  continue
                }
                formdataFields.push({ type: 'file', name: item.key, filePath: item.filePath })
              } else {
                formdataFields.push({ type: 'text', name: item.key, value: item.value ?? '' })
              }
            }
          }
          bodyMode = 'formdata'
          break
        }
        case 'binary':
          if (options.body.binaryPath) {
            try {
              stdinBody = await readFile(options.body.binaryPath)
              bodyMode = 'stdin'
              if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream'
            } catch {
              /* fall through with no body */
            }
          }
          break
      }
    }

    // ── Cookies from jar ─────────────────────────────────────
    const jarCookies = await getJarCookieHeader(url.toString(), options.projectId)

    // ── Cert / CA temp files ─────────────────────────────────
    let caCertPath: string | undefined
    if (options.certificates?.caCerts?.length) {
      caCertPath = join(tempDir, 'ca.pem')
      await writeFile(caCertPath, Buffer.concat(options.certificates.caCerts))
      extraTempFiles.push(caCertPath)
    }
    const cc = options.certificates?.clientCert
    let clientCertPath: string | undefined
    let clientCertType: 'PEM' | 'P12' | undefined
    let clientKeyPath: string | undefined
    if (cc) {
      if (cc.pfx) {
        clientCertPath = join(tempDir, 'client.p12')
        await writeFile(clientCertPath, cc.pfx)
        clientCertType = 'P12'
        extraTempFiles.push(clientCertPath)
      } else if (cc.cert) {
        clientCertPath = join(tempDir, 'client.pem')
        await writeFile(clientCertPath, cc.cert)
        clientCertType = 'PEM'
        extraTempFiles.push(clientCertPath)
        if (cc.key) {
          clientKeyPath = join(tempDir, 'client.key')
          await writeFile(clientKeyPath, cc.key)
          extraTempFiles.push(clientKeyPath)
        }
      }
    }

    // ── Build args ───────────────────────────────────────────
    const args = buildCurlArgs({
      url: url.toString(),
      method: options.method,
      headers,
      cookieHeader: jarCookies || undefined,
      bodyMode,
      formdataFields,
      urlencodedFields,
      tls: {
        minVersion: options.tls?.minVersion,
        maxVersion: options.tls?.maxVersion,
        ciphers: options.tls?.ciphers,
      },
      sslVerification: options.sslVerification !== false,
      followRedirects: options.followRedirects !== false,
      timeoutMs: options.timeout ?? 30000,
      proxy:
        options.proxy?.mode === 'custom' && options.proxy.host
          ? {
              host: options.proxy.host,
              port: options.proxy.port ?? 8080,
              auth: options.proxy.auth,
            }
          : null,
      proxyDisabled: options.proxy?.mode === 'none',
      caCertPath,
      clientCertPath,
      clientCertType,
      clientKeyPath,
      clientCertPassphrase: cc?.passphrase,
      basicAuth,
      digestAuth,
      ntlmAuth,
      headersDumpPath,
      bodyOutputPath,
    })

    // ── Run curl ─────────────────────────────────────────────
    const { stdout, stderr, exitCode } = await spawnCurl(args, stdinBody, options.signal)

    if (exitCode !== 0) {
      return {
        requestId,
        protocol: 'http',
        timing: { total: Math.round(performance.now() - t0) },
        error: describeCurlExit(exitCode, stderr),
        actualRequest: {
          method: options.method,
          url: url.toString(),
          headers,
          body: stdinBody ? stdinBody.toString('utf8') : undefined,
        },
      }
    }

    // ── Parse outputs ────────────────────────────────────────
    let stats: CurlStats | null = null
    try {
      stats = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as CurlStats
    } catch {
      stats = null
    }

    let rawHeaders = ''
    try {
      rawHeaders = await readFile(headersDumpPath, 'utf8')
    } catch {
      rawHeaders = ''
    }
    const parsed = parseCurlHeaders(rawHeaders)

    let rawBody = ''
    try {
      rawBody = await readFile(bodyOutputPath, 'utf8')
    } catch {
      rawBody = ''
    }

    // Push response cookies into the jar so subsequent requests inherit them.
    if (parsed.setCookieHeaders.length > 0) {
      await storeResponseCookies(
        url.toString(),
        { 'set-cookie': parsed.setCookieHeaders },
        options.projectId,
      )
    }

    const cookies: CurlResponseCookie[] = parsed.setCookieHeaders.map((sc) => {
      const parts = sc.split(';').map((p) => p.trim())
      const [first, ...rest] = parts
      const eqIdx = first.indexOf('=')
      const name = eqIdx >= 0 ? first.slice(0, eqIdx) : first
      const value = eqIdx >= 0 ? first.slice(eqIdx + 1) : ''
      const cookie: CurlResponseCookie = { name, value }
      for (const part of rest) {
        const [k, v] = part.split('=').map((s) => s.trim())
        const lower = k.toLowerCase()
        if (lower === 'domain') cookie.domain = v
        else if (lower === 'path') cookie.path = v
        else if (lower === 'expires') cookie.expires = v
        else if (lower === 'httponly') cookie.httpOnly = true
        else if (lower === 'secure') cookie.secure = true
        else if (lower === 'samesite') cookie.sameSite = v
      }
      return cookie
    })

    const total = stats ? Math.round(stats.time_total * 1000) : Math.round(performance.now() - t0)
    const dns = stats ? Math.round(stats.time_namelookup * 1000) : undefined
    const tcp = stats ? Math.round((stats.time_connect - stats.time_namelookup) * 1000) : undefined
    const tls = stats
      ? Math.round(Math.max(0, (stats.time_appconnect - stats.time_connect) * 1000))
      : undefined
    const ttfb = stats
      ? Math.round(
          Math.max(
            0,
            (stats.time_starttransfer - (stats.time_appconnect || stats.time_connect)) * 1000,
          ),
        )
      : undefined
    const download = stats
      ? Math.round(Math.max(0, (stats.time_total - stats.time_starttransfer) * 1000))
      : undefined

    return {
      requestId,
      protocol: 'http',
      status: parsed.status || stats?.http_code,
      statusText: parsed.statusText,
      headers: parsed.headers,
      body: rawBody,
      bodySize: stats?.size_download ?? Buffer.byteLength(rawBody),
      timing: { total, dns, tcp, tls, ttfb, download },
      cookies,
      actualRequest: {
        method: options.method,
        url: url.toString(),
        headers,
        body: stdinBody ? stdinBody.toString('utf8') : undefined,
      },
      consoleLogs: [
        {
          level: 'log',
          message: `[curl sidecar] ${curlVersion ?? 'curl'} — TLS min=${options.tls?.minVersion ?? '-'} max=${options.tls?.maxVersion ?? '-'}`,
          timestamp: Date.now(),
        },
      ],
    }
  } finally {
    // Best-effort cleanup. `mkdtemp` returns a unique directory so removing
    // it recursively is safe even if individual files are missing.
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    void extraTempFiles
    void basename // keep import slot for future request-name dumping
  }
}
