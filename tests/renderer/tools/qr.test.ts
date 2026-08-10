import { describe, it, expect } from 'vitest'
import {
  encodeQrMatrix,
  encodeQrDataUrl,
  decodeImageData,
  type QrMatrix,
} from '../../../src/renderer/lib/tools/qr'

/**
 * Rasterise a QR module matrix into a clean RGBA ImageData with a quiet zone,
 * so we can round-trip through the real jsQR decoder without a DOM/canvas.
 */
function matrixToImageData(
  m: QrMatrix,
  cell = 8,
  quietModules = 4,
): { data: Uint8ClampedArray; width: number; height: number } {
  const dim = (m.size + quietModules * 2) * cell
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255) // opaque white
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.dark[r][c]) continue
      const x0 = (c + quietModules) * cell
      const y0 = (r + quietModules) * cell
      for (let y = y0; y < y0 + cell; y++) {
        for (let x = x0; x < x0 + cell; x++) {
          const i = (y * dim + x) * 4
          data[i] = 0
          data[i + 1] = 0
          data[i + 2] = 0
          // alpha stays 255
        }
      }
    }
  }
  return { data, width: dim, height: dim }
}

function roundTrip(text: string): string | null {
  const img = matrixToImageData(encodeQrMatrix(text))
  return decodeImageData(img.data, img.width, img.height)
}

describe('qr — encode → decode round-trip', () => {
  it.each([
    'HELLO',
    'https://www.testnizer.com/download',
    'otpauth://totp/ACME:alice@example.com?secret=GEZDGNBVGY3TQOJQ&issuer=ACME&algorithm=SHA256&digits=6&period=30',
    'Türkçe karakterler: şğüöçİ 1234',
  ])('decodes back the original text: %s', (text) => {
    expect(roundTrip(text)).toBe(text)
  })
})

describe('qr — encode helpers', () => {
  it('produces a growing square module matrix', () => {
    const m = encodeQrMatrix('hello world')
    expect(m.size).toBeGreaterThanOrEqual(21) // v1 is 21x21
    expect(m.dark).toHaveLength(m.size)
    expect(m.dark[0]).toHaveLength(m.size)
  })

  it('emits a data: image URL', () => {
    const url = encodeQrDataUrl('data-url test')
    expect(url.startsWith('data:image/')).toBe(true)
  })

  it('throws on empty input', () => {
    expect(() => encodeQrMatrix('')).toThrow(/Nothing to encode/)
  })
})

describe('qr — decode misses', () => {
  it('returns null when there is no QR in the pixels', () => {
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255)
    expect(decodeImageData(blank, 64, 64)).toBeNull()
  })
})
