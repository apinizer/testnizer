import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { URL } from 'node:url'
import zlib from 'node:zlib'

const ECHO_PROTO = fs.readFileSync(path.join(__dirname, 'echo.proto'), 'utf8')
const FIXTURES_DIR = path.join(__dirname, '../../fixtures/import-export')
const FIXTURE_FILES: Record<string, string> = {
  'openapi-3.0.json': 'application/json',
  'postman-v2.1.json': 'application/json',
  'insomnia-v4.json': 'application/json',
  'sample.har': 'application/json',
  'sample.wsdl': 'application/xml',
  'echo.proto': 'text/plain',
}
const OPENAPI_FIXTURE = fs.readFileSync(path.join(FIXTURES_DIR, 'openapi-3.0.json'), 'utf8')

function parseMultipartForm(body: Buffer, contentType: string): Record<string, string> | undefined {
  const boundaryMatch = contentType.match(/boundary=([^;\s]+)/i)
  if (!boundaryMatch) return undefined
  const boundary = boundaryMatch[1].replace(/^"|"$/g, '')
  const form: Record<string, string> = {}
  const parts = body.toString('utf8').split(`--${boundary}`)
  for (const part of parts) {
    const nameMatch = part.match(/name="([^"]+)"/)
    if (!nameMatch) continue
    const chunks = part.split(/\r?\n\r?\n/)
    if (chunks.length < 2) continue
    const value = chunks.slice(1).join('\n').replace(/\r?\n--$/, '').trim()
    form[nameMatch[1]] = value
  }
  return Object.keys(form).length > 0 ? form : undefined
}

export interface HttpEchoServer {
  port: number
  baseUrl: string
  close: () => Promise<void>
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Node lowercases incoming header names; httpbin echoes custom X-* with original casing. */
function echoHeaders(raw: Record<string, string>): Record<string, string> {
  const out = { ...raw }
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('x-')) {
      const titled = k
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-')
      out[titled] = v
    }
  }
  return out
}

const DIGEST_USER = 'mufasa'
const DIGEST_PASS = 'Circle Of Life'
const DIGEST_REALM = 'testrealm@host.com'
const DIGEST_NONCE = 'dcd98b7102dd2f0e8b11d0f600bfb0c093'

function md5hex(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex')
}

function parseDigestParams(auth: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = auth.startsWith('Digest ') ? auth.slice(7) : auth
  for (const part of body.split(',')) {
    const m = part.trim().match(/^(\w+)="?([^"]+)"?$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function parseBasicAuth(authHeader: string | undefined): { user: string; pass: string } | null {
  if (!authHeader?.startsWith('Basic ')) return null
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
    const i = decoded.indexOf(':')
    if (i < 0) return null
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) }
  } catch {
    return null
  }
}

/** httpbin-compatible HTTP echo server for offline E2E. */
export async function startHttpEchoServer(port: number): Promise<HttpEchoServer> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const path = url.pathname
    const method = req.method ?? 'GET'
    const bodyBuf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req) : Buffer.alloc(0)
    const bodyText = bodyBuf.toString('utf8')

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v
    }

    const jsonResponse = (status: number, obj: unknown) => {
      const payload = JSON.stringify(obj)
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
    }

    if (path === '/health') {
      jsonResponse(200, { status: 'ok', protocol: 'http-echo', port })
      return
    }

    if (path.startsWith('/fixtures/') && method === 'GET') {
      const fileName = path.slice('/fixtures/'.length)
      if (fileName === 'echo.proto') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(ECHO_PROTO)
        return
      }
      const contentType = FIXTURE_FILES[fileName]
      if (contentType) {
        // Yerel `path` (url.pathname) node:path import'unu gölgeliyor — string birleştir.
        const filePath = `${FIXTURES_DIR}/${fileName}`
        if (fs.existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': contentType })
          res.end(fs.readFileSync(filePath))
          return
        }
      }
    }

    if (path === '/fixtures/openapi-3.0.json' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(OPENAPI_FIXTURE)
      return
    }

    if (path === '/get' && (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')) {
      if (method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end()
        return
      }
      if (method === 'OPTIONS') {
        res.writeHead(200, { Allow: 'GET, HEAD, OPTIONS, POST' })
        res.end()
        return
      }
      const args: Record<string, string> = {}
      url.searchParams.forEach((v, k) => {
        args[k] = v
      })
      jsonResponse(200, {
        args,
        headers: echoHeaders(headers),
        origin: headers.origin ?? '',
        url: url.toString(),
      })
      return
    }

    // Large JSON payload generator for big-response performance tests.
    // `?mb=N` controls the approximate size in megabytes (default 5, capped
    // at 10 to keep the offline harness bounded). Produces a JSON array of
    // repeated objects so the response is valid JSON the renderer must parse.
    if (path === '/large-json' && method === 'GET') {
      const mb = Math.min(Math.max(Number(url.searchParams.get('mb')) || 5, 1), 10)
      const targetBytes = mb * 1024 * 1024
      // Each element is a fixed-shape object; pad `data` so we hit the target.
      const filler = 'x'.repeat(900)
      const perItem = 1024 // rough byte cost of one stringified element
      const count = Math.ceil(targetBytes / perItem)
      const parts: string[] = ['[']
      for (let i = 0; i < count; i++) {
        if (i > 0) parts.push(',')
        parts.push(`{"id":${i},"marker":"large-json","data":"${filler}"}`)
      }
      parts.push(']')
      const payload = parts.join('')
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(payload)),
      })
      res.end(payload)
      return
    }

    if (path === '/post' && method === 'POST') {
      let json: unknown = null
      let form: Record<string, string> | undefined
      const ct = headers['content-type'] ?? ''
      if (ct.includes('application/json') && bodyText) {
        try {
          json = JSON.parse(bodyText)
        } catch {
          json = null
        }
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        form = {}
        new URLSearchParams(bodyText).forEach((v, k) => {
          form![k] = v
        })
      } else if (ct.includes('multipart/form-data')) {
        form = parseMultipartForm(bodyBuf, ct)
      }
      jsonResponse(200, { args: Object.fromEntries(url.searchParams), data: bodyText, json, form, headers })
      return
    }

    if (['/put', '/patch', '/delete'].includes(path) && method === path.slice(1).toUpperCase()) {
      jsonResponse(200, { args: Object.fromEntries(url.searchParams), data: bodyText, headers })
      return
    }

    if (path === '/head' && method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end()
      return
    }

    if (path === '/options' && method === 'OPTIONS') {
      res.writeHead(200, { Allow: 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS' })
      res.end()
      return
    }

    const statusMatch = path.match(/^\/status\/(\d+)$/)
    if (statusMatch && method === 'GET') {
      const code = Number(statusMatch[1])
      jsonResponse(code, { status: code })
      return
    }

    if (path === '/headers' && method === 'GET') {
      jsonResponse(200, { headers: echoHeaders(headers) })
      return
    }

    if (path === '/user-agent' && method === 'GET') {
      jsonResponse(200, { 'user-agent': headers['user-agent'] ?? '' })
      return
    }

    if (path === '/response-headers' && method === 'GET') {
      const outHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      url.searchParams.forEach((v, k) => {
        outHeaders[k] = v
      })
      const payload = JSON.stringify({ ok: true })
      res.writeHead(200, { ...outHeaders, 'Content-Length': String(Buffer.byteLength(payload)) })
      res.end(payload)
      return
    }

    const basicMatch = path.match(/^\/basic-auth\/([^/]+)\/([^/]+)$/)
    if (basicMatch && method === 'GET') {
      const expectedUser = decodeURIComponent(basicMatch[1])
      const expectedPass = decodeURIComponent(basicMatch[2])
      const creds = parseBasicAuth(headers.authorization)
      if (!creds || creds.user !== expectedUser || creds.pass !== expectedPass) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' })
        res.end()
        return
      }
      jsonResponse(200, { authenticated: true, user: creds.user })
      return
    }

    if (path === '/oauth/token' && method === 'POST') {
      let grantType = ''
      let clientId = ''
      let clientSecret = ''
      const ct = headers['content-type'] ?? ''
      if (ct.includes('application/json')) {
        try {
          const j = JSON.parse(bodyText) as Record<string, string>
          grantType = j.grant_type ?? ''
          clientId = j.client_id ?? ''
          clientSecret = j.client_secret ?? ''
        } catch {
          /* ignore */
        }
      } else {
        const params = new URLSearchParams(bodyText)
        grantType = params.get('grant_type') ?? ''
        clientId = params.get('client_id') ?? ''
        clientSecret = params.get('client_secret') ?? ''
      }
      if (grantType !== 'client_credentials' || clientId !== 'e2e-client' || clientSecret !== 'e2e-secret') {
        jsonResponse(401, { error: 'invalid_client' })
        return
      }
      jsonResponse(200, {
        access_token: 'oauth-e2e-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      })
      return
    }

    if (path === '/secure/resource' && method === 'GET') {
      const auth = headers.authorization ?? ''
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="${DIGEST_REALM}", qop="auth", nonce="${DIGEST_NONCE}", opaque="op-1"`,
        })
        res.end('challenge')
        return
      }
      const p = parseDigestParams(auth)
      const ha1 = md5hex(`${DIGEST_USER}:${DIGEST_REALM}:${DIGEST_PASS}`)
      const ha2 = md5hex(`${method}:${p.uri ?? '/secure/resource'}`)
      const expected = md5hex(`${ha1}:${DIGEST_NONCE}:${p.nc}:${p.cnonce}:auth:${ha2}`)
      if (p.response === expected && p.username === DIGEST_USER) {
        jsonResponse(200, { authenticated: true, user: DIGEST_USER })
      } else {
        res.writeHead(403)
        res.end('forbidden')
      }
      return
    }

    if (path === '/bearer' && method === 'GET') {
      const auth = headers.authorization ?? ''
      if (!auth.startsWith('Bearer ')) {
        res.writeHead(401)
        res.end()
        return
      }
      jsonResponse(200, { authenticated: true, token: auth.slice(7) })
      return
    }

    for (const algo of ['gzip', 'deflate', 'brotli'] as const) {
      if (path === `/${algo}` && method === 'GET') {
        const payload = JSON.stringify({
          gzipped: algo === 'gzip',
          deflated: algo === 'deflate',
          brotli: algo === 'brotli',
        })
        const buf = Buffer.from(payload)
        let out: Buffer
        let enc: string
        if (algo === 'gzip') {
          out = zlib.gzipSync(buf)
          enc = 'gzip'
        } else if (algo === 'deflate') {
          out = zlib.deflateSync(buf)
          enc = 'deflate'
        } else {
          out = zlib.brotliCompressSync(buf)
          enc = 'br'
        }
        res.writeHead(200, { 'Content-Encoding': enc, 'Content-Type': 'application/json' })
        res.end(out)
        return
      }
    }

    const delayMatch = path.match(/^\/delay\/(\d+)$/)
    if (delayMatch && method === 'GET') {
      const sec = Math.min(Number(delayMatch[1]), 10)
      setTimeout(() => jsonResponse(200, { delayed: sec }), sec * 1000)
      return
    }

    const redirectMatch = path.match(/^\/redirect\/(\d+)$/)
    if (redirectMatch && method === 'GET') {
      const hops = Number(redirectMatch[1])
      if (hops <= 0) {
        jsonResponse(200, { redirected: true })
        return
      }
      res.writeHead(302, { Location: `${url.origin}/redirect/${hops - 1}` })
      res.end()
      return
    }

    const bytesMatch = path.match(/^\/bytes\/(\d+)$/)
    if (bytesMatch && method === 'GET') {
      const n = Math.min(Number(bytesMatch[1]), 100_000)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.alloc(n, 0xab))
      return
    }

    const streamBytesMatch = path.match(/^\/stream-bytes\/(\d+)$/)
    if (streamBytesMatch && method === 'GET') {
      const n = Math.min(Number(streamBytesMatch[1]), 100_000)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.alloc(n, 0xcd))
      return
    }

    if (path === '/image/png' && method === 'GET') {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
      res.end(png)
      return
    }

    if (path === '/cookies' && method === 'GET') {
      const cookies: Record<string, string> = {}
      const raw = headers.cookie ?? ''
      raw.split(';').forEach((part) => {
        const [k, ...rest] = part.trim().split('=')
        if (k) cookies[k] = rest.join('=')
      })
      jsonResponse(200, { cookies })
      return
    }

    if (path === '/cookies/set' && method === 'GET' && url.searchParams.size > 0) {
      const cookies = Array.from(url.searchParams.entries()).map(
        ([name, value]) => `${name}=${value}; Path=/`,
      )
      res.writeHead(302, {
        'Content-Type': 'application/json',
        Location: `${url.origin}/cookies`,
        'Set-Cookie': cookies,
      })
      res.end()
      return
    }

    const setCookieMatch = path.match(/^\/cookies\/set\/([^/]+)\/([^/]+)$/)
    if (setCookieMatch && method === 'GET') {
      const name = decodeURIComponent(setCookieMatch[1])
      const value = decodeURIComponent(setCookieMatch[2])
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `${name}=${value}; Path=/`,
      })
      res.end(JSON.stringify({ set: { [name]: value } }))
      return
    }

    if (path === '/xml' && method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      res.end(`<echo>${bodyText}</echo>`)
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
