/**
 * Proxy passthrough + echo helpers for the mock-server runtime.
 *
 * Proxy: forwards an unmatched request to `proxyTarget` and streams the
 * upstream response back. Used as a fallback when no mock endpoint matches.
 *
 * Echo: returns a JSON description of the incoming request (method, path,
 * headers, query, body). Activated when `echoEnabled` is true and the path
 * is `/__echo` (any method).
 *
 * Recording: when proxy + record are both on, the captured upstream response
 * is also persisted as a new mock endpoint via the supplied `recorder`
 * callback so subsequent calls can be replayed offline.
 */

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

export interface ProxyResult {
  status: number
  headers: Record<string, string>
  body: string
}

export interface ProxyInput {
  target: string
  method: string
  /** path + query relative to the mock root, e.g. "/api/users?id=1" */
  pathWithQuery: string
  headers: Record<string, string>
  body: string
}

const PROXY_TIMEOUT_MS = 30_000

/** Forward a request to the configured upstream and return the response.
 *  Returns a 502 Bad Gateway result if the upstream fails. */
export function forwardRequest(input: ProxyInput): Promise<ProxyResult> {
  return new Promise((resolve) => {
    let url: URL
    try {
      url = new URL(input.pathWithQuery, input.target)
    } catch (e) {
      resolve(badGateway(`Invalid proxy target / path: ${e instanceof Error ? e.message : e}`))
      return
    }

    const transport = url.protocol === 'https:' ? https : http
    const headers = stripHopByHopHeaders(input.headers)

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: input.method,
        headers,
        timeout: PROXY_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const out: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) out[k.toLowerCase()] = v.join(', ')
            else if (v !== undefined) out[k.toLowerCase()] = String(v)
          }
          resolve({
            status: res.statusCode ?? 502,
            headers: stripHopByHopHeaders(out),
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', (e) => resolve(badGateway(e.message)))
      },
    )
    req.on('error', (e) => resolve(badGateway(e.message)))
    req.on('timeout', () => {
      req.destroy()
      resolve(badGateway('Upstream timeout'))
    })
    if (input.body) req.write(input.body)
    req.end()
  })
}

function badGateway(message: string): ProxyResult {
  return {
    status: 502,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ error: 'bad_gateway', message }),
  }
}

/** Hop-by-hop headers shouldn't be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  // Host gets reset by the transport layer; passing the upstream's host through is wrong.
  'host',
  // Content-Length gets recomputed by the transport, drop user-provided value.
  'content-length',
])

function stripHopByHopHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v
  }
  return out
}

// ─── Echo ─────────────────────────────────────────────────────────

export interface EchoInput {
  method: string
  path: string
  headers: Record<string, string>
  query: Record<string, string>
  body: unknown
  bodyText: string
}

export function buildEchoResponse(input: EchoInput): ProxyResult {
  const body = JSON.stringify(
    {
      method: input.method,
      path: input.path,
      headers: input.headers,
      query: input.query,
      body: input.body,
      bodyText: input.bodyText,
    },
    null,
    2,
  )
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body,
  }
}
