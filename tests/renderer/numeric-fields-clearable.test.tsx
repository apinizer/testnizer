/**
 * Every `type="number"` box in the app can be emptied while typing.
 *
 * The reported bug (PG-1) was one field: with 1 in the box, typing 3 produced
 * 13, and the box could not be cleared. The cause is shared by every field that
 * writes `Number(e.target.value)` straight into state on each keystroke —
 * `Number('')` is **0 and finite**, so clearing the box does not read as
 * "nothing typed yet", it reads as the number zero. What that zero means
 * depends on the field, and none of the meanings are good:
 *
 *   proxy port 0        not a port
 *   max redirects 0     silently "follow none"
 *   expected status 0   an assertion no response can satisfy
 *   NotOnOrAfter 0      a zero-width SAML validity window
 *   WS-Security TTL     clamped every keystroke, so it could not be retyped
 *
 * `useNumberDraft` is unit-tested on its own; this file asserts the fields are
 * actually WIRED to it, which is the part that regresses when someone adds a
 * box by copying the one above it.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : (..._a: unknown[]) => Promise.resolve({ success: true, data: [] }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import AssertionRow from '../../src/renderer/components/request/AssertionRow'
import SettingsTab from '../../src/renderer/components/request/SettingsTab'
import BuildForm from '../../src/renderer/components/tools/saml/BuildForm'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { emptyBuildForm } from '../../src/renderer/lib/tools/saml'

afterEach(cleanup)

/**
 * The shared contract: the box shows exactly what was typed, an in-range value
 * propagates immediately, and an empty box propagates nothing at all.
 */
function assertClearable(input: HTMLInputElement, onChange: ReturnType<typeof vi.fn>) {
  const before = onChange.mock.calls.length

  fireEvent.change(input, { target: { value: '' } })
  expect(input.value).toBe('')
  expect(onChange.mock.calls.length).toBe(before) // nothing propagated

  fireEvent.change(input, { target: { value: '250' } })
  expect(input.value).toBe('250') // not "0250", not clamped mid-typing
}

describe('assertion editors (AssertionRow)', () => {
  const onUpdate = vi.fn()
  beforeEach(() => onUpdate.mockReset())

  it('lets the expected status be cleared and retyped', () => {
    render(
      <AssertionRow
        assertion={{ id: 'a1', type: 'status_equals', expected: 200, enabled: true }}
        onUpdate={onUpdate}
        onDelete={() => {}}
      />,
    )
    // The bug wrote `expected: 0` — an assertion no response can ever satisfy.
    assertClearable(screen.getByRole('spinbutton') as HTMLInputElement, onUpdate)
    expect(onUpdate).toHaveBeenLastCalledWith({ expected: 250 })
  })

  it('lets both ends of a status range be cleared', () => {
    render(
      <AssertionRow
        assertion={{ id: 'a2', type: 'status_in_range', rangeMin: 200, rangeMax: 299, enabled: true }}
        onUpdate={onUpdate}
        onDelete={() => {}}
      />,
    )
    const [min, max] = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    assertClearable(min, onUpdate)
    assertClearable(max, onUpdate)
  })

  it('lets a response-time budget be cleared', () => {
    render(
      <AssertionRow
        assertion={{ id: 'a3', type: 'response_time_under', expected: 2000, enabled: true }}
        onUpdate={onUpdate}
        onDelete={() => {}}
      />,
    )
    assertClearable(screen.getByRole('spinbutton') as HTMLInputElement, onUpdate)
  })
})

describe('request settings', () => {
  beforeEach(() => {
    useRequestStore.setState({ maxRedirects: 10 })
  })

  it('lets max redirects be cleared without meaning "follow none"', () => {
    render(<SettingsTab />)
    const box = screen.getByTestId('settings-max-redirects') as HTMLInputElement

    fireEvent.change(box, { target: { value: '' } })
    expect(box.value).toBe('')
    // The store keeps the last good value — an empty box is not the number 0.
    expect(useRequestStore.getState().maxRedirects).toBe(10)

    fireEvent.change(box, { target: { value: '5' } })
    expect(useRequestStore.getState().maxRedirects).toBe(5)
  })
})

describe('SAML validity window', () => {
  it('never collapses NotOnOrAfter to a zero-width window while typing', () => {
    const patch = vi.fn()
    render(<BuildForm form={emptyBuildForm()} patch={patch} />)

    const boxes = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    const notOnOrAfter = boxes[boxes.length - 1]

    fireEvent.change(notOnOrAfter, { target: { value: '' } })
    expect(notOnOrAfter.value).toBe('')
    // `parseInt('') || 0` used to publish 0 here, which is an assertion that
    // expired before it was issued.
    expect(patch).not.toHaveBeenCalledWith({ notOnOrAfterSeconds: 0 })
  })
})
