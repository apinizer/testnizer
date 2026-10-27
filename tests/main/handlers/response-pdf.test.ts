/**
 * Issue #294 — a PDF response opens in the system viewer instead of an
 * unsandboxed iframe. The renderer sends bytes only; main validates them,
 * names the file itself and keeps it in a private per-session temp folder.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-pdf-test-'))
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const openPath = vi.fn(async (_p: string) => '')

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'temp' ? TEMP_ROOT : TEMP_ROOT) },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
  shell: { openPath: (p: string) => openPath(p) },
}))

import {
  cleanupOpenedPdfs,
  hasPdfSignature,
  registerResponsePdfHandlers,
  writeResponsePdf,
} from '../../../src/main/ipc/response-pdf.handler'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n', 'latin1')
const b64 = (b: Buffer): string => b.toString('base64')

type Result = { success: boolean; data?: unknown; error?: string }
const invoke = (arg: unknown): Promise<Result> =>
  handlers.get('response:openPdf')!({}, arg) as Promise<Result>

beforeEach(() => {
  openPath.mockClear()
  openPath.mockImplementation(async () => '')
})

afterAll(() => {
  cleanupOpenedPdfs()
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
})

registerResponsePdfHandlers()

describe('hasPdfSignature', () => {
  it('accepts %PDF- at the start or within the first 1024 bytes', () => {
    expect(hasPdfSignature(PDF)).toBe(true)
    expect(hasPdfSignature(Buffer.concat([Buffer.from('﻿  \n'), PDF]))).toBe(true)
  })
  it('rejects anything else', () => {
    expect(hasPdfSignature(Buffer.from('<html><script>alert(1)</script>'))).toBe(false)
    expect(hasPdfSignature(Buffer.concat([Buffer.alloc(1024, 0x20), PDF]))).toBe(false)
    expect(hasPdfSignature(Buffer.alloc(0))).toBe(false)
  })
})

describe('response:openPdf', () => {
  it('writes the bytes to a private .pdf and opens it with the OS viewer', async () => {
    const r = await invoke(b64(PDF))
    expect(r).toEqual({ success: true, data: null })
    expect(openPath).toHaveBeenCalledTimes(1)
    const file = openPath.mock.calls[0][0]
    expect(path.extname(file)).toBe('.pdf')
    expect(path.dirname(path.dirname(file))).toBe(TEMP_ROOT)
    expect(fs.readFileSync(file).equals(PDF)).toBe(true)
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
    }
  })

  it('uses a new file per open (a viewer may still hold the previous one)', async () => {
    await invoke(b64(PDF))
    await invoke(b64(PDF))
    const [a, b] = openPath.mock.calls.map((c) => c[0])
    expect(a).not.toBe(b)
  })

  it('refuses a body that is not a PDF and opens nothing', async () => {
    const r = await invoke(b64(Buffer.from('<html>not a pdf</html>')))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not a PDF/i)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('refuses non-string / empty input', async () => {
    for (const bad of [undefined, null, 42, { path: '/etc/passwd' }, '']) {
      const r = await invoke(bad)
      expect(r.success).toBe(false)
    }
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports the OS error when the viewer cannot open the file', async () => {
    openPath.mockImplementation(async () => 'No application knows how to open this file')
    const r = await invoke(b64(PDF))
    expect(r).toEqual({ success: false, error: 'No application knows how to open this file' })
  })

  it('refuses a body over the size cap and writes nothing', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(4096, 0x20)])
    expect(() => writeResponsePdf(b64(big), 1024)).toThrow(/too large/)
    expect(() => writeResponsePdf(b64(PDF), 1024)).not.toThrow()
  })

  it('cleanupOpenedPdfs removes the session folder', async () => {
    await invoke(b64(PDF))
    const dir = path.dirname(openPath.mock.calls[0][0])
    expect(fs.existsSync(dir)).toBe(true)
    cleanupOpenedPdfs()
    expect(fs.existsSync(dir)).toBe(false)
  })
})
