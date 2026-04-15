import { create } from 'zustand'

const SESSION_TOKEN_KEY = 'apinizer_session_token'
const GUEST_MODE_KEY = 'apinizer_guest_mode'

interface User {
  id: string
  email: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  authProvider: string
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
  setPassword: (password: string) => Promise<boolean>
  continueAsGuest: () => void
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  clearError: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => (window as any).api

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isGuest: false,
  isLoading: true,
  error: null,
  hasPasswordSet: null,

  checkSession: async () => {
    // Always require login on app launch — clear any previous session
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(GUEST_MODE_KEY)
    set({ isLoading: false, isAuthenticated: false, isGuest: false, user: null })
  },

  checkHasPassword: async () => {
    try {
      const result = await api().auth.hasPassword() as {
        success: boolean
        data?: { hasPassword: boolean }
      }
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
      const result = await api().auth.login({ password }) as {
        success: boolean
        data?: { user: User; session: { token: string } }
        error?: string
      }
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

  setPassword: async (password: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await api().auth.setPassword({ password }) as {
        success: boolean
        data?: { user: User; session: { token: string } }
        error?: string
      }
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

  continueAsGuest: () => {
    localStorage.setItem(GUEST_MODE_KEY, 'true')
    set({ isAuthenticated: true, isGuest: true, user: null, isLoading: false, error: null })
  },

  logout: async () => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY)
    if (token) {
      try { await api().auth.logout(token) } catch { /* ignore */ }
    }
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(GUEST_MODE_KEY)
    set({ user: null, isAuthenticated: false, isGuest: false, isLoading: false, error: null, hasPasswordSet: null })
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const { user } = get()
    if (!user) return { success: false, error: 'Not logged in' }
    try {
      const result = await api().auth.changePassword({
        userId: user.id,
        currentPassword,
        newPassword,
      }) as { success: boolean; error?: string }
      if (result?.success) {
        return { success: true }
      }
      return { success: false, error: result?.error || 'Password change failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  clearError: () => set({ error: null }),
}))
