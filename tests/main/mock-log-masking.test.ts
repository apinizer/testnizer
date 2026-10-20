/**
 * Issue #221 (Faz 1a, design Ek C R01 note) — the HTTP mock's request log
 * masks credentials. Before this change `MockLogEntry.request.headers` held
 * the raw `Authorization` / `x-api-key` values (and the query its `api_key`),
 * so a real key sent to a mock by mistake sat in the Logs tab in clear text.
 *
 * Only the LOG is masked: auth checks and templates still see the real
 * values (the request is answered normally, the echo body carries them).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import { HISTORY_MASK } from '../../src/shared/credential-headers'
import type { MockLogEntry } from '../../src/main/mock/types'
import {
  freePort,
  llmResponse,
  rawRead,
  serverDef,
  sseResponse,
  waitFor,
} from './mock-sse-fixtures'

const ID = 'mask-mock'
const TOKEN = 'tok-abcdefgh12345'
const API_KEY = 'key-zyxwvut98765'
const QUERY_KEY = 'q-secret-value-1'

const REQUEST_HEADERS = {
  authorization: `Bearer ${TOKEN}`,
  'x-api-key': API_KEY,
  'x-trace': 'plain-visible',
}

afterEach(async () => {
  await mockServerManager.stopAll()
})

async function start(): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(
    serverDef(
      ID,
      port,
      [
        {
          path: '/json',
          response: {
            bodyType: 'json',
            body: '{"auth":"{{request.headers.authorization}}","key":"{{request.headers.x-api-key}}"}',
          },
        },
        {
          path: '/sse',
          response: sseResponse('data: {{request.headers.x-api-key}}\n\ndata: done', {
            intervalMs: 0,
          }),
        },
        {
          path: '/llm',
          response: llmResponse('Key: {{request.headers.x-api-key}} end', { chunking: 'word' }),
        },
        {
          // The engine cuts this reply itself: the key is spread over many frames.
          path: '/llm-split',
          response: llmResponse('Key: {{request.headers.x-api-key}} end', {
            chunking: 'char',
            toolCalls: [{ name: 'echo', arguments: { key: '{{request.headers.x-api-key}}' } }],
          }),
        },
      ],
      // The live auth check needs the REAL bearer value.
      { auth: { type: 'bearer', tokens: [TOKEN] } },
    ),
  )
  expect(r.ok).toBe(true)
  return port
}

function expectMasked(entry: MockLogEntry): void {
  expect(entry.request.headers.authorization).toBe(HISTORY_MASK)
  expect(entry.request.headers['x-api-key']).toBe(HISTORY_MASK)
  expect(entry.request.headers['x-trace']).toBe('plain-visible')
  expect(entry.query).toBe(`api_key=${HISTORY_MASK}&page=2`)
  const all = JSON.stringify(entry)
  for (const secret of [TOKEN, API_KEY, QUERY_KEY]) expect(all).not.toContain(secret)
}

describe('mock request log masks credentials (every body type)', () => {
  it('json response: answered with the real values, logged masked', async () => {
    const port = await start()
    const r = await rawRead(port, `/json?api_key=${QUERY_KEY}&page=2`, { headers: REQUEST_HEADERS })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual({ auth: `Bearer ${TOKEN}`, key: API_KEY })
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.statusCode).toBe(200)
    expectMasked(entry)
  })

  it('a wrong token is still refused — the mask never reaches the auth check', async () => {
    const port = await start()
    const r = await rawRead(port, '/json', {
      headers: { authorization: 'Bearer not-the-token-123' },
    })
    expect(r.status).toBe(401)
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.request.headers.authorization).toBe(HISTORY_MASK)
  })

  it('sse response: the open and the closed entry are both masked (frame preview included)', async () => {
    const port = await start()
    const r = await rawRead(port, `/sse?api_key=${QUERY_KEY}&page=2`, { headers: REQUEST_HEADERS })
    expect(r.text).toBe(`data: ${API_KEY}\n\ndata: done\n\n`)
    expect(await waitFor(() => mockServerManager.getLogs(ID).length === 2)).toBe(true)
    const logs = mockServerManager.getLogs(ID)
    expect(logs.map((l) => l.response.headers['x-mock-stream'])).toEqual([
      'open',
      'frames=2;reason=completed',
    ])
    for (const entry of logs) expectMasked(entry)
    expect(logs[1].response.body).toContain(`data: ${HISTORY_MASK}`)
  })

  it('llm response (issue #221, Faz 2a): streamed and JSON replies are logged masked', async () => {
    const port = await start()
    const chat = (stream: boolean): string =>
      JSON.stringify({ model: 'm', stream, messages: [{ role: 'user', content: 'hi' }] })
    const r = await rawRead(port, `/llm?api_key=${QUERY_KEY}&page=2`, {
      method: 'POST',
      headers: { ...REQUEST_HEADERS, 'content-type': 'application/json' },
      body: chat(true),
    })
    expect(r.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    // The client gets the real value (only the log is masked).
    expect(r.text).toContain(API_KEY)
    expect(await waitFor(() => mockServerManager.getLogs(ID).length === 2)).toBe(true)
    const logs = mockServerManager.getLogs(ID)
    expect(logs.map((l) => l.response.headers['x-mock-stream'])).toEqual([
      'open',
      expect.stringMatching(/^frames=\d+;reason=completed$/),
    ])
    for (const entry of logs) expectMasked(entry)
    expect(logs[1].response.body).toContain(HISTORY_MASK)

    const j = await rawRead(port, `/llm?api_key=${QUERY_KEY}&page=2`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: chat(false),
    })
    expect(JSON.parse(j.text).choices[0].message.content).toBe(`Key: ${API_KEY} end`)
    const last = mockServerManager.getLogs(ID).at(-1)!
    expectMasked(last)
    expect(last.response.body).toContain(HISTORY_MASK)
  })

  it('llm stream cut into char / argument pieces: the closed entry is still masked', async () => {
    const port = await start()
    const r = await rawRead(port, `/llm-split?api_key=${QUERY_KEY}&page=2`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(r.text).toContain('[DONE]')
    expect(await waitFor(() => mockServerManager.getLogs(ID).length === 2)).toBe(true)
    const closed = mockServerManager.getLogs(ID)[1]
    expectMasked(closed)
    // The text / argument pieces of the logged body, joined: the key must not re-assemble.
    const pieces = [
      ...closed.response.body.matchAll(/"(?:content|text|arguments)":"((?:[^"\\]|\\.)*)"/g),
    ]
      .map((m) => m[1])
      .join('')
    expect(pieces.replace(/\\"/g, '"')).not.toContain(API_KEY)
    // The log shows the assembled reply (text + tool call), masked.
    const reply = JSON.parse(closed.response.body.slice(0, closed.response.body.indexOf('\n…')))
    expect(reply.choices[0].message.content).toBe(`Key: ${HISTORY_MASK} end`)
    expect(JSON.parse(reply.choices[0].message.tool_calls[0].function.arguments)).toEqual({
      key: HISTORY_MASK,
    })
    expect(closed.response.body).toMatch(/\(stream: \d+ frames, .* ended by the server\)$/)
  })
})
