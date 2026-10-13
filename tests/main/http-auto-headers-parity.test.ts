/**
 * Issue #204 — the Headers tab's auto-generated preview (`computeAutoHeaders`)
 * must describe what the real engine (`executeHttpRequest`) puts on the wire.
 * A local server captures the raw inbound headers; for every request the
 * preview's sent rows and the wire header set must match by name, and every
 * value the preview states (anything not "calculated at send" or masked) must
 * be byte-identical to the wire value.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeHttpRequest, type HttpRequestOptions } from '../../src/main/protocols/http.engine'
import { getDefaultUserAgent } from '../../src/main/lib/user-agent'
import {
  computeAutoHeaders,
  SEND_TIME_TOKEN,
  type AutoHeaderInput,
  type AutoHeaderRow,
} from '../../src/shared/http-auto-headers'
import { HISTORY_MASK } from '../../src/shared/credential-headers'

let server: Server
let port = 0
let lastRaw: string[] = []

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        lastRaw = req.rawHeaders
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        })
      })
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** Wire headers as lowercase name → value (raw order, last wins). */
function wire(): Map<string, string> {
  const m = new Map<string, string>()
  for (let i = 0; i < lastRaw.length; i += 2) m.set(lastRaw[i].toLowerCase(), lastRaw[i + 1])
  return m
}

/** The version the engine's default User-Agent was built from. */
const appVersion = getDefaultUserAgent().replace(/^Testnizer\//, '')

async function sendAndPreview(
  opts: Omit<HttpRequestOptions, 'url' | 'timeout'>,
): Promise<{ onWire: Map<string, string>; preview: AutoHeaderRow[] }> {
  const url = `http://127.0.0.1:${port}/echo`
  const res = await executeHttpRequest({ ...opts, url, timeout: 5000 })
  expect(res.error).toBeUndefined()
  const preview = computeAutoHeaders({
    method: opts.method,
    url,
    headers: opts.headers,
    body: opts.body,
    auth: (opts.auth ?? null) as AutoHeaderInput['auth'],
    appVersion,
  })
  return { onWire: wire(), preview }
}

/**
 * The drift check: wire header names == preview sent rows ∪ user rows, and
 * every concrete preview value equals the wire value. Cookie is excluded (the
 * jar is empty in this suite, so the conditional row is not sent).
 */
function expectConsistent(
  onWire: Map<string, string>,
  preview: AutoHeaderRow[],
  userHeaders: string[] = [],
): void {
  const sent = preview.filter((r) => !r.overriddenByUser && r.source !== 'cookie')
  const expectedNames = new Set([
    ...sent.map((r) => r.name.toLowerCase()),
    ...userHeaders.map((h) => h.toLowerCase()),
  ])
  expect([...onWire.keys()].sort()).toEqual([...expectedNames].sort())
  for (const r of sent) {
    if (r.sendTime || r.value.includes(SEND_TIME_TOKEN) || r.value.includes(HISTORY_MASK)) continue
    expect({ name: r.name, value: onWire.get(r.name.toLowerCase()) }).toEqual({
      name: r.name,
      value: r.value,
    })
  }
}

describe('auto-header preview ≡ engine wire (issue #204)', () => {
  it('POST JSON + Bearer: same Content-Type, User-Agent, Accept, Host; Authorization present', async () => {
    const { onWire, preview } = await sendAndPreview({
      method: 'POST',
      body: { type: 'json', content: '{"a":1}' },
      auth: { type: 'bearer', bearer: { token: 'tok-0123456789' } },
    })
    const p = (n: string): string | undefined => preview.find((r) => r.name === n)?.value
    expect(onWire.get('content-type')).toBe(p('Content-Type'))
    expect(onWire.get('content-type')).toBe('application/json')
    expect(onWire.get('user-agent')).toBe(p('User-Agent'))
    expect(onWire.get('accept')).toBe(p('Accept'))
    expect(onWire.get('accept-encoding')).toBe(p('Accept-Encoding'))
    expect(onWire.get('host')).toBe(p('Host'))
    expect(onWire.get('connection')).toBe(p('Connection'))
    expect(onWire.get('authorization')).toBe('Bearer tok-0123456789')
    // The preview names the scheme but never the token.
    expect(p('Authorization')).toBe(`Bearer ${HISTORY_MASK}`)
    expect(onWire.get('content-length')).toBe('7')
    expectConsistent(onWire, preview)
  })

  it.each([
    ['GET', { type: 'none' }],
    ['POST', { type: 'none' }],
    ['DELETE', { type: 'none' }],
    ['PUT', { type: 'xml', content: '<a/>' }],
    ['PATCH', { type: 'text', content: 'hi' }],
    ['POST', { type: 'html', content: '<p/>' }],
    ['POST', { type: 'javascript', content: '1' }],
    ['GET', { type: 'json', content: '{}' }],
  ] as const)('%s %o', async (method, body) => {
    const { onWire, preview } = await sendAndPreview({ method, body: { ...body } })
    expectConsistent(onWire, preview)
  })

  it('urlencoded body', async () => {
    const { onWire, preview } = await sendAndPreview({
      method: 'POST',
      body: { type: 'urlencoded', urlEncoded: [{ id: '1', key: 'a', value: '1', enabled: true }] },
    })
    expectConsistent(onWire, preview)
  })

  it('form-data: boundary-bearing Content-Type replaces a user one', async () => {
    const headers = [{ id: 'h', key: 'Content-Type', value: 'multipart/form-data', enabled: true }]
    const { onWire, preview } = await sendAndPreview({
      method: 'POST',
      headers,
      body: { type: 'form-data', formData: [{ id: '1', key: 'a', value: '1', enabled: true }] },
    })
    expect(onWire.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    expect(preview.find((r) => r.name === 'Content-Type')?.overriddenByUser).toBeUndefined()
    expectConsistent(onWire, preview)
  })

  it('binary body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auto-headers-'))
    try {
      const file = join(dir, 'a.bin')
      writeFileSync(file, Buffer.from([1, 2, 3]))
      const { onWire, preview } = await sendAndPreview({
        method: 'POST',
        body: { type: 'binary', binaryPath: file },
      })
      expect(onWire.get('content-type')).toBe('application/octet-stream')
      expectConsistent(onWire, preview)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('api-key header + user overrides of Accept and User-Agent', async () => {
    const headers = [
      { id: '1', key: 'accept', value: 'text/xml', enabled: true },
      { id: '2', key: 'User-Agent', value: 'mine/1', enabled: true },
    ]
    const { onWire, preview } = await sendAndPreview({
      method: 'GET',
      headers,
      auth: { type: 'api-key', apiKey: { key: 'X-Api-Key', value: 'k-0123456789', in: 'header' } },
    })
    expect(onWire.get('accept')).toBe('text/xml')
    expect(onWire.get('user-agent')).toBe('mine/1')
    expect(onWire.get('x-api-key')).toBe('k-0123456789')
    expect(preview.find((r) => r.name === 'X-Api-Key')?.value).toBe(HISTORY_MASK)
    expectConsistent(onWire, preview, ['accept', 'User-Agent'])
  })

  it.each(['content-type', 'CONTENT-TYPE', 'Content-Type'])(
    'a user `%s` header wins over the body default (preview marks it overridden)',
    async (key) => {
      const headers = [{ id: '1', key, value: 'text/csv', enabled: true }]
      const { onWire, preview } = await sendAndPreview({
        method: 'POST',
        headers,
        body: { type: 'json', content: '{}' },
      })
      expect(onWire.get('content-type')).toBe('text/csv')
      expect(
        lastRaw.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'content-type'),
      ).toHaveLength(1)
      expect(preview.find((r) => r.name === 'Content-Type')?.overriddenByUser).toBe(true)
      expectConsistent(onWire, preview, [key])
    },
  )

  it('a lowercase user content-type also suppresses the axios form default on a body-less POST', async () => {
    const headers = [{ id: '1', key: 'content-type', value: 'text/csv', enabled: true }]
    const { onWire, preview } = await sendAndPreview({
      method: 'POST',
      headers,
      body: { type: 'none' },
    })
    expect(onWire.get('content-type')).toBe('text/csv')
    expect(preview.find((r) => r.name === 'Content-Type')?.overriddenByUser).toBe(true)
    expectConsistent(onWire, preview, ['content-type'])
  })
})
