import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { URL } from 'node:url'
import zlib from 'node:zlib'

const ECHO_PROTO = fs.readFileSync(path.join(__dirname, 'echo.proto'), 'utf8')

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

    if (path === '/fixtures/echo.proto' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(ECHO_PROTO)
      return
    }

    if (path === '/get' && method === 'GET') {
      const args: Record<string, string> = {}
      url.searchParams.forEach((v, k) => {
        args[k] = v
      })
      jsonResponse(200, { args, headers, origin: headers.origin ?? '', url: url.toString() })
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
      jsonResponse(200, { headers })
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
