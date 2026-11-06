/**
 * The session menu's report link goes through main, closes the menu, and says so
 * when the browser could not be opened instead of doing nothing.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn(), warning: vi.fn() },
}))

import UserMenu from '../../src/renderer/components/layout/UserMenu'
import { setLocale } from '../../src/renderer/lib/i18n'

const reportIssue = vi.fn()

function openMenuAndReport(): void {
  render(<UserMenu />)
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  fireEvent.click(screen.getByTestId('user-menu-report-issue'))
}

beforeEach(() => {
  setLocale('en')
  toastError.mockClear()
  reportIssue.mockReset()
  ;(window as unknown as { api: unknown }).api = { app: { reportIssue } }
})
afterEach(cleanup)

describe('UserMenu report an issue', () => {
  it('asks main to open the form and closes the menu', async () => {
    reportIssue.mockResolvedValue({ success: true, data: null })
    openMenuAndReport()
    await waitFor(() => expect(reportIssue).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('user-menu-report-issue')).not.toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows why when the browser cannot be opened', async () => {
    reportIssue.mockResolvedValue({ success: false, error: 'no handler' })
    openMenuAndReport()
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not open the browser: no handler'),
    )
  })
})
