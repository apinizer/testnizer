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

  // Actions
  checkSession: () => Promise<void>
  login: (emailOrUsername: string, password: string) => Promise<boolean>
  register: (email: string, username: string, password: string, displayName?: string) => Promise<boolean>
  oauthLogin: (provider: 'google' | 'github' | 'gitlab') => Promise<boolean>
  continueAsGuest: () => void
  logout: () => Promise<void>
  updateProfile: (data: { displayName?: string; email?: string; username?: string }) => Promise<boolean>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  deleteAccount: (password?: string) => Promise<boolean>
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

  checkSession: async () => {
    // Check guest mode first
    if (localStorage.getItem(GUEST_MODE_KEY) === 'true') {
      set({ isAuthenticated: true, isGuest: true, user: null, isLoading: false })
      return
    }

    const token = localStorage.getItem(SESSION_TOKEN_KEY)
    if (!token) {
      set({ isLoading: false, isAuthenticated: false, user: null })
      return
    }

    try {
      const result = await api().auth.getSession(token) as {
        success: boolean
        data?: { user: User }
        error?: string
      }
      if (result?.success && result.data?.user) {
        set({ user: result.data.user, isAuthenticated: true, isLoading: false })
      } else {
        localStorage.removeItem(SESSION_TOKEN_KEY)
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    } catch {
      localStorage.removeItem(SESSION_TOKEN_KEY)
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  login: async (emailOrUsername: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await api().auth.login({ emailOrUsername, password }) as {
        success: boolean
        data?: { user: User; session: { token: string } }
        error?: string
      }
      if (result?.success && result.data) {
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
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

  register: async (email: string, username: string, password: string, displayName?: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await api().auth.register({ email, username, password, displayName }) as {
        success: boolean
        data?: { user: User; session: { token: string } }
        error?: string
      }
      if (result?.success && result.data) {
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
        set({ user: result.data.user, isAuthenticated: true, isLoading: false, error: null })
        return true
      } else {
        set({ isLoading: false, error: result?.error || 'Registration failed' })
        return false
      }
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message })
      return false
    }
  },

  oauthLogin: async (provider: 'google' | 'github' | 'gitlab') => {
    set({ isLoading: true, error: null })
    try {
      const methodMap = {
        google: 'oauthGoogle',
        github: 'oauthGithub',
        gitlab: 'oauthGitlab',
      } as const
      const result = await api().auth[methodMap[provider]]() as {
        success: boolean
        data?: { user: User; session: { token: string } }
        error?: string
      }
      if (result?.success && result.data) {
        localStorage.setItem(SESSION_TOKEN_KEY, result.data.session.token)
        set({ user: result.data.user, isAuthenticated: true, isLoading: false, error: null })
        return true
      } else {
        set({ isLoading: false, error: result?.error || 'OAuth login failed' })
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
    set({ user: null, isAuthenticated: false, isGuest: false, isLoading: false, error: null })
  },

  updateProfile: async (data) => {
    const { user } = get()
    if (!user) return false
    set({ error: null })
    try {
      const result = await api().auth.updateProfile({ userId: user.id, ...data }) as {
        success: boolean
        data?: { user: User }
        error?: string
      }
      if (result?.success && result.data) {
        set({ user: result.data.user })
        return true
      } else {
        set({ error: result?.error || 'Update failed' })
        return false
      }
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    }
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

  deleteAccount: async (password?: string) => {
    const { user } = get()
    if (!user) return false
    try {
      const result = await api().auth.deleteAccount({ userId: user.id, password }) as {
        success: boolean; error?: string
      }
      if (result?.success) {
        localStorage.removeItem(SESSION_TOKEN_KEY)
        set({ user: null, isAuthenticated: false })
        return true
      }
      set({ error: result?.error || 'Delete failed' })
      return false
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    }
  },

  clearError: () => set({ error: null }),
}))
