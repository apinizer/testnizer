import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

/**
 * These tests validate that the multipart/form-data branch of the HTTP engine
 * streams file fields correctly and emits a proper Content-Type header with
 * boundary. We spin up a tiny local HTTP server that captures the raw request
 * body so we can inspect the multipart payload.
 */

interface CapturedRequest {
  contentType: string
  body: string
}

let server: Server
let port = 0
let captured: CapturedRequest | null = null

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          captured = {
            contentType: String(req.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks).toString('utf8'),
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') port = addr.port
        resolve()
      })
    }),
)

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
    }),
)

describe('http.engine — multipart/form-data file upload', () => {
  it('streams a file field with proper Content-Type boundary and filename', async () => {
    const tmpFile = join(tmpdir(), `testnizer-upload-${Date.now()}.txt`)
    writeFileSync(tmpFile, 'hello-from-disk', 'utf-8')

    try {
      const result = await executeHttpRequest({
        method: 'POST',
        url: `http://127.0.0.1:${port}/upload`,
        body: {
          type: 'form-data',
          formData: [
            { id: '1', key: 'note', value: 'a note', enabled: true, type: 'text' },
            {
              id: '2',
              key: 'attachment',
              value: 'whatever-display.txt',
              enabled: true,
              type: 'file',
              filePath: tmpFile,
            },
          ],
        },
      })

      expect(result.status).toBe(200)
      expect(captured).not.toBeNull()
      // Boundary must be present and Content-Type must include it.
      expect(captured!.contentType).toMatch(/^multipart\/form-data; boundary=/)
      // Text field appears with its key.
      expect(captured!.body).toContain('name="note"')
      expect(captured!.body).toContain('a note')
      // File field — basename, not display value.
      expect(captured!.body).toContain('name="attachment"')
      expect(captured!.body).toMatch(/filename="testnizer-upload-\d+\.txt"/)
      expect(captured!.body).toContain('hello-from-disk')
      // Display value 'whatever-display.txt' must NOT leak as filename.
      expect(captured!.body).not.toContain('whatever-display.txt')
    } finally {
      try {
        unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
    }
  })

  it('skips file fields whose path does not exist (no crash)', async () => {
    captured = null
    const result = await executeHttpRequest({
      method: 'POST',
      url: `http://127.0.0.1:${port}/upload`,
      body: {
        type: 'form-data',
        formData: [
          { id: '1', key: 'k', value: 'v', enabled: true, type: 'text' },
          {
            id: '2',
            key: 'missing',
            value: 'gone.bin',
            enabled: true,
            type: 'file',
            filePath: '/this/path/does/not/exist/abc.bin',
          },
        ],
      },
    })
    expect(result.status).toBe(200)
    expect(captured!.body).toContain('name="k"')
    expect(captured!.body).not.toContain('name="missing"')
  })

  it('treats undefined type as text (backwards compatibility)', async () => {
    captured = null
    const result = await executeHttpRequest({
      method: 'POST',
      url: `http://127.0.0.1:${port}/upload`,
      body: {
        type: 'form-data',
        // No `type` field — older saved requests must still work.
        formData: [
          { id: '1', key: 'foo', value: 'bar', enabled: true },
        ],
      },
    })
    expect(result.status).toBe(200)
    expect(captured!.contentType).toMatch(/^multipart\/form-data/)
    expect(captured!.body).toContain('name="foo"')
    expect(captured!.body).toContain('bar')
  })

  it('skips disabled rows', async () => {
    captured = null
    const result = await executeHttpRequest({
      method: 'POST',
      url: `http://127.0.0.1:${port}/upload`,
      body: {
        type: 'form-data',
        formData: [
          { id: '1', key: 'on', value: 'yes', enabled: true, type: 'text' },
          { id: '2', key: 'off', value: 'no', enabled: false, type: 'text' },
        ],
      },
    })
    expect(result.status).toBe(200)
    expect(captured!.body).toContain('name="on"')
    expect(captured!.body).not.toContain('name="off"')
  })

  it('puts a readable summary in actualRequest.body for multipart uploads', async () => {
    const tmpFile = join(tmpdir(), `testnizer-summary-${Date.now()}.bin`)
    writeFileSync(tmpFile, 'x')
    try {
      const result = await executeHttpRequest({
        method: 'POST',
        url: `http://127.0.0.1:${port}/upload`,
        body: {
          type: 'form-data',
          formData: [
            { id: '1', key: 'name', value: 'demo', enabled: true, type: 'text' },
            {
              id: '2',
              key: 'file',
              value: '',
              enabled: true,
              type: 'file',
              filePath: tmpFile,
            },
          ],
        },
      })
      expect(result.actualRequest?.body ?? '').toContain('name: demo')
      expect(result.actualRequest?.body ?? '').toMatch(/file: <file testnizer-summary-\d+\.bin>/)
    } finally {
      try {
        unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
    }
  })
})
