/**
 * Shared fixtures for the SSE mock tests (issue #221): a free loopback port,
 * a `MockServerDef` builder and a raw HTTP reader that records the stream's
 * bytes and when each chunk arrived.
 */
import http from 'node:http'
import net from 'node:net'
import type { MockResponseDef, MockServerDef } from '../../src/main/mock/server'
import type { AuthConfig, MockMethod } from '../../src/main/mock/types'
import type { MockSseStreamConfig } from '../../src/shared/mock-stream'

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

export interface RouteSpec {
  path: string
  method?: MockMethod
  response: Partial<MockResponseDef> & { body: string }
}

export function sseResponse(
  body: string,
  streamConfig: Partial<MockSseStreamConfig> = {},
  over: Partial<MockResponseDef> = {},
): RouteSpec['response'] {
  return {
    bodyType: 'sse',
    body,
    streamConfig: {
      intervalMs: 20,
      heartbeatMs: 0,
      loop: false,
      onEnd: 'close',
      resume: true,
      ...streamConfig,
    },
    ...over,
  }
}

export function serverDef(
  id: string,
  port: number,
  routes: RouteSpec[],
  over: Partial<MockServerDef> = {},
): MockServerDef {
  return {
    id,
    name: id,
    host: '127.0.0.1',
    port,
    basePath: '',
    cors: {
      enabled: false,
      allowOrigins: '*',
      allowMethods: '*',
      allowHeaders: '*',
      allowCredentials: false,
      maxAge: 0,
    },
    auth: { type: 'none' } as AuthConfig,
    failure: { enabled: false, probability: 0, mode: 'status' },
    rateLimit: { enabled: false, requestsPerWindow: 1000, windowMs: 60000, scope: 'ip' },
    echoEnabled: false,
    proxyEnabled: false,
    proxyTarget: '',
    proxyRecord: false,
    endpoints: routes.map((r, i) => ({
      id: `ep-${i}`,
      method: r.method ?? 'ANY',
      path: r.path,
      pathMode: 'exact',
      description: '',
      priority: 0,
      enabled: true,
      authOverride: null,
      schemaValidation: null,
      responses: [
        {
          id: `resp-${i}`,
          name: '',
          statusCode: 200,
          headers: [],
          bodyType: 'text',
          delayMs: 0,
          condition: { type: 'always' },
          script: '',
          order: 0,
          enabled: true,
          ...r.response,
        },
      ],
    })),
    ...over,
  }
}

export interface RawRead {
  status: number
  headers: http.IncomingHttpHeaders
  text: string
  /** Arrival time of each chunk, ms since the request was sent. */
  chunks: { at: number; text: string }[]
  ended: boolean
}

/**
 * Read a response as raw bytes until it ends, `until(text)` holds, or
 * `maxMs` passes — then the request is destroyed.
 */
export function rawRead(
  port: number,
  path: string,
  opts: {
    method?: string
    headers?: Record<string, string>
    body?: string
    maxMs?: number
    until?: (text: string) => boolean
    onResponse?: (req: http.ClientRequest) => void
  } = {},
): Promise<RawRead> {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: opts.headers,
        agent: false,
      },
      (res) => {
        opts.onResponse?.(req)
        const out: RawRead = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: '',
          chunks: [],
          ended: false,
        }
        let done = false
        const settle = (): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(out)
        }
        const timer = setTimeout(() => {
          settle()
          req.destroy()
        }, opts.maxMs ?? 3000)
        res.setEncoding('utf8')
        res.on('data', (c: string) => {
          out.text += c
          out.chunks.push({ at: Date.now() - t0, text: c })
          if (opts.until?.(out.text)) {
            settle()
            req.destroy()
          }
        })
        res.on('end', () => {
          out.ended = true
          settle()
        })
        res.on('close', settle)
        res.on('error', settle)
      },
    )
    req.on('error', (e) => {
      // A destroyed request after settle is expected.
      if (!req.destroyed) reject(e)
    })
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

/** Poll `fn` until it is true or `ms` passes. */
export async function waitFor(fn: () => boolean, ms = 2000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return fn()
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * A `bodyType: 'llm'` response (issue #221, Faz 2a): `body` is the assistant
 * text, `llm` its settings (defaults: provider openai, word chunks, no wait).
 */
export function llmResponse(
  body: string,
  llm: Record<string, unknown> = {},
  over: Partial<MockResponseDef> = {},
): RouteSpec['response'] {
  return {
    bodyType: 'llm' as MockResponseDef['bodyType'],
    body,
    llmConfig: { provider: 'openai', chunkIntervalMs: 0, ...llm },
    ...over,
  } as RouteSpec['response']
}
