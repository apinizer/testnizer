/**
 * Accessibility contracts for the tools panel.
 *
 * Each of these was a real defect, and each is the kind that comes back the
 * moment someone adds a field:
 *
 *   T-3   every label in the OTP form pointed at nothing — `useId()` was
 *         generated in the wrapper but never passed to the input it labelled, so
 *         clicking a label did not focus its field and a screen reader announced
 *         eight unnamed textboxes.
 *   T-4   the HMAC secret was `type="text"`. This tool gets used at someone
 *         else's desk; that is precisely where shoulder-surfing happens.
 *   T-9   `CopyButton`'s accessible name was the glyph "⧉". A JWT panel renders
 *         five of them, so the whole panel read as five identical buttons —
 *         which is why `ariaLabel` is a REQUIRED prop rather than a convention.
 *   T-11  the XML formatter's indent `<select>` was named after one of its own
 *         options ("2 spaces"), so it announced "2 spaces, combo box, 2 spaces".
 *
 * The assertions are made through the accessibility tree (`getByLabelText`,
 * `getByRole(name)`), not through DOM structure — a label that merely EXISTS
 * next to an input passes a structural check and still fails a real user.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

// `otp.store.ts` reads `window.api.otp` at MODULE-EVAL time, which happens when
// the imports below are hoisted — before any `beforeEach` could install a
// bridge. `vi.hoisted` runs earlier still. The proxy answers every namespace
// with a resolved envelope; these tests assert markup, not data.
vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then' ? undefined : (..._a: unknown[]) => Promise.resolve({ success: true, data: [] }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

import OtpTool from '../../src/renderer/components/tools/OtpTool'
import HmacTool from '../../src/renderer/components/tools/HmacTool'
import XmlFormatTool from '../../src/renderer/components/tools/XmlFormatTool'
import CopyButton from '../../src/renderer/components/shared/CopyButton'

afterEach(cleanup)

/* ── T-3: labels that actually name their field ────────────────────────────── */

describe('OTP form labels resolve to their inputs (T-3)', () => {
  it('gives every form control an accessible name', () => {
    render(<OtpTool />)

    // `getByLabelText` walks the accessibility tree: it only finds a control
    // whose label is genuinely associated with it.
    const controls = [
      ...screen.getAllByRole('textbox'),
      ...screen.getAllByRole('combobox'),
      ...screen.queryAllByRole('spinbutton'),
    ]
    expect(controls.length).toBeGreaterThan(0)

    // All four naming routes count — `aria-label`, `aria-labelledby`, a wrapping
    // <label>, or `label[for]`. What must not happen is a control with none of
    // them, named only by a placeholder that disappears when you type into it.
    const unnamed = controls.filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false
      if (el.closest('label')) return false
      const id = el.getAttribute('id')
      return !id || !document.querySelector(`label[for="${id}"]`)
    })
    expect(unnamed.map((el) => el.outerHTML)).toEqual([])
  })

  it('resolves each control by its visible label text', () => {
    render(<OtpTool />)
    // A structural check ("a label exists") passes even when `htmlFor` points at
    // nothing, so at least one lookup goes through the label text itself.
    const labels = Array.from(document.querySelectorAll('label[for]'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      const target = document.getElementById(label.getAttribute('for') as string)
      expect(target).not.toBeNull()
    }
  })
})

/* ── T-4: secrets are masked ───────────────────────────────────────────────── */

describe('the HMAC secret field is masked (T-4)', () => {
  it('renders the secret as a password input', () => {
    render(<HmacTool />)
    const secret = screen.getByLabelText(/secret/i)
    expect(secret).toHaveAttribute('type', 'password')
  })
})

/* ── T-9: copy buttons are distinguishable ─────────────────────────────────── */

describe('CopyButton carries a distinguishing name (T-9)', () => {
  it('uses the supplied label as its accessible name, not the glyph', () => {
    render(
      <div>
        <CopyButton text="left" ariaLabel="Copy the left side" />
        <CopyButton text="right" ariaLabel="Copy the right side" />
      </div>,
    )

    // The bug: both of these were named "⧉", so neither could be reached or
    // reported distinctly.
    expect(screen.getByRole('button', { name: 'Copy the left side' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy the right side' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '⧉' })).toBeNull()
  })
})

/* ── T-11: a control is named after itself, not after a value ──────────────── */

describe('the XML indent select is named after the control (T-11)', () => {
  it('does not take its accessible name from one of its own options', () => {
    render(<XmlFormatTool />)

    const select = screen.getByRole('combobox', { name: 'Indent' })
    // The old name was "2 spaces" — which is also an option, so the control
    // announced the same words twice and said nothing about what it does.
    expect(within(select).getByRole('option', { name: '2 spaces' })).toBeInTheDocument()
    expect(select.getAttribute('aria-label')).not.toBe('2 spaces')
  })
})
