/**
 * CopyButton — the contract that closes "Copy butonu geri bildirimi yok".
 *
 * Two guarantees, both of which the old private copies broke:
 *
 *  1. A copy is visible. Every call site used to swallow the promise, so a click
 *     produced no change at all — on a panel whose own caption says "click any
 *     to copy".
 *  2. A copy is NAMED. `ariaLabel` is a required prop, so the five buttons in a
 *     single JWT panel (whose accessible name was the glyph "⧉") and the private
 *     JWK button (labelled a generic "Copy") each say what they put on the
 *     clipboard.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import CopyButton from '../../../src/renderer/components/shared/CopyButton'

;(globalThis as unknown as { React: typeof React }).React = React

const errorToast = vi.fn()
vi.mock('../../../src/renderer/lib/toast', () => ({
  toast: {
    error: (m: string) => errorToast(m),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  errorToast.mockClear()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CopyButton', () => {
  it('writes the text to the clipboard', async () => {
    render(<CopyButton text="secret-value" ariaLabel="Copy PEM" />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('secret-value'))
  })

  it('shows a visible confirmation after copying', async () => {
    render(<CopyButton text="x" ariaLabel="Copy PEM" />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('⧉')
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toHaveTextContent('✓'))
  })

  it('reports a rejected clipboard instead of swallowing it', async () => {
    writeText.mockRejectedValue(new Error('Document is not focused'))
    render(<CopyButton text="x" ariaLabel="Copy PEM" />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1))
    expect(errorToast.mock.calls[0][0]).toContain('Document is not focused')
    // …and it must NOT claim success.
    expect(screen.getByRole('button')).toHaveTextContent('⧉')
  })

  it('does nothing for empty text', () => {
    render(<CopyButton text="" ariaLabel="Copy PEM" />)
    fireEvent.click(screen.getByRole('button'))
    expect(writeText).not.toHaveBeenCalled()
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('exposes the accessible name the call site supplied', () => {
    render(
      <>
        <CopyButton text="a" ariaLabel="Copy left side" />
        <CopyButton text="b" ariaLabel="Copy right side" />
      </>,
    )
    // The point of the required prop: two copy buttons on one screen are
    // distinguishable instead of both reading "Copy".
    expect(screen.getByLabelText('Copy left side')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy right side')).toBeInTheDocument()
  })

  it('renders a visible label when one is given', () => {
    render(<CopyButton text="a" label="Copy public JWKS" ariaLabel="Copy public JWKS" />)
    expect(screen.getByRole('button')).toHaveTextContent('Copy public JWKS')
  })
})
