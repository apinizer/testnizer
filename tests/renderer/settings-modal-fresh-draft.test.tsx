/**
 * Issue #272 — Settings seeded theme / language / font size from the store
 * only once, in `useState`. The component stays mounted while closed, so after
 * one opening the draft went stale: change the theme or language elsewhere
 * (command palette), reopen Settings, and it showed the old values — pressing
 * Save then wrote them back over the change.
 *
 * Now every opening re-seeds those three fields from the store, while a change
 * made in the store while the dialog is open does not overwrite the draft.
 */
// vitest compiles JSX with the classic runtime (React must be in scope), while
// tsc flags a JSX-only React import as unused (TS6133) — so no JSX here.
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { t as translate } from '../../src/renderer/lib/i18n'

// The dialog renders through a portal — look it up in the whole document.
function languageSelect(): HTMLSelectElement {
  const select = Array.from(document.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => o.value === 'tr'),
  )
  if (!select) throw new Error('language select not rendered')
  return select
}

function fontInput(): HTMLInputElement {
  // Font size is the first number field (timeout follows it).
  const input = document.querySelector('input[type="number"]')
  if (!input) throw new Error('font size input not rendered')
  return input as HTMLInputElement
}

function setShow(show: boolean): void {
  act(() => useUIStore.setState({ showSettingsModal: show }))
}

async function save(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: translate('settings.save') }))
  await waitFor(() => expect(useUIStore.getState().showSettingsModal).toBe(false))
}

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      getAll: vi.fn(async () => ({ success: true, data: {} })),
      setAll: vi.fn(async () => ({ success: true })),
      set: vi.fn(async () => ({ success: true })),
    },
  }
  const ui = useUIStore.getState()
  ui.setTheme('light')
  ui.setLocale('en')
  ui.setFontSize(13)
  useUIStore.setState({ showSettingsModal: false })
})

afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('SettingsModal draft on reopen (issue #272)', () => {
  it('reopening shows theme / language / font size changed elsewhere, and Save keeps them', async () => {
    render(React.createElement(SettingsModal))

    // First opening: the draft is seeded from the store.
    setShow(true)
    expect(languageSelect().value).toBe('en')
    expect(fontInput().value).toBe('13')
    setShow(false)

    // Changed elsewhere (command palette, header) while Settings is closed.
    act(() => {
      const ui = useUIStore.getState()
      ui.setTheme('dark')
      ui.setLocale('tr')
      ui.setFontSize(16)
    })

    setShow(true)
    expect(languageSelect().value).toBe('tr')
    await waitFor(() => expect(fontInput().value).toBe('16'))

    await save()
    const ui = useUIStore.getState()
    expect(ui.theme).toBe('dark')
    expect(ui.locale).toBe('tr')
    expect(ui.fontSize).toBe(16)
  })

  it('a store change while the dialog is open does not overwrite the draft', async () => {
    render(React.createElement(SettingsModal))
    setShow(true)

    fireEvent.change(languageSelect(), { target: { value: 'tr' } })
    fireEvent.change(fontInput(), { target: { value: '18' } })

    // Something else writes the store mid-edit; the user's draft stands.
    act(() => useUIStore.setState({ locale: 'en', fontSize: 12 }))
    expect(languageSelect().value).toBe('tr')
    expect(fontInput().value).toBe('18')

    await save()
    expect(useUIStore.getState().locale).toBe('tr')
    expect(useUIStore.getState().fontSize).toBe(18)
  })
})
