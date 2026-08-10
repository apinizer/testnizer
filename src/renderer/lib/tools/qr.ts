/**
 * QR code encode/decode — pure, offline, renderer-only.
 *
 *  - Encoding uses `qrcode-generator` (pure CJS, no deps): text → module matrix
 *    or a `data:` image URL.
 *  - Decoding uses `jsqr`: raw RGBA `ImageData` → text. `decodeQrFromFile`
 *    wraps a `<canvas>` so an uploaded image file can be decoded entirely in
 *    the browser — no network, the image never leaves the machine (CSP already
 *    permits `img-src data: blob:`).
 *
 * The matrix/`ImageData` helpers are DOM-free so they can be unit-tested in the
 * node `|tools|` vitest project; only `decodeQrFromFile` touches the DOM.
 */

import qrcode from 'qrcode-generator'
import jsQR from 'jsqr'

export type QrEcLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrMatrix {
  size: number
  dark: boolean[][]
}

/** Text → UTF-8 bytes as a "binary string" (one char per byte). Forcing Byte
 *  mode over these bytes is what makes non-ASCII (e.g. Turkish) round-trip. */
function toByteString(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

function makeQr(text: string, ecLevel: QrEcLevel): ReturnType<typeof qrcode> {
  if (!text) throw new Error('Nothing to encode.')
  const qr = qrcode(0, ecLevel) // typeNumber 0 = auto-detect the smallest fit
  // Force Byte mode over UTF-8 bytes (the @types omit the mode arg).
  ;(qr.addData as (data: string, mode?: string) => void)(toByteString(text), 'Byte')
  try {
    qr.make()
  } catch {
    throw new Error('Text is too long to encode as a single QR code.')
  }
  return qr
}

/** Encode to a boolean module matrix (DOM-free — the testable core). */
export function encodeQrMatrix(text: string, ecLevel: QrEcLevel = 'M'): QrMatrix {
  const qr = makeQr(text, ecLevel)
  const size = qr.getModuleCount()
  const dark: boolean[][] = []
  for (let r = 0; r < size; r++) {
    const row: boolean[] = []
    for (let c = 0; c < size; c++) row.push(qr.isDark(r, c))
    dark.push(row)
  }
  return { size, dark }
}

/** Encode to a `data:image/gif` URL suitable for an `<img>` tag / download. */
export function encodeQrDataUrl(
  text: string,
  opts: { cellSize?: number; ecLevel?: QrEcLevel } = {},
): string {
  const qr = makeQr(text, opts.ecLevel ?? 'M')
  return qr.createDataURL(opts.cellSize ?? 6)
}

/** Decode raw RGBA pixels (DOM-free — the testable core). */
export function decodeImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const result = jsQR(data, width, height)
  if (!result) return null
  // Decode the raw bytes as UTF-8 (symmetric with the Byte-mode encode above).
  return new TextDecoder().decode(Uint8Array.from(result.binaryData))
}

/** Decode an uploaded image File to text (renderer/DOM). Throws if none found. */
export async function decodeQrFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available.')
    ctx.drawImage(bitmap, 0, 0)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const decoded = decodeImageData(img.data, img.width, img.height)
    if (!decoded) throw new Error('No QR code found in the image.')
    return decoded
  } finally {
    bitmap.close()
  }
}
