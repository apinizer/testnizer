/**
 * Issue #240 — with no app password, every launch still showed the Welcome
 * screen and the user had to click "Continue Anonymous" again: `checkSession`
 * always left `isAuthenticated: false`, so `AppShell` rendered `LoginScreen`.
 *
 * Now the first-run choice is remembered in electron-store (`auth.welcomeDone`,
 * via the settings IPC). Launch rules asserted here:
 *  - fresh profile (no flag, no password) → Welcome screen;
 *  - flag set + no password → straight in, the same state "Continue Anonymous"
 *    sets (authenticated guest, `hasPasswordSet: false` — `AppShell` gives that
 *    full access and initializes projects), so no LoginScreen;
 *  - password set → the password form, flag or not;
 *  - the flag is written by Continue Anonymous, set-password and disable.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LoginScreen from '../../src/renderer/components/auth/LoginScreen'
import { useAuthStore, WELCOME_DONE_KEY } from '../../src/renderer/stores/auth.store'
;(globalThis as unknown as { React: typeof React }).React = React

const original = useAuthStore.getState()
let hasPassword: boolean | 'error' = false
let stored: Record<string, unknown> = {}
const settingsSet = vi.fn(async (key: string, value: unknown) => {
  stored[key] = value
  return { success: true, data: true }
})

beforeEach(() => {
  hasPassword = false
  stored = {}
  settingsSet.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    auth: {
      hasPassword: vi.fn(async () =>
        hasPassword === 'error'
          ? { success: false, error: 'db closed' }
          : { success: true, data: { hasPassword } },
      ),
      setPassword: vi.fn(async () => ({
        success: true,
        data: { user: { id: 'u1' }, session: { token: 'tok' } },
      })),
      disablePassword: vi.fn(async () => ({ success: true })),
    },
    settings: {
      get: vi.fn(async (key: string) => ({ success: true, data: stored[key] })),
      set: settingsSet,
    },
  }
  useAuthStore.setState(original, true)
})

afterEach(() => {
  cleanup()
  useAuthStore.setState(original, true)
})

describe('launch gate', () => {
  it('uses the electron-store key auth.welcomeDone', () => {
    expect(WELCOME_DONE_KEY).toBe('auth.welcomeDone')
  })

  it('fresh profile: stays on the start screen and shows Welcome', async () => {
    await useAuthStore.getState().checkSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    render(<LoginScreen />)
    expect(await screen.findByTestId('login-continue-anonymous')).toBeTruthy()
  })

  it('first-run choice made + no password: opens straight into the app', async () => {
    stored[WELCOME_DONE_KEY] = true
    await useAuthStore.getState().checkSession()
    const s = useAuthStore.getState()
    // The exact state "Continue Anonymous" produces → AppShell skips LoginScreen.
    expect(s.isAuthenticated).toBe(true)
    expect(s.isGuest).toBe(true)
    expect(s.hasPasswordSet).toBe(false)
    expect(s.isLoading).toBe(false)
    expect(s.user).toBeNull()
  })

  it('password set: the password form, even with the flag', async () => {
    hasPassword = true
    stored[WELCOME_DONE_KEY] = true
    await useAuthStore.getState().checkSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    render(<LoginScreen />)
    await screen.findByText(/Welcome Back/)
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('cannot tell whether a password exists: falls back to the start screen', async () => {
    hasPassword = 'error'
    stored[WELCOME_DONE_KEY] = true
    await useAuthStore.getState().checkSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

describe('who records the first-run choice', () => {
  it('Continue Anonymous', () => {
    useAuthStore.getState().continueAsGuest()
    expect(settingsSet).toHaveBeenCalledWith(WELCOME_DONE_KEY, true)
  })

  it('setting a password', async () => {
    await useAuthStore.getState().setPassword('Secret123')
    expect(settingsSet).toHaveBeenCalledWith(WELCOME_DONE_KEY, true)
  })

  it('turning the password off — and the session continues password-less', async () => {
    useAuthStore.setState({
      user: { id: 'u1' } as never,
      isAuthenticated: true,
      isGuest: false,
      hasPasswordSet: true,
    })
    const res = await useAuthStore.getState().disablePassword('Secret123')
    expect(res.success).toBe(true)
    expect(settingsSet).toHaveBeenCalledWith(WELCOME_DONE_KEY, true)
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isGuest).toBe(true)
    expect(s.hasPasswordSet).toBe(false)

    // …and the next launch goes straight in.
    useAuthStore.setState({ isAuthenticated: false, isGuest: false })
    await useAuthStore.getState().checkSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
