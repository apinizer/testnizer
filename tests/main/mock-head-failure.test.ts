/**
 * Issue #221 review (PR #225), item 3 — a status line / header the response
 * cannot carry. A script-set header value with CR/LF throws
 * `ERR_INVALID_CHAR` and a status below 100 a `RangeError` from
 * `writeHead`; both used to be caught as "socket already gone" and the
 * request was left open — the client hung and nothing was logged.
 *
 * Now, while the socket is still writable, the mock answers 500 JSON (the
 * provider's error shape for an AI reply) and logs it with the reason.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import {
  freePort,
  llmResponse,
  rawRead,
  serverDef,
  sseResponse,
  type RawRead,
} from './mock-sse-fixtures'

const ID = 'head-failure-mock'
const BAD_HEADER = "setHeader('x-bad', 'a\\r\\nb')"

afterEach(async () => {
  await mockServerManager.stopAll()
})

/** `rawRead`, or `'hung'` when no response arrives within `ms`. */
async function readOrHang(
  port: number,
  path: string,
  opts: Parameters<typeof rawRead>[2] = {},
  ms = 1500,
): Promise<RawRead | 'hung'> {
  return Promise.race([
    rawRead(port, path, opts),
    new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms)),
  ])
}

async function start(): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(
    serverDef(ID, port, [
      { path: '/sse', response: sseResponse('data: a', { intervalMs: 0 }, { script: BAD_HEADER }) },
      {
        path: '/llm',
        response: llmResponse('Hello', { provider: 'anthropic' }, { script: BAD_HEADER }),
      },
      {
        path: '/llm-openai',
        response: llmResponse('Hello', { provider: 'openai' }, { script: BAD_HEADER }),
      },
      {
        path: '/json',
        response: { bodyType: 'json', body: '{"ok":true}', script: 'setStatus(42)' },
      },
      {
        path: '/json-header',
        response: {
          bodyType: 'json',
          body: '{"ok":true}',
          // Stored before the script's bad one: must not ride on the 500.
          headers: [{ name: 'x-before', value: '1' }],
          script: BAD_HEADER,
        },
      },
    ]),
  )
  expect(r.ok).toBe(true)
  return port
}

const chat = JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] })

function lastLog() {
  return mockServerManager.getLogs(ID).at(-1)
}

describe('a response head that cannot be written answers 500 (no hang)', () => {
  it('sse: a CR/LF header value → 500 JSON, logged with the reason', async () => {
    const port = await start()
    const r = await readOrHang(port, '/sse')
    expect(r).not.toBe('hung')
    const res = r as RawRead
    expect(res.status).toBe(500)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(JSON.parse(res.text)).toMatchObject({ error: 'invalid_response' })
    expect(JSON.parse(res.text).message).toMatch(/x-bad/)
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
    const log = lastLog()!
    expect(log.statusCode).toBe(500)
    expect(log.error).toMatch(/could not be sent.*x-bad/i)
  })

  it('llm stream (anthropic): a CR/LF header value → the provider-shaped 500', async () => {
    const port = await start()
    const r = await readOrHang(port, '/llm', { method: 'POST', body: chat })
    expect(r).not.toBe('hung')
    const res = r as RawRead
    expect(res.status).toBe(500)
    const body = JSON.parse(res.text)
    expect(body.type).toBe('error')
    expect(body.error.type).toBe('api_error')
    expect(body.error.message).toMatch(/x-bad/)
    expect(lastLog()!.statusCode).toBe(500)
  })

  it('llm stream (openai): the OpenAI error envelope', async () => {
    const port = await start()
    const r = await readOrHang(port, '/llm-openai', { method: 'POST', body: chat })
    expect(r).not.toBe('hung')
    const body = JSON.parse((r as RawRead).text)
    expect((r as RawRead).status).toBe(500)
    expect(body.error).toMatchObject({ type: 'server_error', param: null, code: null })
  })

  it('llm JSON reply (stream false): provider-shaped 500 too', async () => {
    const port = await start()
    const r = await readOrHang(port, '/llm-openai', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(r).not.toBe('hung')
    expect((r as RawRead).status).toBe(500)
    expect(JSON.parse((r as RawRead).text).error.type).toBe('server_error')
  })

  it('plain json: a script status below 100 → 500 JSON, logged', async () => {
    const port = await start()
    const r = await readOrHang(port, '/json')
    expect(r).not.toBe('hung')
    const res = r as RawRead
    expect(res.status).toBe(500)
    expect(JSON.parse(res.text).error).toBe('invalid_response')
    const log = lastLog()!
    expect(log.statusCode).toBe(500)
    expect(log.error).toMatch(/could not be sent/i)
  })

  it('plain json: a CR/LF header value → 500 without the headers set before it', async () => {
    const port = await start()
    const r = await readOrHang(port, '/json-header')
    expect(r).not.toBe('hung')
    const res = r as RawRead
    expect(res.status).toBe(500)
    expect(res.headers['x-before']).toBeUndefined()
    expect(res.headers['x-bad']).toBeUndefined()
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })
})
