/**
 * Issue #215 — the hosted Everything MCP server's get-tiny-image /
 * get-annotated-message image showed "Image could not be displayed · 3017
 * bytes" and the downloaded file would not open. Root cause is the server: its
 * base64 (captured from the wire, `tests/fixtures/mcp/everything-images.ts`)
 * decodes to a PNG that breaks inside its iCCP chunk and has no IEND.
 * Testnizer now says so ("The server sent incomplete image data") and the
 * Download button writes exactly the decoded `data` field ("as received").
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpResultView from '../../src/renderer/components/protocols/mcp/McpResultView'
import {
  base64ToBytes,
  inspectImageData,
} from '../../src/renderer/components/protocols/mcp/mcp-content'
import { EVERYTHING_TINY_IMAGE_WIRE, VALID_PNG_1X1 } from '../fixtures/mcp/everything-images'

afterEach(cleanup)

function nodeDecode(b64: string): Buffer {
  return Buffer.from(b64, 'base64')
}

/** jsdom's Blob has no arrayBuffer(); FileReader reads it. */
function blobBytes(blob: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

describe('inspectImageData (issue #215)', () => {
  it('the Everything server PNG is incomplete; a valid PNG is complete', () => {
    expect(inspectImageData(EVERYTHING_TINY_IMAGE_WIRE, 'image/png')).toBe('incomplete')
    expect(inspectImageData(VALID_PNG_1X1, 'image/png')).toBe('complete')
  })

  it('a valid PNG cut anywhere before IEND is incomplete', () => {
    const full = nodeDecode(VALID_PNG_1X1)
    for (const len of [8, 20, 33, full.length - 1]) {
      const cut = full.subarray(0, len).toString('base64')
      expect(inspectImageData(cut, 'image/png')).toBe('incomplete')
    }
  })

  it('JPEG EOI, GIF trailer and WebP RIFF size are checked; other formats are not judged', () => {
    const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64')
    expect(inspectImageData(b64([0xff, 0xd8, 0x00, 0xff, 0xd9]), 'image/jpeg')).toBe('complete')
    expect(inspectImageData(b64([0xff, 0xd8, 0x00, 0x00]), 'image/jpeg')).toBe('incomplete')
    const gif = [...Buffer.from('GIF89a'), 0x00, 0x3b]
    expect(inspectImageData(b64(gif), 'image/gif')).toBe('complete')
    expect(inspectImageData(b64(gif.slice(0, -1)), 'image/gif')).toBe('incomplete')
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([8, 0, 0, 0]),
      Buffer.from('WEBPVP8 '),
    ])
    expect(inspectImageData(webp.toString('base64'), 'image/webp')).toBe('complete')
    expect(inspectImageData(webp.subarray(0, 14).toString('base64'), 'image/webp')).toBe(
      'incomplete',
    )
    expect(inspectImageData('AAAA', 'image/svg+xml')).toBe('unchecked')
    expect(inspectImageData('not base64 !!', 'image/png')).toBe('incomplete')
  })

  it('decodes byte for byte like Node (no truncation in the decoder)', () => {
    expect(Buffer.from(base64ToBytes(EVERYTHING_TINY_IMAGE_WIRE)!)).toEqual(
      nodeDecode(EVERYTHING_TINY_IMAGE_WIRE),
    )
    expect(base64ToBytes(EVERYTHING_TINY_IMAGE_WIRE)!.length).toBe(3017)
  })
})

describe('result view with the Everything server image (issue #215)', () => {
  it('explains that the server sent incomplete data and downloads exactly what was received', async () => {
    let blob: Blob | null = null
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b
      return 'blob:mcp-img'
    })
    URL.revokeObjectURL = vi.fn()
    try {
      render(
        <McpResultView
          result={{
            content: [
              { type: 'text', text: 'Operation completed successfully' },
              { type: 'image', data: EVERYTHING_TINY_IMAGE_WIRE, mimeType: 'image/png' },
            ],
          }}
        />,
      )
      fireEvent.error(screen.getByTestId('mcp-block-image'))
      const fallback = screen.getByTestId('mcp-image-fallback')
      expect(fallback).toHaveAttribute('data-incomplete', 'true')
      expect(fallback).toHaveTextContent(
        'The server sent incomplete image data · 3017 bytes · image/png ends before its end marker',
      )
      fireEvent.click(within(fallback).getByTestId('mcp-image-download'))
      expect(blob).not.toBeNull()
      const written = await blobBytes(blob!)
      expect(written.length).toBe(3017)
      expect(written.equals(nodeDecode(EVERYTHING_TINY_IMAGE_WIRE))).toBe(true)
      expect(blob!.type).toBe('image/png')
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('a format Testnizer does not check keeps the neutral "could not be displayed" text', () => {
    render(
      <McpResultView
        result={{ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/avif' }] }}
      />,
    )
    fireEvent.error(screen.getByTestId('mcp-block-image'))
    const fallback = screen.getByTestId('mcp-image-fallback')
    expect(fallback).not.toHaveAttribute('data-incomplete')
    expect(fallback).toHaveTextContent('Image could not be displayed · 3 bytes · image/avif')
  })
})
