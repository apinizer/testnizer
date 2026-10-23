/**
 * Issue #268 — with an app password set, the header session menu offered only
 * "Lock" and "About": no way to change or turn off the password from there.
 * Protected mode now has "Manage password…", which opens Settings at the App
 * password section (Change / Turn off) without opening a form. Guest mode keeps
 * "Set a password…" and does not show "Manage password…".
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import UserMenu from '../../src/renderer/components/layout/UserMenu'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useAuthStore } from '../../src/renderer/stores/auth.store'
import { setLocale } from '../../src/renderer/lib/i18n'

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

const USER = {
  id: 'u1',
  email: 'local@testnizer.app',
  username: 'local',
  displayName: 'Local User',
  avatarUrl: null,
  authProvider: 'local',
  recoveryEmail: null,
  createdAt: 0,
  updatedAt: 0,
}

const logout = vi.fn(async () => {})
const originalAuth = useAuthStore.getState()

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      getAll: vi.fn(async () => ({ success: true, data: {} })),
      setAll: vi.fn(async () => ({ success: true })),
    },
  }
  logout.mockClear()
  useUIStore.setState({ showSettingsModal: false, settingsFocus: null })
  useLocale('en')
})

afterEach(() => {
  cleanup()
  useAuthStore.setState(originalAuth, true)
  useUIStore.setState({ showSettingsModal: false, settingsFocus: null })
  useLocale('en')
})

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Session' }))
  return screen.getByRole('menu')
}

describe('header session menu → Manage password… (issue #268)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: USER,
      isAuthenticated: true,
      isGuest: false,
      hasPasswordSet: true,
      logout,
    })
  })

  it('protected mode lists Manage password… between the header and Lock', () => {
    render(<UserMenu />)
    const menu = openMenu()
    const item = within(menu).getByTestId('user-menu-manage-password')
    expect(item).toHaveTextContent('Manage password…')
    expect(within(menu).queryByTestId('user-menu-set-password')).toBeNull()
    const buttons = within(menu).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Manage password…',
      'Lock',
      'About Testnizer',
    ])
  })

  it('opens Settings at the App password section with Change / Turn off, no form open', () => {
    render(
      <>
        <UserMenu />
        <SettingsModal />
      </>,
    )
    openMenu()
    fireEvent.click(screen.getByTestId('user-menu-manage-password'))

    expect(logout).not.toHaveBeenCalled()
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    const section = screen.getByTestId('settings-app-password')
    const change = within(section).getByTestId('settings-app-password-change')
    // Keyboard focus lands on Change, one key from the next step.
    expect(change).toHaveFocus()
    expect(within(section).getByTestId('settings-app-password-disable')).toBeInTheDocument()
    // Manage does not jump into any form.
    expect(screen.queryByTestId('password-set-form')).toBeNull()
    // Focus consumed once by the section.
    expect(useUIStore.getState().settingsFocus).toBeNull()
  })

  it('the click requests the manage focus, not the Set form focus', () => {
    render(<UserMenu />)
    openMenu()
    fireEvent.click(screen.getByTestId('user-menu-manage-password'))
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    expect(useUIStore.getState().settingsFocus).toBe('appPassword')
  })

  it('Turkish label', () => {
    useLocale('tr')
    render(<UserMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Oturum' }))
    expect(screen.getByTestId('user-menu-manage-password')).toHaveTextContent('Şifreyi yönet…')
  })
})

describe('header session menu in guest mode (unchanged)', () => {
  it('shows Set a password…, not Manage password…', () => {
    useAuthStore.setState({ user: null, isGuest: true, hasPasswordSet: false, logout })
    render(<UserMenu />)
    const menu = openMenu()
    expect(within(menu).getByTestId('user-menu-set-password')).toBeInTheDocument()
    expect(within(menu).queryByTestId('user-menu-manage-password')).toBeNull()
  })
})
