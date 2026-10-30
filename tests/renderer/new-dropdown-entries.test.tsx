/**
 * The New (+) menu lists each protocol once plus a single Import entry.
 *
 *   - "Quick Request" opened the same unsaved HTTP GET tab as "HTTP" under a
 *     different tab name — two entries for one action.
 *   - "Import cURL" opened the Import API Data modal with the cURL card
 *     preselected; cURL is a card in that modal, so "Import" already reaches it.
 */
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import NewDropdown from '../../src/renderer/components/sidebar/NewDropdown'
import { useUIStore } from '../../src/renderer/stores/ui.store'

afterEach(() => {
  cleanup()
  useUIStore.getState().setShowImportModal(false)
})

function openMenu(): HTMLElement {
  render(<NewDropdown />)
  fireEvent.click(screen.getByTestId('new-dropdown-btn'))
  return screen.getByTestId('new-dropdown-menu')
}

describe('New dropdown entries', () => {
  it('has no Quick Request or Import cURL entry', () => {
    const menu = openMenu()
    expect(within(menu).queryByRole('button', { name: /Quick Request/i })).toBeNull()
    expect(within(menu).queryByRole('button', { name: /Import cURL/i })).toBeNull()
  })

  it('keeps HTTP, MQTT and a single Import entry', () => {
    const menu = openMenu()
    expect(within(menu).getByRole('button', { name: /^HTTP$/i })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: /^MQTT$/i })).toBeTruthy()
    expect(within(menu).getAllByRole('button', { name: /^Import$/i })).toHaveLength(1)
  })

  it('Import opens the Import API Data modal', () => {
    const menu = openMenu()
    fireEvent.click(within(menu).getByRole('button', { name: /^Import$/i }))
    expect(useUIStore.getState().showImportModal).toBe(true)
  })
})
