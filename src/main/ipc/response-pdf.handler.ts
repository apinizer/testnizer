/**
 * Open a PDF response body in the system PDF viewer (issue #294).
 *
 * The response viewer used to render `application/pdf` bodies in an iframe
 * inside the app's own document. Chromium refuses to run its PDF viewer in a
 * `sandbox`ed iframe (every sandbox flag combination ends in
 * `chrome-error://chromewebdata/`), so an untrusted PDF could only be shown
 * inline in an UNsandboxed frame. Instead the renderer hands the bytes here and
 * the OS opens them, the way a browser opens a downloaded PDF.
 *
 * The renderer sends BYTES only — never a path, name or extension — so it cannot
 * steer what gets opened: main checks the PDF signature, picks the file name
 * itself (always `.pdf`) and writes it into a private per-session temp folder
 * (0700 dir, 0600 file) that is removed when the app quits.
 */
import { app, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** A PDF response larger than this is refused (Download still works). */
export const MAX_PDF_BYTES = 200 * 1024 * 1024

/**
 * True when `bytes` carries a PDF signature. Readers accept `%PDF-` anywhere in
 * the first 1024 bytes (servers sometimes prepend a BOM or whitespace), and so
 * do we — nothing else gets a `.pdf` handed to the OS.
 */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024))
  return head.indexOf('%PDF-', 0, 'latin1') !== -1
}

let sessionDir: string | null = null
let counter = 0

function ensureSessionDir(): string {
  if (sessionDir && fs.existsSync(sessionDir)) return sessionDir
  // mkdtemp creates the directory 0700 — only this user can list or read it.
  sessionDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'testnizer-pdf-'))
  return sessionDir
}

/** Remove every PDF this session opened. Called on `will-quit`; never throws. */
export function cleanupOpenedPdfs(): void {
  if (!sessionDir) return
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  } catch {
    // A viewer may still hold the file open (Windows) — the OS temp cleaner
    // gets it later.
  }
  sessionDir = null
}

/** Decode, validate and write the body; returns the written path. */
export function writeResponsePdf(base64: unknown, maxBytes: number = MAX_PDF_BYTES): string {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new Error('No PDF body to open')
  }
  // Rough pre-decode bound so a huge string is refused before allocating.
  if (Math.floor((base64.length * 3) / 4) > maxBytes + 3) {
    throw new Error('PDF is too large to open; use Download instead')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength > maxBytes) {
    throw new Error('PDF is too large to open; use Download instead')
  }
  if (!hasPdfSignature(bytes)) {
    throw new Error('The response body is not a PDF')
  }
  const dir = ensureSessionDir()
  // A new name per open: a viewer may still have the previous one open.
  counter += 1
  const file = path.join(dir, `response-${counter}.pdf`)
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' })
  return file
}

export function registerResponsePdfHandlers(): void {
  ipcMain.handle('response:openPdf', async (_event, base64: unknown) => {
    try {
      const file = writeResponsePdf(base64)
      // shell.openPath resolves to an error message, '' on success.
      const err = await shell.openPath(file)
      if (err) return { success: false, error: err }
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
