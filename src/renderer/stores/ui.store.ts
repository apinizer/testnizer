import { create } from 'zustand'
import type { Theme, Language } from '../types'
import { setLocale as setI18nLocale } from '../lib/i18n'

type Locale = Language
type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'settings'

// Preset font stacks offered as quick picks. The stored `fontFamily` is always
// a raw CSS font-family value — users may type any stack they like.
export const FONT_PRESETS: Array<{ id: string; label: string; stack: string }> = [
  { id: 'inter', label: 'Inter', stack: "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif" },
  { id: 'system', label: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" },
  { id: 'sfpro', label: 'SF Pro', stack: "'SF Pro Text', -apple-system, system-ui, sans-serif" },
  { id: 'roboto', label: 'Roboto', stack: "Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace" },
]
export const DEFAULT_FONT_FAMILY = FONT_PRESETS[0].stack

interface UIStore {
  theme: Theme
  locale: Locale
  fontSize: number
  fontFamily: string
  accentColor: string
  leftPanelWidth: number
  splitPosition: number
  isLeftPanelCollapsed: boolean
  activeSidebarPage: SidebarPage
  showImportModal: boolean
  showEnvironmentModal: boolean
  showSettingsModal: boolean
  showCodeGenerator: boolean
  showCollectionRunner: boolean
  showUpdateModal: boolean
  showSaveModal: boolean
  showNewProjectModal: boolean
  showEndpointSaveModal: boolean
  showProjectDetailModal: boolean
  showHistoryPanel: boolean
  showConsolePanel: boolean
  showProfileModal: boolean
  gitLoading: string | null  // null = idle, string = message to display
  addEndpointsSuiteId: string | null
  addEndpointsSuiteName: string | null

  setTheme: (theme: Theme) => void
  setLocale: (locale: Locale) => void
  setFontSize: (size: number) => void
  setFontFamily: (value: string) => void
  setAccentColor: (color: string) => void
  hydrateFromSettings: () => Promise<void>
  setLeftPanelWidth: (width: number) => void
  setSplitPosition: (position: number) => void
  toggleLeftPanel: () => void
  setLeftPanelCollapsed: (collapsed: boolean) => void
  setActiveSidebarPage: (page: SidebarPage) => void
  setShowImportModal: (show: boolean) => void
  setShowEnvironmentModal: (show: boolean) => void
  setShowSettingsModal: (show: boolean) => void
  setShowCodeGenerator: (show: boolean) => void
  setShowCollectionRunner: (show: boolean) => void
  setShowUpdateModal: (show: boolean) => void
  setShowSaveModal: (show: boolean) => void
  setShowNewProjectModal: (show: boolean) => void
  setShowEndpointSaveModal: (show: boolean) => void
  setShowProjectDetailModal: (show: boolean) => void
  setShowHistoryPanel: (show: boolean) => void
  setShowConsolePanel: (show: boolean) => void
  toggleConsolePanel: () => void
  setShowProfileModal: (show: boolean) => void
  setGitLoading: (msg: string | null) => void
  setAddEndpointsSuite: (suiteId: string | null, suiteName?: string | null) => void
}

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
}

function applyFontFamily(value: string): void {
  const stack = value && value.trim().length > 0 ? value : DEFAULT_FONT_FAMILY
  document.documentElement.style.setProperty('--font-sans', stack)
}

function applyFontSize(size: number): void {
  const clamped = Math.max(10, Math.min(20, size))
  document.documentElement.style.setProperty('--font-size-base', `${clamped}px`)
  // Also set root font-size as a safety net so anything relying on rem inherits
  document.documentElement.style.fontSize = `${clamped}px`
}

function applyAccent(color: string): void {
  document.documentElement.style.setProperty('--accent', color)
  document.documentElement.style.setProperty('--accent-text', color)
  document.documentElement.style.setProperty('--send-bg', color)
}

// Safe settings bridge
interface SettingsApi {
  get?: (key: string) => Promise<{ success: boolean; data?: unknown }>
  set?: (key: string, value: unknown) => Promise<{ success: boolean }>
}
function settingsApi(): SettingsApi | null {
  const w = window as unknown as { api?: { settings?: SettingsApi } }
  return w.api?.settings ?? null
}
async function persistSetting(key: string, value: unknown): Promise<void> {
  try { await settingsApi()?.set?.(key, value) } catch { /* noop */ }
}

export const useUIStore = create<UIStore>((set) => ({
  theme: 'light',
  locale: 'en' as Locale,
  fontSize: 13,
  fontFamily: DEFAULT_FONT_FAMILY,
  accentColor: '#2D5FA0',
  leftPanelWidth: 260,
  splitPosition: 50,
  isLeftPanelCollapsed: false,
  activeSidebarPage: 'apis',
  showImportModal: false,
  showEnvironmentModal: false,
  showSettingsModal: false,
  showCodeGenerator: false,
  showCollectionRunner: false,
  showUpdateModal: false,
  showSaveModal: false,
  showNewProjectModal: false,
  showEndpointSaveModal: false,
  showProjectDetailModal: false,
  showHistoryPanel: false,
  showConsolePanel: false,
  showProfileModal: false,
  gitLoading: null,
  addEndpointsSuiteId: null,
  addEndpointsSuiteName: null,

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    void persistSetting('ui.theme', theme)
  },

  setLocale: (locale) => {
    setI18nLocale(locale)
    set({ locale })
    void persistSetting('ui.locale', locale)
  },

  setFontSize: (size) => {
    const clamped = Math.max(10, Math.min(20, size))
    applyFontSize(clamped)
    set({ fontSize: clamped })
    void persistSetting('ui.fontSize', clamped)
  },

  setFontFamily: (value) => {
    applyFontFamily(value)
    set({ fontFamily: value })
    void persistSetting('ui.fontFamily', value)
  },

  setAccentColor: (color) => {
    applyAccent(color)
    set({ accentColor: color })
    void persistSetting('ui.accentColor', color)
  },

  hydrateFromSettings: async () => {
    try {
      const api = settingsApi()
      if (!api?.get) return
      const keys = ['ui.theme', 'ui.locale', 'ui.fontSize', 'ui.fontFamily', 'ui.accentColor'] as const
      const results = await Promise.all(keys.map((k) => api.get!(k)))
      const [themeRes, localeRes, sizeRes, familyRes, accentRes] = results
      const patch: Partial<UIStore> = {}
      const themeVal = themeRes?.data as Theme | undefined
      if (themeVal === 'light' || themeVal === 'dark' || themeVal === 'system') {
        applyTheme(themeVal)
        patch.theme = themeVal
      } else {
        applyTheme('light')
      }
      const localeVal = localeRes?.data as Locale | undefined
      if (localeVal === 'en' || localeVal === 'tr') {
        setI18nLocale(localeVal)
        patch.locale = localeVal
      }
      const sizeVal = sizeRes?.data
      if (typeof sizeVal === 'number' && sizeVal >= 10 && sizeVal <= 20) {
        applyFontSize(sizeVal)
        patch.fontSize = sizeVal
      } else {
        applyFontSize(13)
      }
      const familyVal = familyRes?.data
      if (typeof familyVal === 'string' && familyVal.trim().length > 0) {
        applyFontFamily(familyVal)
        patch.fontFamily = familyVal
      } else {
        applyFontFamily(DEFAULT_FONT_FAMILY)
      }
      const accentVal = accentRes?.data
      if (typeof accentVal === 'string' && /^#[0-9a-fA-F]{6}$/.test(accentVal)) {
        applyAccent(accentVal)
        patch.accentColor = accentVal
      }
      set(patch)
    } catch { /* noop */ }
  },

  setLeftPanelWidth: (width) =>
    set({ leftPanelWidth: Math.max(180, Math.min(400, width)) }),

  setSplitPosition: (position) =>
    set({ splitPosition: Math.max(22, Math.min(78, position)) }),

  toggleLeftPanel: () =>
    set((state) => ({ isLeftPanelCollapsed: !state.isLeftPanelCollapsed })),

  setLeftPanelCollapsed: (collapsed) => set({ isLeftPanelCollapsed: collapsed }),

  setActiveSidebarPage: (page) => set({ activeSidebarPage: page }),

  setShowImportModal: (show) => set({ showImportModal: show }),
  setShowEnvironmentModal: (show) => set({ showEnvironmentModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowCodeGenerator: (show) => set({ showCodeGenerator: show }),
  setShowCollectionRunner: (show) => set({ showCollectionRunner: show }),
  setShowUpdateModal: (show) => set({ showUpdateModal: show }),
  setShowSaveModal: (show) => set({ showSaveModal: show }),
  setShowNewProjectModal: (show) => set({ showNewProjectModal: show }),
  setShowEndpointSaveModal: (show) => set({ showEndpointSaveModal: show }),
  setShowProjectDetailModal: (show) => set({ showProjectDetailModal: show }),
  setShowHistoryPanel: (show) => set({ showHistoryPanel: show }),
  setShowConsolePanel: (show) => set({ showConsolePanel: show }),
  toggleConsolePanel: () => set((s) => ({ showConsolePanel: !s.showConsolePanel })),
  setShowProfileModal: (show) => set({ showProfileModal: show }),
  setGitLoading: (msg) => set({ gitLoading: msg }),
  setAddEndpointsSuite: (suiteId, suiteName) => set({ addEndpointsSuiteId: suiteId, addEndpointsSuiteName: suiteName ?? null }),
}))

// Apply initial theme + font defaults. Real values are loaded via hydrateFromSettings()
// which the app bootstrap invokes once the settings bridge is available.
applyTheme('light')
applyFontFamily(DEFAULT_FONT_FAMILY)
applyFontSize(13)
