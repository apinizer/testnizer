import { create } from 'zustand'

const SESSION_TOKEN_KEY = 'testnizer_session_token'
const GUEST_MODE_KEY = 'testnizer_guest_mode'
/**
 * electron-store key (issue #240): the user has made the first-run choice
 * (Continue Anonymous / set a password) or turned the password off. With this
 * set and no password, a launch opens straight into the app instead of the
 * Welcome screen. Not localStorage: that is per-origin renderer state and the
 * dev/prod origins differ; settings live with the rest of the app's config.
 */
export const WELCOME_DONE_KEY = 'auth.welcomeDone'

function markWelcomeDone(): void {
  void Promise.resolve(window.api?.settings?.set?.(WELCOME_DONE_KEY, true)).catch(() => {})
}

async function readWelcomeDone(): Promise<boolean> {
  try {
    const res = (await window.api?.settings?.get?.(WELCOME_DONE_KEY)) as
      | { success?: boolean; data?: unknown }
      | undefined
    return res?.success === true && res.data === true
  } catch {
    return false
  }
}

/** State of a password-less session — the same shape "Continue Anonymous" sets. */
const GUEST_NO_PASSWORD = {
  user: null,
  isAuthenticated: true,
  isGuest: true,
  isLoading: false,
  error: null,
  hasPasswordSet: false,
} as const

interface User {
  id: string
  email: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  authProvider: string
  recoveryEmail: string | null
  createdAt: number
  updatedAt: number
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  isGuest: boolean
  hasPasswordSet: boolean | null // null = not checked yet

  // Actions
  checkSession: () => Promise<void>
  checkHasPassword: () => Promise<void>
  login: (password: string) => Promise<boolean>
  setPassword: (password: string, recoveryEmail?: string) => Promise<boolean>
  /**
   * Settings → App password → Set (review #13): turns the password on from
   * inside a password-less session and keeps that session — no start screen
   * and no `isLoading` flip (AppShell swaps the whole app for a loader while
   * it is true, which would unmount Settings mid-form).
   */
  enablePassword: (password: string) => Promise<{ success: boolean; error?: string }>
  continueAsGuest: () => void
  logout: () => Promise<void>
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ success: boolean; error?: string }>
  disablePassword: (currentPassword: string) => Promise<{ success: boolean; error?: string }>
  recoverPassword: (
    osPassword: string,
    newPassword: string,
  ) => Promise<{ success: boolean; error?: string }>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isGuest: false,
  isLoading: true,
  error: null,
  hasPasswordSet: null,

  checkSession: async () => {
    // A launch never reuses a previous session token — clear it.
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(GUEST_MODE_KEY)
    // Issue #240: with no app password and the first-run choice already made,
    // open straight into the app (the "Continue Anonymous" path) instead of
    // showing the Welcome screen on every launch. Any doubt (IPC error,
    // password set, fresh profile) falls through to the start screen.
    try {
      const [pw, welcomeDone] = await Promise.all([
        window.api.auth.hasPassword(),
        readWelcomeDone(),
      ])
      if (pw?.success && pw.data?.hasPassword === false && welcomeDone) {
        localStorage.setItem(GUEST_MODE_KEY, 'true')
        set({ ...GUEST_NO_PASSWORD })
        return
      }
    } catch {
      /* fall through to the start screen */
    }
    set({ isLoading: false, isAuthenticated: false, isGuest: false, user: null })
  },

  checkHasPassword: async () => {
    try {
      const result = await window.api.auth.hasPassword()
      if (result?.success) {
        set({ hasPasswordSet: result.data?.hasPassword ?? false, isLoading: false })
      } else {
        set({ hasPasswordSet: false, isLoading: false })
      }
    } catch {
      set({ hasPasswordSet: false, isLoading: false })
    }
  },

  login: async (password: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.api.auth.login({ password })
      if (result?.success && result.data) {
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
        localStorage.removeItem(GUEST_MODE_KEY)
        set({ user: result.data.user, isAuthenticated: true, isLoading: false, error: null })
        return true
      } else {
        set({ isLoading: false, error: result?.error || 'Login failed' })
        return false
      }
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message })
      return false
    }
  },

  setPassword: async (password: string, recoveryEmail?: string) => {
    set({ isLoading: true, error: null })
    try {
      const payload: { password: string; recoveryEmail?: string } = { password }
      if (recoveryEmail) payload.recoveryEmail = recoveryEmail
      const result = await window.api.auth.setPassword(payload)
      if (result?.success && result.data) {
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
        localStorage.removeItem(GUEST_MODE_KEY)
        set({
          user: result.data.user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
          hasPasswordSet: true,
        })
        markWelcomeDone()
        return true
      } else {
        set({ isLoading: false, error: result?.error || 'Failed to set password' })
        return false
      }
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message })
      return false
    }
  },

  enablePassword: async (password: string) => {
    try {
      const result = await window.api.auth.setPassword({ password })
      if (result?.success && result.data) {
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
        localStorage.removeItem(GUEST_MODE_KEY)
        set({
          user: result.data.user,
          isAuthenticated: true,
          isGuest: false,
          error: null,
          hasPasswordSet: true,
        })
        markWelcomeDone()
        return { success: true }
      }
      return { success: false, error: result?.error || 'Failed to set password' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  continueAsGuest: () => {
    localStorage.setItem(GUEST_MODE_KEY, 'true')
    set({ isAuthenticated: true, isGuest: true, user: null, isLoading: false, error: null })
    markWelcomeDone()
  },

  logout: async () => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY)
    if (token) {
      try {
        await window.api.auth.logout(token)
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(GUEST_MODE_KEY)
    set({
      user: null,
      isAuthenticated: false,
      isGuest: false,
      isLoading: false,
      error: null,
      hasPasswordSet: null,
    })
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const { user } = get()
    if (!user) return { success: false, error: 'Not logged in' }
    try {
      const result = await window.api.auth.changePassword({
        userId: user.id,
        currentPassword,
        newPassword,
      })
      if (result?.success) {
        return { success: true }
      }
      return { success: false, error: result?.error || 'Password change failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  disablePassword: async (currentPassword: string) => {
    const { user } = get()
    if (!user) return { success: false, error: 'Not logged in' }
    try {
      const result = await window.api.auth.disablePassword({
        userId: user.id,
        currentPassword,
      })
      if (result?.success) {
        // Issue #240: the session continues password-less (the same state as
        // "Continue Anonymous") instead of dropping to the start screen, and
        // later launches open straight in (WELCOME_DONE_KEY).
        localStorage.removeItem(SESSION_TOKEN_KEY)
        localStorage.setItem(GUEST_MODE_KEY, 'true')
        set({ ...GUEST_NO_PASSWORD })
        markWelcomeDone()
        return { success: true }
      }
      return { success: false, error: result?.error || 'Failed to disable password' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  recoverPassword: async (osPassword: string, newPassword: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.api.auth.recoverPassword({ osPassword, newPassword })
      if (result?.success && result.data) {
        // On success, the backend returns a fresh session so the user is
        // immediately unlocked into the app with their new password.
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
        localStorage.removeItem(GUEST_MODE_KEY)
        set({
          user: result.data.user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
          hasPasswordSet: true,
        })
        return { success: true }
      }
      set({ isLoading: false })
      return { success: false, error: result?.error || 'Recovery failed' }
    } catch (e) {
      set({ isLoading: false })
      return { success: false, error: (e as Error).message }
    }
  },

  clearError: () => set({ error: null }),
}))
