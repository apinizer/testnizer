import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import { CookieJar } from 'tough-cookie'
import { randomUUID } from 'crypto'
import { createHash, createHmac } from 'crypto'
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { performance } from 'perf_hooks'
import FormData from 'form-data'
import { createReadStream, statSync } from 'fs'
import { basename } from 'path'
import { applyDefaultUserAgent } from '../lib/user-agent'
import { parseSseBody } from '../lib/sse-body-parser'
import { classifyTransportError, hintForHttpStatus } from '../lib/error-classifier'
import { normaliseTlsVersion, isLegacyTlsVersion, type TlsOptions } from '../lib/tls-presets'
import { executeViaCurl, shouldUseCurlSidecar } from './curl-shim'

// ─── Types (main-process local, mirrors renderer types) ──────

interface KeyValuePair {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
  // Form-data field type — text or file. Defaults to 'text' when undefined.
  type?: 'text' | 'file'
  filePath?: string
}

interface RequestBody {
  type: string
  content?: string
  formData?: KeyValuePair[]
  urlEncoded?: KeyValuePair[]
  binaryPath?: string
}

interface AuthConfig {
  type: string
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
  oauth2?: { token?: string }
  digest?: { username: string; password: string }
  ntlm?: { username: string; password: string; domain?: string; workstation?: string }
  hawk?: { authId: string; authKey: string; algorithm: 'sha1' | 'sha256' }
  awsSignature?: { accessKey: string; secretKey: string; region: string; service: string }
}

interface ProxyConfig {
  mode: 'system' | 'none' | 'custom'
  host?: string
  port?: number
  auth?: { username: string; password: string }
}

interface ResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

interface ResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

interface ActualRequestInfo {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

interface SseEventPayload {
  id?: string
  type: string
  data: string
  /** Wall-clock timestamp the event was parsed (ms since epoch). */
  timestamp: number
  retry?: number
}

interface ApiResponse {
  requestId: string
  protocol: 'http'
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  timing: ResponseTiming
  error?: string
  cookies?: ResponseCookie[]
  actualRequest?: ActualRequestInfo
  /** Populated when the response Content-Type is `text/event-stream`. */
  sseEvents?: SseEventPayload[]
}

/**
 * Returns true when the raw `Content-Type` value (which may include
 * parameters like `; charset=utf-8`) starts with `text/event-stream`.
 */
function isEventStreamContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0]?.trim().toLowerCase()
  return mime === 'text/event-stream'
}

/**
 * Strip `user:pass@` userinfo from a URL before we display it in Run
 * Results / actualRequest or persist it to history. Basic-auth credentials
 * should travel via the Authorization header, not the URL. Returns the
 * input unchanged when it isn't parseable as a URL. Exported so IPC
 * handlers (request, runner, soap, ...) can sanitise the URL before
 * writing to the SQLite history table; otherwise `https://user:pw@host`
 * leaks to disk even when the runtime/UI strip succeeds.
 */
export function stripUrlCredentials(raw: string): string {
  if (!raw) return raw
  try {
    const u = new URL(raw)
    if (u.username || u.password) {
      u.username = ''
      u.password = ''
      return u.toString()
    }
    return raw
  } catch {
    return raw
  }
}

export interface HttpRequestOptions {
  method: string
  url: string
  params?: KeyValuePair[]
  headers?: KeyValuePair[]
  body?: RequestBody
  auth?: AuthConfig
  timeout?: number
  followRedirects?: boolean
  /** Cap the redirect chain. Ignored when followRedirects === false. */
  maxRedirects?: number
  sslVerification?: boolean
  proxy?: ProxyConfig
  certificates?: {
    caCerts?: Buffer[]
    clientCert?: {
      cert?: Buffer
      key?: Buffer
      pfx?: Buffer
      passphrase?: string
    }
  }
  /**
   * Override TLS protocol/cipher selection. Used by the BadSSL test matrix
   * (talking to deliberately-broken servers) and by enterprise users whose
   * legacy backends still require TLS 1.0 / RC4 / weak DH parameters.
   */
  tls?: TlsOptions
  signal?: AbortSignal
  /**
   * Project id scope for the cookie jar. Two requests from different
   * projects to the same host get isolated cookie state — without this,
   * a Bearer-equivalent Set-Cookie from project A would auto-attach to
   * project B's requests.
   */
  projectId?: string | null
}

// ─── Cookie Jar (manual management — no axios-cookiejar-support) ─────
//
// Cookie state is scoped per project so that auth cookies from one project
// don't leak into requests fired from another (audit finding: a shared
// singleton jar was exfiltrating Bearer-equivalent Set-Cookie tokens
// across project boundaries on the same host).
//
// A `null` projectId falls back to a "_default" jar — used by Quick Test
// and any callsite that hasn't been retrofitted to pass projectId yet.
const cookieJars = new Map<string, CookieJar>()

function jarFor(projectId: string | null | undefined): CookieJar {
  const key = projectId || '_default'
  let jar = cookieJars.get(key)
  if (!jar) {
    jar = new CookieJar()
    cookieJars.set(key, jar)
  }
  return jar
}

export async function getJarCookieHeader(url: string, projectId?: string | null): Promise<string> {
  try {
    return await jarFor(projectId).getCookieString(url)
  } catch {
    return ''
  }
}

export async function storeResponseCookies(
  url: string,
  headers: Record<string, string | string[] | undefined>,
  projectId?: string | null,
): Promise<void> {
  const setCookieHeaders = headers['set-cookie']
  if (!setCookieHeaders) return

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]
  const jar = jarFor(projectId)

  for (const cookie of cookies) {
    try {
      await jar.setCookie(cookie, url)
    } catch {
      // Ignore malformed cookies
    }
  }
}

// ─── Helper: Build auth headers ──────────────────────────────

function applyAuth(
  config: AxiosRequestConfig,
  auth: AuthConfig,
  method: string,
  url: string,
): void {
  switch (auth.type) {
    case 'basic': {
      // Previously set axios's `config.auth`, which (a) made the value
      // appear too late for `actualRequest.headers` capture — the
      // Authorization header was added by axios's request interceptor
      // *after* we snapshot `config.headers`, so Run Results showed an
      // empty header bag (v1.4.4 §5.3) — and (b) on Node's underlying
      // `http.request` the `auth` field could surface in
      // `response.request.res.responseUrl` as `user:pass@host`, which
      // we then displayed as the effective URL in the runner panel
      // (v1.4.4 §5.1). Building the header ourselves keeps both the
      // header capture and the displayed URL credential-free.
      if (auth.basic) {
        // RFC 7617 §2: usernames MUST NOT contain `:`. An accidental
        // colon would silently corrupt the credential on the server
        // side (the first `:` becomes the username/password separator
        // after decode). Strip it pragmatically with a warning rather
        // than failing the whole request — axios's old `config.auth`
        // didn't validate either, but we no longer have that
        // protection so call it out loudly.
        let username = auth.basic.username ?? ''
        const password = auth.basic.password ?? ''
        if (username.includes(':')) {
          console.warn('[http.engine] basic auth username contains ":" — stripping')
          username = username.replace(/:/g, '')
        }
        // Don't clobber an explicit user-set Authorization header. If the
        // user typed `Authorization: Bearer …` into the Headers tab AND
        // turned on Basic auth, the old `config.auth` path let the
        // explicit header win — preserve that order so a deliberate
        // manual header isn't silently overridden by the auth config.
        config.headers = config.headers || {}
        const existing = Object.keys(config.headers).some(
          (k) => k.toLowerCase() === 'authorization',
        )
        if (!existing) {
          const token = Buffer.from(`${username}:${password}`).toString('base64')
          config.headers['Authorization'] = `Basic ${token}`
        }
      }
      break
    }
    case 'bearer': {
      if (auth.bearer) {
        const prefix = auth.bearer.prefix || 'Bearer'
        config.headers = config.headers || {}
        config.headers['Authorization'] = `${prefix} ${auth.bearer.token}`
      }
      break
    }
    case 'api-key': {
      if (auth.apiKey) {
        if (auth.apiKey.in === 'header') {
          config.headers = config.headers || {}
          config.headers[auth.apiKey.key] = auth.apiKey.value
        } else {
          config.params = config.params || {}
          ;(config.params as Record<string, string>)[auth.apiKey.key] = auth.apiKey.value
        }
      }
      break
    }
    case 'oauth2': {
      if (auth.oauth2?.token) {
        config.headers = config.headers || {}
        config.headers['Authorization'] = `Bearer ${auth.oauth2.token}`
      }
      break
    }
    case 'digest': {
      if (auth.digest) {
        config.auth = {
          username: auth.digest.username,
          password: auth.digest.password,
        }
      }
      break
    }
    case 'hawk': {
      if (auth.hawk) {
        const hawkHeader = generateHawkHeader(
          method,
          url,
          auth.hawk.authId,
          auth.hawk.authKey,
          auth.hawk.algorithm,
        )
        config.headers = config.headers || {}
        config.headers['Authorization'] = hawkHeader
      }
      break
    }
    case 'aws-signature': {
      if (auth.awsSignature) {
        const awsHeaders = generateAwsSignatureHeaders(
          method,
          url,
          auth.awsSignature.accessKey,
          auth.awsSignature.secretKey,
          auth.awsSignature.region,
          auth.awsSignature.service,
          (config.data as string) ?? '',
        )
        config.headers = { ...config.headers, ...awsHeaders }
      }
      break
    }
    case 'ntlm': {
      if (auth.ntlm) {
        config.auth = {
          username: auth.ntlm.domain
            ? `${auth.ntlm.domain}\\${auth.ntlm.username}`
            : auth.ntlm.username,
          password: auth.ntlm.password,
        }
      }
      break
    }
  }
}

function generateHawkHeader(
  method: string,
  url: string,
  id: string,
  key: string,
  algorithm: 'sha1' | 'sha256',
): string {
  const parsed = new URL(url)
  const ts = Math.floor(Date.now() / 1000)
  const nonce = randomUUID().slice(0, 8)
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')

  const normalized =
    [
      'hawk.1.header',
      ts.toString(),
      nonce,
      method.toUpperCase(),
      parsed.pathname + parsed.search,
      parsed.hostname,
      port,
      '', // hash (empty for no payload validation)
      '', // ext
    ].join('\n') + '\n'

  const mac = createHmac(algorithm === 'sha1' ? 'sha1' : 'sha256', key)
    .update(normalized)
    .digest('base64')

  return `Hawk id="${id}", ts="${ts}", nonce="${nonce}", mac="${mac}"`
}

function generateAwsSignatureHeaders(
  method: string,
  url: string,
  accessKey: string,
  secretKey: string,
  region: string,
  service: string,
  body: string,
): Record<string, string> {
  const parsed = new URL(url)
  const now = new Date()
  const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8)
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

  const payloadHash = createHash('sha256').update(body).digest('hex')

  const canonicalHeaders = `host:${parsed.hostname}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-date'

  const canonicalRequest = [
    method.toUpperCase(),
    parsed.pathname || '/',
    parsed.search ? parsed.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signingKey = getAwsSignatureKey(secretKey, dateStamp, region, service)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    Authorization: authHeader,
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
  }
}

function getAwsSignatureKey(
  key: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(service).digest()
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest()
  return kSigning
}

// ─── Parse Set-Cookie headers into structured cookies ──────

function parseSetCookieHeaders(
  url: string,
  rawHeaders: Record<string, string | string[] | undefined>,
): ResponseCookie[] {
  const cookies: ResponseCookie[] = []
  const setCookieValues = rawHeaders['set-cookie']
  if (!setCookieValues) return cookies

  const values = Array.isArray(setCookieValues) ? setCookieValues : [setCookieValues]

  for (const raw of values) {
    try {
      const parts = raw.split(';').map((s) => s.trim())
      const [nameValue] = parts
      const eqIdx = nameValue.indexOf('=')
      if (eqIdx < 0) continue

      const cookie: ResponseCookie = {
        name: nameValue.slice(0, eqIdx),
        value: nameValue.slice(eqIdx + 1),
      }

      for (let i = 1; i < parts.length; i++) {
        const lower = parts[i].toLowerCase()
        if (lower.startsWith('domain=')) cookie.domain = parts[i].slice(7)
        else if (lower.startsWith('path=')) cookie.path = parts[i].slice(5)
        else if (lower.startsWith('expires=')) cookie.expires = parts[i].slice(8)
        else if (lower === 'httponly') cookie.httpOnly = true
        else if (lower === 'secure') cookie.secure = true
        else if (lower.startsWith('samesite=')) cookie.sameSite = parts[i].slice(9)
      }

      if (!cookie.domain) {
        try {
          cookie.domain = new URL(url).hostname
        } catch {
          /* skip */
        }
      }

      cookies.push(cookie)
    } catch {
      // Skip malformed cookie
    }
  }

  return cookies
}

// ─── Socket timing instrumentation ───────────────────────────

interface SocketTimings {
  dns?: number
  tcp?: number
  tls?: number
}

/**
 * Wrap an `http`/`https` agent's `createConnection` to record the timestamps
 * of the socket lifecycle events the browser dev tools call DNS / TCP / TLS.
 * Returns a mutable object the caller can read AFTER the request finishes —
 * each field is the elapsed milliseconds spent in that phase. Fields stay
 * `undefined` when the corresponding event never fires (e.g. TLS on http://).
 *
 * Industry reference: this mirrors what `got` / `axios-time` / Postman's
 * own engine do — capture `lookup`, `connect`, `secureConnect` once per
 * socket and subtract the previous timestamp to get the phase duration.
 */
function attachSocketTimings(httpsAgent: https.Agent, httpAgent: http.Agent): SocketTimings {
  const timings: SocketTimings = {}

  function instrument<TAgent extends http.Agent | https.Agent>(agent: TAgent): void {
    type CreateConnFn = (
      options: http.ClientRequestArgs,
      callback?: (err: Error | null, socket: import('net').Socket) => void,
    ) => import('net').Socket
    const original = (agent as unknown as { createConnection?: CreateConnFn }).createConnection
    if (typeof original !== 'function') return
    ;(agent as unknown as { createConnection: CreateConnFn }).createConnection = function (
      opts,
      cb,
    ): import('net').Socket {
      const t0 = performance.now()
      let tLookup = 0
      let tConnect = 0
      const socket = original.call(this as unknown as TAgent, opts, cb)
      socket.once('lookup', () => {
        tLookup = performance.now()
        timings.dns = Math.round(tLookup - t0)
      })
      socket.once('connect', () => {
        tConnect = performance.now()
        // If `lookup` never fired (cached / unix socket) tLookup stays 0 and
        // we fall back to t0 so `tcp` still reflects the post-DNS interval.
        timings.tcp = Math.round(tConnect - (tLookup || t0))
      })
      socket.once('secureConnect', () => {
        const tSecure = performance.now()
        timings.tls = Math.round(tSecure - (tConnect || t0))
      })
      return socket
    }
  }

  instrument(httpsAgent)
  instrument(httpAgent)
  return timings
}

// ─── Main execute function ───────────────────────────────────

export async function executeHttpRequest(options: HttpRequestOptions): Promise<ApiResponse> {
  // Legacy-TLS sidecar route. Customers (banks, government API gateways)
  // still run TLS 1.0/1.1 backends that Electron 33's BoringSSL can't talk
  // to. When the user picks one of those protocol bounds we hand the whole
  // request off to system curl, which uses the OS TLS stack and can speak
  // them. See src/main/protocols/curl-shim.ts.
  if (shouldUseCurlSidecar(options.tls)) {
    return executeViaCurl(options)
  }

  const requestId = randomUUID()
  const timings: Partial<ResponseTiming> = {}
  const startTime = performance.now()

  try {
    // Build headers
    const headers: Record<string, string> = {}
    if (options.headers) {
      for (const h of options.headers) {
        if (h.enabled && h.key) {
          headers[h.key] = h.value
        }
      }
    }

    // Build query params
    const params: Record<string, string> = {}
    if (options.params) {
      for (const p of options.params) {
        if (p.enabled && p.key) {
          params[p.key] = p.value
        }
      }
    }

    // Build body
    let data: string | URLSearchParams | FormData | undefined
    let contentType: string | undefined

    if (options.body && options.body.type !== 'none') {
      switch (options.body.type) {
        case 'json':
          data = options.body.content
          contentType = 'application/json'
          break
        case 'xml':
          data = options.body.content
          contentType = 'application/xml'
          break
        case 'text':
          data = options.body.content
          contentType = 'text/plain'
          break
        case 'html':
          data = options.body.content
          contentType = 'text/html'
          break
        case 'javascript':
          data = options.body.content
          contentType = 'application/javascript'
          break
        case 'urlencoded': {
          const urlParams = new URLSearchParams()
          if (options.body.urlEncoded) {
            for (const item of options.body.urlEncoded) {
              if (item.enabled) {
                urlParams.append(item.key, item.value)
              }
            }
          }
          data = urlParams
          contentType = 'application/x-www-form-urlencoded'
          break
        }
        case 'form-data': {
          // Build a streaming multipart body so file uploads don't have to
          // be loaded into memory. The `form-data` package emits the proper
          // boundary header which axios then forwards as Content-Type.
          const form = new FormData()
          let hasFileField = false
          if (options.body.formData) {
            for (const item of options.body.formData) {
              if (!item.enabled || !item.key) continue
              if (item.type === 'file') {
                if (!item.filePath) continue
                try {
                  // Validate the file exists & is regular before opening a stream.
                  const stat = statSync(item.filePath)
                  if (!stat.isFile()) continue
                  const stream = createReadStream(item.filePath)
                  form.append(item.key, stream, {
                    filename: basename(item.filePath),
                    knownLength: stat.size,
                  })
                  hasFileField = true
                } catch {
                  // Skip files that can't be read; the caller will see a
                  // server-side error if the field was required.
                }
              } else {
                form.append(item.key, item.value ?? '')
              }
            }
          }
          data = form
          // Let `form-data` set the Content-Type with the right boundary —
          // copy its computed headers so axios uses them verbatim.
          const fdHeaders = form.getHeaders()
          for (const [k, v] of Object.entries(fdHeaders)) {
            // Don't clobber an explicit Content-Type override unless we have
            // a file (which requires the boundary parameter).
            if (k.toLowerCase() === 'content-type') {
              if (hasFileField || !headers['Content-Type']) {
                headers[k] = String(v)
              }
            } else {
              headers[k] = String(v)
            }
          }
          // Sentinel so the default Content-Type assignment below skips us.
          contentType = headers['Content-Type'] ?? 'multipart/form-data'
          break
        }
        case 'binary':
          if (options.body.binaryPath) {
            const fs = await import('fs')
            data = fs.readFileSync(options.body.binaryPath).toString('base64')
            contentType = 'application/octet-stream'
          }
          break
      }
    }

    if (contentType && !headers['Content-Type']) {
      headers['Content-Type'] = contentType
    }

    // Add cookies from jar
    const jarCookies = await getJarCookieHeader(options.url, options.projectId)
    if (jarCookies) {
      headers['Cookie'] = headers['Cookie'] ? `${headers['Cookie']}; ${jarCookies}` : jarCookies
    }

    // Build axios config
    const config: AxiosRequestConfig = {
      method: options.method.toLowerCase() as AxiosRequestConfig['method'],
      url: options.url,
      params,
      headers,
      data,
      // `timeout` honors an explicit 0 as "no timeout" (axios semantics).
      // Only fall back to the 30s default when nothing was supplied — a
      // sent 0 must NOT be clobbered (issue #24, Test B).
      timeout: options.timeout == null ? 30000 : options.timeout,
      // Honor the per-request "Max redirects" value; 0 (or follow-off)
      // disables following so the raw 3xx is returned (issues #25, #26).
      maxRedirects: options.followRedirects === false ? 0 : (options.maxRedirects ?? 5),
      validateStatus: () => true, // Accept all status codes
      responseType: 'text',
      transformResponse: [(d: string) => d], // Prevent auto JSON parse
      signal: options.signal,
      // Allow streaming arbitrary-size multipart uploads.
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }

    // SSL + certificate configuration
    const rejectUnauthorized = options.sslVerification !== false
    const httpsAgentOpts: https.AgentOptions = { rejectUnauthorized }
    if (options.certificates?.caCerts?.length) {
      httpsAgentOpts.ca = options.certificates.caCerts
    }
    const clientCert = options.certificates?.clientCert
    if (clientCert) {
      if (clientCert.pfx) {
        httpsAgentOpts.pfx = clientCert.pfx
        if (clientCert.passphrase) httpsAgentOpts.passphrase = clientCert.passphrase
      } else {
        if (clientCert.cert) httpsAgentOpts.cert = clientCert.cert
        if (clientCert.key) httpsAgentOpts.key = clientCert.key
        if (clientCert.passphrase) httpsAgentOpts.passphrase = clientCert.passphrase
      }
    }
    // TLS protocol / cipher override — needed for BadSSL `tlsv10`/`tlsv11`,
    // `rc4`/`threedes`/`nullcipher`, and `dh480`/`dh512` scenarios. Passing
    // these straight through to the agent lets users talk to legacy backends
    // without forking the engine.
    if (options.tls) {
      const min = normaliseTlsVersion(options.tls.minVersion)
      const max = normaliseTlsVersion(options.tls.maxVersion)
      // Skip TLS 1.0 / 1.1 here — those land on `https.Agent` as
      // ERR_SSL_INVALID_COMMAND because BoringSSL refuses to negotiate them.
      // The early sidecar guard at the top of `executeHttpRequest` routes
      // those requests through the curl shim instead.
      if (min && !isLegacyTlsVersion(min)) httpsAgentOpts.minVersion = min
      if (max && !isLegacyTlsVersion(max)) httpsAgentOpts.maxVersion = max
      if (options.tls.ciphers && options.tls.ciphers.trim()) {
        httpsAgentOpts.ciphers = options.tls.ciphers.trim()
      }
    }
    // Instrument the agents so we can observe socket events (DNS lookup, TCP
    // connect, TLS handshake) on a per-request basis. v1.3.1 M15 reported
    // that TLS handshake showed "—" and download time dropped to <1ms for a
    // 25MB response — symptoms of a timing formula that subtracted the wrong
    // intervals from each other. Hooking `createConnection` is the only way
    // to learn about the socket's lifecycle without forking the axios
    // adapter.
    const httpsAgent = new https.Agent(httpsAgentOpts)
    const httpAgent = new http.Agent()
    const socketTimings = attachSocketTimings(httpsAgent, httpAgent)
    config.httpsAgent = httpsAgent
    config.httpAgent = httpAgent

    // Proxy configuration
    if (options.proxy && options.proxy.mode === 'custom' && options.proxy.host) {
      config.proxy = {
        host: options.proxy.host,
        port: options.proxy.port ?? 8080,
        auth: options.proxy.auth
          ? {
              username: options.proxy.auth.username,
              password: options.proxy.auth.password,
            }
          : undefined,
      }
    } else if (options.proxy && options.proxy.mode === 'none') {
      config.proxy = false
    }

    // Apply auth
    if (options.auth && options.auth.type !== 'none') {
      applyAuth(config, options.auth, options.method, options.url)
    }

    // Inject default User-Agent unless the caller supplied one (any case).
    config.headers = config.headers || {}
    applyDefaultUserAgent(config.headers as Record<string, string>)

    // Track when the first response chunk arrives so we can split the
    // request into TTFB (server thinking) and download (body streaming).
    // Axios calls `onDownloadProgress` for each chunk it observes — the
    // first invocation is "first byte". For a Content-Length-0 response
    // this never fires, in which case we fall back to "ttfb = full reply".
    let firstByteAt: number | null = null
    config.onDownloadProgress = () => {
      if (firstByteAt == null) firstByteAt = performance.now()
    }

    // Execute request using plain axios (no cookiejar wrapper).
    const requestStart = performance.now()
    const response: AxiosResponse<string> = await axios.request(config)
    const endTime = performance.now()

    // Merge per-phase numbers from the socket-level instrumentation.
    // Anything the agent observed is authoritative; we only need to
    // synthesise TTFB and download from request-level marks.
    if (socketTimings.dns != null) timings.dns = socketTimings.dns
    if (socketTimings.tcp != null) timings.tcp = socketTimings.tcp
    if (socketTimings.tls != null) timings.tls = socketTimings.tls

    timings.total = Math.round(endTime - startTime)
    // `ttfb` is "time to first byte AFTER the socket was ready". When we
    // never saw a download chunk (Content-Length: 0) treat ttfb as the
    // whole reply and leave download at 0.
    const socketReady =
      (socketTimings.dns ?? 0) + (socketTimings.tcp ?? 0) + (socketTimings.tls ?? 0)
    if (firstByteAt != null) {
      timings.ttfb = Math.max(0, Math.round(firstByteAt - requestStart - socketReady))
      timings.download = Math.max(0, Math.round(endTime - firstByteAt))
    } else {
      timings.ttfb = Math.max(0, Math.round(endTime - requestStart - socketReady))
      timings.download = 0
    }

    // Extract response headers
    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value)
      }
    }

    // Store cookies from response into jar
    await storeResponseCookies(
      options.url,
      response.headers as Record<string, string | string[] | undefined>,
      options.projectId,
    )

    // Parse cookies for response display
    const cookies = parseSetCookieHeaders(
      options.url,
      response.headers as Record<string, string | string[] | undefined>,
    )

    // Also include cookies already in the jar for this URL
    try {
      const jarCookieObjs = await jarFor(options.projectId).getCookies(options.url)
      for (const c of jarCookieObjs) {
        const exists = cookies.some((rc) => rc.name === c.key)
        if (!exists) {
          cookies.push({
            name: c.key,
            value: c.value,
            domain: c.domain ?? undefined,
            path: c.path ?? undefined,
            httpOnly: c.httpOnly ?? undefined,
            secure: c.secure ?? undefined,
          })
        }
      }
    } catch {
      // Cookie extraction failed — not critical
    }

    // Body size
    const bodyStr = response.data ?? ''
    const bodySize = Buffer.byteLength(bodyStr, 'utf-8')

    // Parse Server-Sent Events bodies into a structured event list so the
    // renderer can show a Postman-style "Events" tab. Real-time streaming is
    // handled by `sse.engine.ts`; this is post-processing of the buffered
    // body for one-shot requests that happen to return text/event-stream.
    let sseEvents: SseEventPayload[] | undefined
    const respContentType = responseHeaders['content-type'] ?? responseHeaders['Content-Type']
    if (isEventStreamContentType(respContentType) && bodyStr) {
      const parsed = parseSseBody(bodyStr)
      if (parsed.length > 0) {
        const now = Date.now()
        sseEvents = parsed.map((e) => ({
          id: e.id,
          type: e.type,
          data: e.data,
          retry: e.retry,
          timestamp: now,
        }))
      }
    }

    // Actual request info — for FormData multipart bodies show a readable
    // summary (the raw multipart stream is binary and not useful in the UI).
    let actualBody: string | undefined
    if (typeof data === 'string') {
      actualBody = data
    } else if (data instanceof FormData) {
      const summary: string[] = []
      if (options.body?.formData) {
        for (const item of options.body.formData) {
          if (!item.enabled || !item.key) continue
          if (item.type === 'file') {
            const fname = item.filePath ? basename(item.filePath) : item.value
            summary.push(`${item.key}: <file ${fname}>`)
          } else {
            summary.push(`${item.key}: ${item.value ?? ''}`)
          }
        }
      }
      actualBody = summary.join('\n')
    } else if (data) {
      actualBody = data.toString()
    }
    const actualRequest: ActualRequestInfo = {
      method: options.method.toUpperCase(),
      url: stripUrlCredentials(response.request?.res?.responseUrl ?? options.url),
      headers: config.headers as Record<string, string>,
      body: actualBody,
    }

    return {
      requestId,
      protocol: 'http',
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyStr,
      bodySize,
      timing: {
        total: timings.total ?? 0,
        dns: timings.dns,
        tcp: timings.tcp,
        tls: timings.tls,
        ttfb: timings.ttfb,
        download: timings.download,
      },
      cookies,
      actualRequest,
      sseEvents,
    }
  } catch (err) {
    const endTime = performance.now()
    const axiosErr = err as AxiosError

    if (axiosErr.response) {
      const responseHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(axiosErr.response.headers)) {
        if (value !== undefined) {
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value)
        }
      }

      // Server returned a non-2xx with a body — keep the body as-is and surface
      // a status-aware hint (e.g. "401 Unauthorized — check Authorization
      // header") so the user knows why the request was rejected without
      // having to read the body.
      const status = axiosErr.response.status
      const hint = hintForHttpStatus(status) ?? axiosErr.response.statusText
      const errorLine = hint ? `HTTP ${status} ${hint}` : `HTTP ${status}`
      return {
        requestId,
        protocol: 'http',
        status,
        statusText: axiosErr.response.statusText,
        headers: responseHeaders,
        body:
          typeof axiosErr.response.data === 'string'
            ? axiosErr.response.data
            : JSON.stringify(axiosErr.response.data),
        timing: { total: Math.round(endTime - startTime) },
        error: errorLine,
      }
    }

    // Transport-layer failure (DNS / TCP / TLS / abort) — classify into a
    // human-readable line preserving the raw libuv code for diagnostic value.
    const classified = classifyTransportError(err)
    return {
      requestId,
      protocol: 'http',
      timing: { total: Math.round(endTime - startTime) },
      error: classified.message,
    }
  }
}
