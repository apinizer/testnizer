/**
 * NumberField — the contract that closes the reported "1 can't be deleted;
 * typing 3 gives 13" bug (Security → Password Generator, and the same primitive
 * copied into OtpTool).
 *
 * The old handler clamped on every keystroke, so `Number('')` → `0` → `min` put
 * the previous value straight back into the box. These tests pin the three
 * behaviours that make the field usable: it can be emptied, an intermediate
 * entry survives long enough to finish typing, and clamping happens on commit.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NumberField from '../../../src/renderer/components/shared/NumberField'
import { clampInt, parseIntStrict } from '../../../src/renderer/lib/number-draft'

// Vitest's esbuild transform uses the classic JSX runtime → React must be global.
;(globalThis as unknown as { React: typeof React }).React = React

afterEach(() => cleanup())

/** Renders a controlled NumberField so the tests exercise the real round-trip. */
function Harness({
  initial,
  min,
  max,
  onChange,
  slider,
}: {
  initial: number
  min: number
  max: number
  onChange?: (v: number) => void
  slider?: boolean
}) {
  const [value, setValue] = React.useState(initial)
  return (
    <NumberField
      label="Length"
      value={value}
      min={min}
      max={max}
      slider={slider}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

const box = (): HTMLInputElement => screen.getByRole('spinbutton') as HTMLInputElement

describe('parseIntStrict', () => {
  it('accepts whole integers only', () => {
    expect(parseIntStrict('16')).toBe(16)
    expect(parseIntStrict(' 16 ')).toBe(16)
    expect(parseIntStrict('-4')).toBe(-4)
  })

  it('rejects everything the old Number() coercion silently accepted', () => {
    // `Number('')` is 0 — the exact coercion that made the field unclearable.
    expect(parseIntStrict('')).toBeNull()
    expect(parseIntStrict('   ')).toBeNull()
    expect(parseIntStrict('-')).toBeNull()
    expect(parseIntStrict('1.5')).toBeNull()
    expect(parseIntStrict('1e3')).toBeNull()
    expect(parseIntStrict('abc')).toBeNull()
  })
})

describe('clampInt', () => {
  it('clamps into range and truncates', () => {
    expect(clampInt(300, 4, 256)).toBe(256)
    expect(clampInt(1, 4, 256)).toBe(4)
    expect(clampInt(12.9, 4, 256)).toBe(12)
  })

  it('falls back to min for non-finite input', () => {
    expect(clampInt(Number.NaN, 4, 256)).toBe(4)
    expect(clampInt(Number.POSITIVE_INFINITY, 4, 256)).toBe(256)
  })
})

describe('NumberField typing behaviour', () => {
  it('can be emptied — the box does not snap back to min', () => {
    render(<Harness initial={20} min={4} max={256} />)
    fireEvent.change(box(), { target: { value: '' } })
    expect(box().value).toBe('')
  })

  it('accepts a value typed from empty instead of concatenating (reported bug)', () => {
    const onChange = vi.fn()
    render(<Harness initial={20} min={4} max={256} onChange={onChange} />)

    fireEvent.change(box(), { target: { value: '' } })
    // "1" is below min: it must stay on screen as a partial entry, NOT be
    // clamped to 4 (which is what produced "41" on the next keystroke).
    fireEvent.change(box(), { target: { value: '1' } })
    expect(box().value).toBe('1')
    expect(onChange).not.toHaveBeenCalledWith(4)

    fireEvent.change(box(), { target: { value: '16' } })
    expect(box().value).toBe('16')
    expect(onChange).toHaveBeenLastCalledWith(16)
  })

  it('propagates in-range values immediately so a bound slider stays live', () => {
    const onChange = vi.fn()
    render(<Harness initial={20} min={4} max={256} onChange={onChange} slider />)
    fireEvent.change(box(), { target: { value: '32' } })
    expect(onChange).toHaveBeenCalledWith(32)
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('32')
  })

  it('does not propagate a partial or out-of-range entry while typing', () => {
    const onChange = vi.fn()
    render(<Harness initial={20} min={4} max={256} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: '999' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(box().value).toBe('999')
  })
})

describe('NumberField commit behaviour', () => {
  it('clamps an out-of-range entry on blur', () => {
    const onChange = vi.fn()
    render(<Harness initial={20} min={4} max={256} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: '999' } })
    fireEvent.blur(box())
    expect(onChange).toHaveBeenLastCalledWith(256)
    expect(box().value).toBe('256')
  })

  it('restores the last good value when blurred while empty', () => {
    const onChange = vi.fn()
    render(<Harness initial={20} min={4} max={256} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: '' } })
    fireEvent.blur(box())
    // Not `min` — picking a number for the user is what the old code did.
    expect(box().value).toBe('20')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits on Enter as well as blur', () => {
    const onChange = vi.fn()
    render(<Harness initial={20} min={4} max={256} onChange={onChange} />)
    fireEvent.change(box(), { target: { value: '2' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(4)
    expect(box().value).toBe('4')
  })

  it('mirrors external changes while the field is not focused', () => {
    const { rerender } = render(
      <NumberField label="Length" value={20} min={4} max={256} onChange={() => {}} />,
    )
    rerender(<NumberField label="Length" value={64} min={4} max={256} onChange={() => {}} />)
    expect(box().value).toBe('64')
  })

  it('does not fight the user mid-edit when the parent re-renders', () => {
    const { rerender } = render(
      <NumberField label="Length" value={20} min={4} max={256} onChange={() => {}} />,
    )
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '' } })
    rerender(<NumberField label="Length" value={20} min={4} max={256} onChange={() => {}} />)
    expect(box().value).toBe('')
  })
})

describe('NumberField labelling', () => {
  it('associates the visible label with the input', () => {
    render(<NumberField label="How many" value={1} min={1} max={100} onChange={() => {}} />)
    expect(screen.getByLabelText('How many')).toBe(box())
  })

  it('falls back to ariaLabel when there is no visible label', () => {
    render(<NumberField ariaLabel="Digits" value={6} min={6} max={8} onChange={() => {}} />)
    expect(screen.getByLabelText('Digits')).toBe(box())
  })
})
