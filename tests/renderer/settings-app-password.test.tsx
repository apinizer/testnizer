/**
 * Issue #240 — the app password could be turned off only from the Profile
 * dialog, which opens only from the Project Home avatar. Settings now has an
 * "App password" entry driving the same forms and store actions.
 *
 * Asserted at the surface: the status says on / off / unknown, the Disable flow
 * calls `useAuthStore.disablePassword` with the typed password, a wrong
 * password stays in the form as an inline alert, and a successful disable keeps
 * the session going: Settings stays open and its status flips to "Off" (the
 * real store action — later launches skip the Welcome screen, see
 * auth-launch-gate.test.tsx).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

import SettingsModal from '../../src/renderer/components/modals/SettingsModal'
import ProfileModal from '../../src/renderer/components/modals/ProfileModal'
import UserMenu from '../../src/renderer/components/layout/UserMenu'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useAuthStore } from '../../src/renderer/stores/auth.store'

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

const disablePassword = vi.fn()
const changePassword = vi.fn()
const logout = vi.fn(async () => {})
const original = useAuthStore.getState()

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    settings: {
      getAll: vi.fn(async () => ({ success: true, data: {} })),
      setAll: vi.fn(async () => ({ success: true })),
    },
  }
  disablePassword.mockReset()
  changePassword.mockReset()
  logout.mockClear()
  toastSuccess.mockReset()
  toastError.mockReset()
  useUIStore.setState({ showSettingsModal: true, showProfileModal: false })
  useAuthStore.setState({
    user: USER,
    isAuthenticated: true,
    isGuest: false,
    hasPasswordSet: true,
    disablePassword,
    changePassword,
    logout,
  })
})

afterEach(() => {
  cleanup()
  useAuthStore.setState(original, true)
})

describe('Settings → App password status', () => {
  it('shows "on" with Change and Turn off when a password is set', () => {
    render(<SettingsModal />)
    const status = screen.getByTestId('settings-app-password-status')
    expect(status).toHaveAttribute('data-state', 'on')
    expect(status.textContent).toMatch(/On/)
    expect(screen.getByTestId('settings-app-password-change')).toBeInTheDocument()
    expect(screen.getByTestId('settings-app-password-disable')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-app-password-set')).toBeNull()
  })

  it('shows "off" with only a Set password action when no password is set', () => {
    useAuthStore.setState({ user: null, isGuest: true, hasPasswordSet: false })
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-app-password-status')).toHaveAttribute('data-state', 'off')
    expect(screen.queryByTestId('settings-app-password-disable')).toBeNull()
    fireEvent.click(screen.getByTestId('settings-app-password-set'))
    // Review #13: an inline form like Change… / Turn off… — it used to sign
    // out to the start screen without a word.
    expect(screen.getByTestId('password-set-form')).toBeInTheDocument()
    expect(logout).not.toHaveBeenCalled()
    expect(useUIStore.getState().showSettingsModal).toBe(true)
  })

  it('does not guess "off" before the status is known', () => {
    useAuthStore.setState({ hasPasswordSet: null })
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-app-password-status')).toHaveAttribute(
      'data-state',
      'unknown',
    )
    expect(screen.queryByTestId('settings-app-password-disable')).toBeNull()
    expect(screen.queryByTestId('settings-app-password-set')).toBeNull()
  })
})

describe('Settings → App password → Turn off', () => {
  function openDisableAndSubmit(pw: string): void {
    fireEvent.click(screen.getByTestId('settings-app-password-disable'))
    fireEvent.change(screen.getByTestId('password-disable-input'), { target: { value: pw } })
    fireEvent.click(screen.getByTestId('password-disable-submit'))
  }

  it('calls the store action with the current password', async () => {
    disablePassword.mockResolvedValue({ success: true })
    render(<SettingsModal />)
    openDisableAndSubmit('Secret123')
    await waitFor(() => expect(disablePassword).toHaveBeenCalledWith('Secret123'))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('with the real store action: session continues, Settings stays open showing Off, flag set', async () => {
    const ipcDisable = vi.fn(async () => ({ success: true }))
    const settingsSet = vi.fn(async () => ({ success: true }))
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      settings: {
        getAll: vi.fn(async () => ({ success: true, data: {} })),
        setAll: vi.fn(async () => ({ success: true })),
        set: settingsSet,
      },
      auth: { disablePassword: ipcDisable },
    }
    useAuthStore.setState({ disablePassword: original.disablePassword })
    render(<SettingsModal />)
    openDisableAndSubmit('Secret123')
    await waitFor(() =>
      expect(screen.getByTestId('settings-app-password-status')).toHaveAttribute(
        'data-state',
        'off',
      ),
    )
    expect(ipcDisable).toHaveBeenCalledWith({ userId: 'u1', currentPassword: 'Secret123' })
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isGuest).toBe(true)
    expect(s.hasPasswordSet).toBe(false)
    expect(settingsSet).toHaveBeenCalledWith('auth.welcomeDone', true)
  })

  it('keeps the form open with an inline error on a wrong password', async () => {
    disablePassword.mockResolvedValue({ success: false, error: 'Current password is incorrect' })
    render(<SettingsModal />)
    openDisableAndSubmit('wrong')
    const err = await screen.findByTestId('password-disable-error')
    expect(err).toHaveAttribute('role', 'alert')
    expect(err.textContent).toBe('Current password is incorrect')
    expect(screen.getByTestId('password-disable-input')).toHaveAttribute('aria-invalid', 'true')
    expect(useUIStore.getState().showSettingsModal).toBe(true)
  })

  it('Cancel returns to the status row without calling the store', () => {
    render(<SettingsModal />)
    fireEvent.click(screen.getByTestId('settings-app-password-disable'))
    fireEvent.click(screen.getByTestId('password-disable-cancel'))
    expect(screen.queryByTestId('password-disable-form')).toBeNull()
    expect(disablePassword).not.toHaveBeenCalled()
  })
})

describe('Settings → App password → Set (review #13)', () => {
  function fillSet(pw: string, confirm: string): void {
    fireEvent.click(screen.getByTestId('settings-app-password-set'))
    fireEvent.change(screen.getByTestId('password-set-new'), { target: { value: pw } })
    fireEvent.change(screen.getByTestId('password-set-confirm'), { target: { value: confirm } })
  }

  it('with the real store action: the session continues signed in, Settings shows On, no loader', async () => {
    const ipcSet = vi.fn(async () => ({
      success: true,
      data: { user: USER, session: { token: 'tok-1' } },
    }))
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      settings: {
        getAll: vi.fn(async () => ({ success: true, data: {} })),
        setAll: vi.fn(async () => ({ success: true })),
        set: vi.fn(async () => ({ success: true })),
      },
      auth: { setPassword: ipcSet },
    }
    useAuthStore.setState({ user: null, isGuest: true, hasPasswordSet: false, isLoading: false })
    const loading: boolean[] = []
    const unsub = useAuthStore.subscribe((st) => loading.push(st.isLoading))
    render(<SettingsModal />)
    fillSet('Secret123', 'Secret123')
    fireEvent.click(screen.getByTestId('password-set-submit'))
    await waitFor(() =>
      expect(screen.getByTestId('settings-app-password-status')).toHaveAttribute(
        'data-state',
        'on',
      ),
    )
    unsub()
    expect(ipcSet).toHaveBeenCalledWith({ password: 'Secret123' })
    // AppShell swaps the whole app for a loader while isLoading is true.
    expect(loading).not.toContain(true)
    expect(logout).not.toHaveBeenCalled()
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    const st = useAuthStore.getState()
    expect(st.isGuest).toBe(false)
    expect(st.user?.id).toBe('u1')
    expect(toastSuccess).toHaveBeenCalled()
    // Change / Turn off are available right away.
    expect(screen.getByTestId('settings-app-password-disable')).toBeInTheDocument()
  })

  it('submit stays disabled for a weak or mismatched password; mismatch is an inline alert', () => {
    useAuthStore.setState({ user: null, isGuest: true, hasPasswordSet: false })
    render(<SettingsModal />)
    fillSet('short1', 'short1')
    expect(screen.getByTestId('password-set-submit')).toBeDisabled()
    fireEvent.change(screen.getByTestId('password-set-new'), { target: { value: 'Secret123' } })
    fireEvent.change(screen.getByTestId('password-set-confirm'), { target: { value: 'Secret124' } })
    expect(screen.getByTestId('password-set-submit')).toBeDisabled()
    expect(screen.getByTestId('password-set-error')).toHaveAttribute('role', 'alert')
  })

  it('a refused password stays in the form as an inline error; Cancel closes it', async () => {
    useAuthStore.setState({
      user: null,
      isGuest: true,
      hasPasswordSet: false,
      enablePassword: vi.fn(async () => ({ success: false, error: 'Nope' })),
    })
    render(<SettingsModal />)
    fillSet('Secret123', 'Secret123')
    fireEvent.click(screen.getByTestId('password-set-submit'))
    expect((await screen.findByTestId('password-set-error')).textContent).toBe('Nope')
    fireEvent.click(screen.getByTestId('password-set-cancel'))
    expect(screen.queryByTestId('password-set-form')).toBeNull()
  })
})

describe('header session menu → Set a password… (review #13 sibling)', () => {
  it('opens Settings at the inline Set form instead of signing out', () => {
    useUIStore.setState({ showSettingsModal: false })
    useAuthStore.setState({ user: null, isGuest: true, hasPasswordSet: false })
    render(
      <>
        <UserMenu />
        <SettingsModal />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    fireEvent.click(screen.getByTestId('user-menu-set-password'))
    expect(logout).not.toHaveBeenCalled()
    expect(useUIStore.getState().showSettingsModal).toBe(true)
    expect(screen.getByTestId('password-set-form')).toBeInTheDocument()
    // consumed once: a later plain open of Settings starts idle
    expect(useUIStore.getState().settingsFocus).toBeNull()
  })

  it('closing Settings drops a pending focus', () => {
    useUIStore.getState().openSettingsAt('appPasswordSet')
    useUIStore.getState().setShowSettingsModal(false)
    expect(useUIStore.getState().settingsFocus).toBeNull()
  })
})

describe('Settings → App password → Change', () => {
  it('uses the shared change form and the store action', async () => {
    changePassword.mockResolvedValue({ success: true })
    render(<SettingsModal />)
    fireEvent.click(screen.getByTestId('settings-app-password-change'))
    fireEvent.change(screen.getByTestId('password-change-current'), {
      target: { value: 'Secret123' },
    })
    fireEvent.change(screen.getByTestId('password-change-new'), { target: { value: 'Newer4567' } })
    fireEvent.change(screen.getByTestId('password-change-confirm'), {
      target: { value: 'Newer4567' },
    })
    fireEvent.click(screen.getByTestId('password-change-submit'))
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('Secret123', 'Newer4567'))
    await waitFor(() => expect(screen.queryByTestId('password-change-form')).toBeNull())
  })
})

describe('Profile dialog reuses the same forms', () => {
  it('renders the shared change form and the disable card', () => {
    useUIStore.setState({ showSettingsModal: false, showProfileModal: true })
    render(<ProfileModal />)
    expect(screen.getByTestId('password-change-form')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('password-disable-open'))
    expect(screen.getByTestId('password-disable-form')).toBeInTheDocument()
  })

  it('placeholder states the real rule (8 characters), not "Min 6"', () => {
    useUIStore.setState({ showSettingsModal: false, showProfileModal: true })
    render(<ProfileModal />)
    const input = screen.getByTestId('password-change-new')
    expect(input.getAttribute('placeholder')).toMatch(/8/)
  })
})
