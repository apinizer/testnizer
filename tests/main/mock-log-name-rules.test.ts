/**
 * Issue #221 review (PR #225) — the HTTP mock's request log, items 1 and 2.
 *
 * 1. Mask, then clip. The SSE "closed" entry used to carry the written frames
 *    clipped at 16 KiB BEFORE `pushLog` masked them: a credential that
 *    straddled the cut survived as a prefix the value scrub could no longer
 *    recognise (the Console's issue #196 rule: mask first, then clip).
 * 2. Name rules on bodies and response headers. `pushLog` masked only the
 *    request headers / query by name; the request body, response headers and
 *    response body were value-scrubbed with the values found there — a
 *    `client_secret` in a JSON body, a form `password`, a proxied upstream
 *    `Set-Cookie` or a JSON reply's `access_token` stayed in the Logs tab.
 *
 * Only the LOG is masked: the client still receives the real values.
 */
import http from 'node:http'
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import { SSE_LOG_PREVIEW_BYTES, SSE_LOG_WINDOW_BYTES } from '../../src/main/mock/stream/sse-writer'
import { HISTORY_MASK } from '../../src/shared/credential-headers'
import { freePort, rawRead, serverDef, sseResponse, waitFor } from './mock-sse-fixtures'

const ID = 'name-rules-mock'
const TOKEN = 'Zq9xW2vB7nK4mL8pR3tY6uH1jG5fD0sA'
const AUTH = `Bearer ${TOKEN}`

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
  await mockServerManager.stopAll()
})

/** Every prefix of `secret` of at least `min` characters. */
function prefixes(secret: string, min = 4): string[] {
  const out: string[] = []
  for (let n = min; n <= secret.length; n++) out.push(secret.slice(0, n))
  return out
}

/**
 * An SSE body whose `{{request.headers.authorization}}` frames put the
 * TOKEN across byte `cut` of the written stream: one padding event, then
 * `frames` echo events.
 */
function straddlingBody(cut: number, frames: number): string {
  const echo = `data: ${AUTH}\n\n`
  const L = Buffer.byteLength(echo)
  // Land the cut in the middle of the token of one echo frame.
  const into = 'data: Bearer '.length + Math.floor(TOKEN.length / 2)
  const padFrame = 'data: \n\n'.length
  let k = Math.floor((cut - padFrame - into - 1) / L)
  let P = cut - padFrame - into - k * L
  while (P < 1) {
    k--
    P += L
  }
  const pad = `data: ${'p'.repeat(P)}`
  // Self-check: byte `cut` falls inside a token.
  const written = `${pad}\n\n` + echo.repeat(frames)
  const at = written.slice(0, cut)
  expect(at.endsWith(TOKEN.slice(0, Math.floor(TOKEN.length / 2)))).toBe(true)
  return [
    pad,
    ...Array.from({ length: frames }, () => 'data: {{request.headers.authorization}}'),
  ].join('\n\n')
}

describe('mock log: SSE frames are masked, then clipped (item 1)', () => {
  for (const [label, cut] of [
    ['the 16 KiB preview cut', SSE_LOG_PREVIEW_BYTES],
    ['the mask window cut', SSE_LOG_WINDOW_BYTES],
  ] as const) {
    it(`a token straddling ${label} leaves no prefix in the log`, async () => {
      const frames = Math.ceil(
        (SSE_LOG_WINDOW_BYTES * 1.5) / Buffer.byteLength(`data: ${AUTH}\n\n`),
      )
      const port = await freePort()
      const r = await mockServerManager.start(
        serverDef(ID, port, [
          { path: '/sse', response: sseResponse(straddlingBody(cut, frames), { intervalMs: 0 }) },
        ]),
      )
      expect(r.ok).toBe(true)
      const read = await rawRead(port, '/sse', { headers: { authorization: AUTH }, maxMs: 10_000 })
      // The client gets every frame with the real value.
      expect(read.text.split(TOKEN).length - 1).toBe(frames)
      expect(await waitFor(() => mockServerManager.getLogs(ID).length === 2, 5000)).toBe(true)
      const closed = mockServerManager.getLogs(ID)[1]
      expect(closed.response.headers['x-mock-stream']).toBe(`frames=${frames + 1};reason=completed`)
      const body = closed.response.body
      expect(body).toContain(`data: ${HISTORY_MASK}`)
      for (const p of prefixes(TOKEN)) expect(body).not.toContain(p)
      // Still a preview: at most the preview size, and it says it was cut.
      const preview = body.slice(0, body.indexOf('\n… (stream:'))
      expect(preview.length).toBeLessThanOrEqual(SSE_LOG_PREVIEW_BYTES + 2)
      expect(preview.endsWith('\n…')).toBe(true)
    })
  }
})

// ─── Item 2 ──────────────────────────────────────────────────────

const CLIENT_SECRET = 'cs-9f8e7d6c5b4a3210'
const FORM_PASSWORD = 'pw-Very-Secret-42'
const COOKIE = 'sid=ck-a1b2c3d4e5f6g7h8'
const UPSTREAM_TOKEN = 'xt-upstream-1234567'
const ACCESS_TOKEN = 'at-0123456789abcdef'
const REFRESH_TOKEN = 'rt-fedcba9876543210'

async function startUpstream(): Promise<number> {
  const port = await freePort()
  const upstream = http.createServer((_req, res) => {
    res.setHeader('set-cookie', [COOKIE, 'theme=dark'])
    res.setHeader('x-auth-token', UPSTREAM_TOKEN)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>((resolve) => upstream.listen(port, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())))
  return port
}

async function startMock(over: Parameters<typeof serverDef>[3] = {}): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(
    serverDef(
      ID,
      port,
      [
        { path: '/echo', response: { bodyType: 'json', body: '{"ok":true}' } },
        {
          path: '/token',
          response: {
            bodyType: 'json',
            body: JSON.stringify({
              access_token: ACCESS_TOKEN,
              refresh_token: REFRESH_TOKEN,
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          },
        },
      ],
      over,
    ),
  )
  expect(r.ok).toBe(true)
  return port
}

describe('mock log: name rules on bodies and response headers (item 2)', () => {
  it('a JSON request body: client_secret masked in the log', async () => {
    const port = await startMock()
    const r = await rawRead(port, '/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: 'app-1', client_secret: CLIENT_SECRET }),
    })
    expect(r.status).toBe(200)
    const [entry] = mockServerManager.getLogs(ID)
    expect(JSON.parse(entry.request.body)).toEqual({
      client_id: 'app-1',
      client_secret: HISTORY_MASK,
    })
    expect(JSON.stringify(entry)).not.toContain(CLIENT_SECRET)
  })

  it('a form request body: password masked, other fields kept', async () => {
    const port = await startMock()
    await rawRead(port, '/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=password&username=alice&password=${FORM_PASSWORD}`,
    })
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.request.body).toBe(`grant_type=password&username=alice&password=${HISTORY_MASK}`)
    expect(JSON.stringify(entry)).not.toContain(FORM_PASSWORD)
  })

  it('a proxied upstream Set-Cookie / X-Auth-Token: the client gets them, the log masks them', async () => {
    const up = await startUpstream()
    const port = await startMock({ proxyEnabled: true, proxyTarget: `http://127.0.0.1:${up}` })
    const r = await rawRead(port, '/not-mocked')
    expect(r.status).toBe(200)
    expect(String(r.headers['set-cookie'])).toContain(COOKIE)
    expect(r.headers['x-auth-token']).toBe(UPSTREAM_TOKEN)
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.response.headers['set-cookie']).toBe(HISTORY_MASK)
    expect(entry.response.headers['x-auth-token']).toBe(HISTORY_MASK)
    expect(entry.response.headers['content-type']).toBe('application/json')
    const all = JSON.stringify(entry)
    for (const s of [COOKIE, UPSTREAM_TOKEN, 'ck-a1b2c3d4e5f6g7h8']) expect(all).not.toContain(s)
  })

  it('a JSON response with access_token / refresh_token: served as written, logged masked', async () => {
    const port = await startMock()
    const r = await rawRead(port, '/token')
    expect(JSON.parse(r.text).access_token).toBe(ACCESS_TOKEN)
    const [entry] = mockServerManager.getLogs(ID)
    expect(JSON.parse(entry.response.body)).toEqual({
      access_token: HISTORY_MASK,
      refresh_token: HISTORY_MASK,
      token_type: 'Bearer',
      expires_in: 3600,
    })
    const all = JSON.stringify(entry)
    for (const s of [ACCESS_TOKEN, REFRESH_TOKEN]) expect(all).not.toContain(s)
  })
})
