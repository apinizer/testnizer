/**
 * Security → Password Generator, driven through the UI.
 *
 * The pure generator has always had tests; what it lacked was anything covering
 * the FORM, which is where every tester report actually lived: a length box that
 * could not be cleared, a Copy button with no visible effect, an option that
 * appeared to move another one off the screen, and a "no repeated characters"
 * checkbox that looked ignored because the old output stayed put.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import PasswordGeneratorTool from '../../src/renderer/components/tools/PasswordGeneratorTool'
;(globalThis as unknown as { React: typeof React }).React = React

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
})
afterEach(() => cleanup())

/**
 * The Length field renders its label as "Length — 20" (the slider echoes the
 * value), so the matcher is a prefix and the selector picks the number box
 * rather than the range input that shares the name.
 */
const lengthBox = (): HTMLInputElement =>
  screen.getByLabelText(/^length/i, { selector: 'input[type=number]' }) as HTMLInputElement

describe('the Length box (reported: "1 cannot be deleted; typing 3 gives 13")', () => {
  it('can be emptied', () => {
    render(<PasswordGeneratorTool />)
    fireEvent.change(lengthBox(), { target: { value: '' } })
    expect(lengthBox().value).toBe('')
  })

  it('takes a typed value instead of concatenating onto the old one', () => {
    render(<PasswordGeneratorTool />)
    fireEvent.change(lengthBox(), { target: { value: '' } })
    fireEvent.change(lengthBox(), { target: { value: '1' } })
    fireEvent.change(lengthBox(), { target: { value: '16' } })
    expect(lengthBox().value).toBe('16')
  })

  it('clamps only on commit', () => {
    render(<PasswordGeneratorTool />)
    fireEvent.change(lengthBox(), { target: { value: '999' } })
    expect(lengthBox().value).toBe('999')
    fireEvent.blur(lengthBox())
    expect(lengthBox().value).toBe('256')
  })
})

describe('"Exclude look-alikes" (reported: disappears when Symbols is on)', () => {
  it('stays on screen with Symbols both on and off', () => {
    render(<PasswordGeneratorTool />)
    const symbols = screen.getByLabelText(/^symbols$/i)
    expect(screen.getByLabelText(/exclude look-alikes/i)).toBeInTheDocument()
    fireEvent.click(symbols)
    expect(screen.getByLabelText(/exclude look-alikes/i)).toBeInTheDocument()
    fireEvent.click(symbols)
    expect(screen.getByLabelText(/exclude look-alikes/i)).toBeInTheDocument()
  })

  it('keeps the Symbol set field mounted so nothing below it shifts', () => {
    render(<PasswordGeneratorTool />)
    const symbolSet = screen.getByLabelText(/symbol set/i) as HTMLInputElement
    expect(symbolSet).toBeEnabled()
    fireEvent.click(screen.getByLabelText(/^symbols$/i))
    // Still there — just disabled. It used to unmount, pushing the checkbox
    // below it up the form.
    expect(screen.getByLabelText(/symbol set/i)).toBeDisabled()
  })
})

describe('turning Symbols off (found while fixing: made every Generate fail)', () => {
  it('zeroes the minimum so the request stays satisfiable', () => {
    render(<PasswordGeneratorTool />)
    fireEvent.click(screen.getByLabelText(/^symbols$/i))

    const minSymbols = screen.getByLabelText(/min\. symbols/i) as HTMLInputElement
    expect(minSymbols.value).toBe('0')
    // …and the form does not report an impossible request.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('explains an impossible request instead of failing only at Generate', () => {
    render(<PasswordGeneratorTool />)
    // Ask for more digits than the password can hold.
    const minNumbers = screen.getByLabelText(/min\. numbers/i)
    fireEvent.change(lengthBox(), { target: { value: '4' } })
    fireEvent.blur(lengthBox())
    fireEvent.change(minNumbers, { target: { value: '4' } })
    fireEvent.blur(minNumbers)
    expect(screen.getByRole('alert')).toHaveTextContent(/too short/i)
  })
})

describe('generating and copying', () => {
  it('copies the whole list and says so', async () => {
    render(<PasswordGeneratorTool />)
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(screen.getByLabelText(/copy all generated/i)).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText(/copy all generated/i))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    // The old button gave no feedback at all — the header even invites the click.
    await waitFor(() => expect(screen.getByText('✓')).toBeInTheDocument())
  })

  it('marks the list stale when an option changes, without throwing it away', async () => {
    render(<PasswordGeneratorTool />)
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(screen.getByLabelText(/copy all generated/i)).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText(/no repeated characters/i))

    // Reported as "no repeats does nothing": the algorithm was right, but the
    // previous output sat there unchanged. It is now labelled — and still there,
    // because it is the user's work.
    expect(screen.getByText(/run again/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/copy all generated/i)).toBeInTheDocument()
  })

  it('produces a password with no repeats when asked', async () => {
    render(<PasswordGeneratorTool />)
    fireEvent.click(screen.getByLabelText(/^symbols$/i)) // avoid the symbol pool
    fireEvent.click(screen.getByLabelText(/no repeated characters/i))
    fireEvent.change(lengthBox(), { target: { value: '16' } })
    fireEvent.blur(lengthBox())
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(screen.getByLabelText(/copy all generated/i)).toBeInTheDocument())
    const rows = screen.getAllByRole('button', { name: /^copy: /i })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const pw = row.textContent ?? ''
      expect(new Set(pw).size).toBe(pw.length)
    }
  })
})
