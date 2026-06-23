/**
 * issue #25 regression — binary / document response bodies.
 *
 * The engine used to fetch with responseType:'text', which ran every byte
 * through UTF-8 decoding and corrupted images / PDFs / octet-stream payloads.
 * It now fetches arraybuffer and base64-encodes binary content types while
 * keeping text content types as plain UTF-8 strings (unchanged behaviour).
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

// A buffer with bytes that are NOT valid UTF-8 (0x89, 0xFF, 0x00) — exactly
// what UTF-8 decoding would have mangled. Mimics a PNG header.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x01])

let server: http.Server
let base: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/image') {
      res.setHeader('content-type', 'image/png')
      res.end(PNG_BYTES)
    } else if (req.url === '/pdf') {
      res.setHeader('content-type', 'application/pdf')
      res.end(PNG_BYTES) // bytes don't matter, only the content type branch
    } else {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, ünïcode: 'çğşöü' }))
    }
  })
  await new Promise<void>((r) => server.listen(0, r))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(() => server.close())

describe('http engine — binary response bodies (issue #25)', () => {
  it('returns an image body as base64 that round-trips to the original bytes', async () => {
    const res = await executeHttpRequest({ method: 'GET', url: `${base}/image` } as never)
    expect(res.bodyEncoding).toBe('base64')
    expect(res.bodySize).toBe(PNG_BYTES.length)
    expect(Buffer.from(res.body ?? '', 'base64')).toEqual(PNG_BYTES)
  })

  it('flags application/pdf as base64 binary', async () => {
    const res = await executeHttpRequest({ method: 'GET', url: `${base}/pdf` } as never)
    expect(res.bodyEncoding).toBe('base64')
  })

  it('keeps a JSON/text body as a plain UTF-8 string (no bodyEncoding)', async () => {
    const res = await executeHttpRequest({ method: 'GET', url: `${base}/json` } as never)
    expect(res.bodyEncoding).toBeUndefined()
    // Multi-byte UTF-8 characters survive intact, proving text decoding still works.
    expect(res.body).toContain('çğşöü')
    expect(JSON.parse(res.body ?? '{}')).toMatchObject({ ok: true })
  })
})
