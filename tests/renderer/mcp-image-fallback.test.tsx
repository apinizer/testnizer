/**
 * Issue #209 — an MCP image the browser cannot decode (the hosted
 * server-everything's truncated PNG) showed only a broken-image icon. On
 * `error` the view now shows "Image could not be displayed · N bytes · mime"
 * plus a Download button; a valid image keeps rendering inline. jsdom never
 * decodes images, so the decode failure is simulated with `fireEvent.error`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpResultView from '../../src/renderer/components/protocols/mcp/McpResultView'
import { imageFileName } from '../../src/renderer/components/protocols/mcp/mcp-content'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'

// 8 decoded bytes; the bytes themselves do not matter to jsdom.
const BROKEN_PNG = 'iVBORw0KGgo='

afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})

describe('McpContentBlockView image block (issue #209)', () => {
  it('a valid image renders inline with no fallback', () => {
    render(
      <McpResultView
        result={{ content: [{ type: 'image', data: BROKEN_PNG, mimeType: 'image/png' }] }}
      />,
    )
    expect(screen.getByTestId('mcp-block-image')).toHaveAttribute(
      'src',
      `data:image/png;base64,${BROKEN_PNG}`,
    )
    expect(screen.queryByTestId('mcp-image-fallback')).toBeNull()
  })

  it('a decode error swaps the broken icon for size + mime and a Download button', () => {
    const create = vi.fn(() => 'blob:mcp-img')
    const revoke = vi.fn()
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    try {
      render(
        <McpResultView
          result={{ content: [{ type: 'image', data: BROKEN_PNG, mimeType: 'image/png' }] }}
        />,
      )
      fireEvent.error(screen.getByTestId('mcp-block-image'))
      expect(screen.queryByTestId('mcp-block-image')).toBeNull()
      const fallback = screen.getByTestId('mcp-image-fallback')
      // 8 bytes = a bare PNG signature: no IEND → "incomplete" (issue #215).
      expect(fallback).toHaveTextContent(
        'The server sent incomplete image data · 8 bytes · image/png ends before its end marker',
      )
      const download = within(fallback).getByTestId('mcp-image-download')
      expect(download).toHaveTextContent('Download as received')
      fireEvent.click(download)
      expect(create).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('Turkish fallback text', () => {
    // Components read the locale from the UI store (`useTranslation`).
    useUIStore.setState({ locale: 'tr' })
    render(
      <McpResultView
        result={{ content: [{ type: 'image', data: BROKEN_PNG, mimeType: 'image/png' }] }}
      />,
    )
    fireEvent.error(screen.getByTestId('mcp-block-image'))
    expect(screen.getByTestId('mcp-image-fallback')).toHaveTextContent(
      'Sunucu eksik görsel verisi gönderdi · 8 bayt · image/png bitiş işaretinden önce kesiliyor',
    )
    expect(screen.getByTestId('mcp-image-download')).toHaveTextContent('Geldiği gibi indir')
  })

  it('a new image after a failed one renders inline again', () => {
    const { rerender } = render(
      <McpResultView
        result={{ content: [{ type: 'image', data: BROKEN_PNG, mimeType: 'image/png' }] }}
      />,
    )
    fireEvent.error(screen.getByTestId('mcp-block-image'))
    expect(screen.getByTestId('mcp-image-fallback')).toBeInTheDocument()
    rerender(
      <McpResultView
        result={{ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/gif' }] }}
      />,
    )
    expect(screen.getByTestId('mcp-block-image')).toHaveAttribute(
      'src',
      'data:image/gif;base64,AAAA',
    )
    expect(screen.queryByTestId('mcp-image-fallback')).toBeNull()
  })
})

describe('embedded resource image (issue #209)', () => {
  const result = {
    content: [
      {
        type: 'resource',
        resource: { uri: 'test://pic.png', mimeType: 'image/png', blob: BROKEN_PNG },
      },
    ],
  }

  it('a valid resource image renders inline', () => {
    render(<McpResultView result={result} />)
    const res = screen.getByTestId('mcp-block-resource')
    expect(within(res).getByTestId('mcp-resource-image')).toHaveAttribute(
      'src',
      `data:image/png;base64,${BROKEN_PNG}`,
    )
    expect(within(res).queryByTestId('mcp-image-fallback')).toBeNull()
  })

  it('a decode error shows the fallback; the existing Download row stays (one button)', () => {
    render(<McpResultView result={result} />)
    const res = screen.getByTestId('mcp-block-resource')
    fireEvent.error(within(res).getByTestId('mcp-resource-image'))
    expect(within(res).queryByTestId('mcp-resource-image')).toBeNull()
    expect(within(res).getByTestId('mcp-image-fallback')).toHaveTextContent(
      'The server sent incomplete image data · 8 bytes · image/png',
    )
    expect(within(res).getAllByRole('button', { name: /Download/ })).toHaveLength(1)
    expect(within(res).getByTestId('mcp-resource-download')).toBeInTheDocument()
  })
})

/**
 * Issue #209 follow-up — a VALID 20×20 PNG (server-everything get-tiny-image)
 * was stretched to the full result width and blurred: the <img> sat in a
 * flex column (align-items: stretch) with only max-w/max-h set. Images now
 * keep their intrinsic size and are only scaled DOWN. jsdom cannot lay out,
 * so the contract is pinned on the classes that implement it.
 */
describe('image sizing (issue #209)', () => {
  const SIZING = ['self-start', 'w-auto', 'h-auto', 'max-w-full', 'object-contain']

  it('a content-block image keeps its intrinsic size (never stretched)', () => {
    render(
      <McpResultView
        result={{ content: [{ type: 'image', data: BROKEN_PNG, mimeType: 'image/png' }] }}
      />,
    )
    const img = screen.getByTestId('mcp-block-image')
    for (const c of SIZING) expect(img).toHaveClass(c)
    expect(img).not.toHaveClass('w-full')
  })

  it('an embedded resource image keeps its intrinsic size too', () => {
    render(
      <McpResultView
        result={{
          content: [
            {
              type: 'resource',
              resource: { uri: 'test://pic.png', mimeType: 'image/png', blob: BROKEN_PNG },
            },
          ],
        }}
      />,
    )
    const img = screen.getByTestId('mcp-resource-image')
    for (const c of SIZING) expect(img).toHaveClass(c)
  })
})

describe('imageFileName', () => {
  it('derives a safe extension from the mime type', () => {
    expect(imageFileName('image/png')).toBe('image.png')
    expect(imageFileName('image/svg+xml')).toBe('image.svg')
    expect(imageFileName('image/../x')).toBe('image.bin')
    expect(imageFileName('')).toBe('image.bin')
  })
})
