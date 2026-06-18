import { create } from 'zustand'
import type { Theme, Language } from '../types'
import { setLocale as setI18nLocale } from '../lib/i18n'

type Locale = Language
type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'tools' | 'mocks' | 'settings'
export type RightPanelTab = 'variables' | 'code'

// Preset font stacks offered as quick picks. The stored `fontFamily` is always
// a raw CSS font-family value — users may type any stack they like.
export const FONT_PRESETS: Array<{ id: string; label: string; stack: string }> = [
  { id: 'inter', label: 'Inter', stack: "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif" },
  {
    id: 'system',
    label: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  { id: 'sfpro', label: 'SF Pro', stack: "'SF Pro Text', -apple-system, system-ui, sans-serif" },
  {
    id: 'roboto',
    label: 'Roboto',
    stack: "Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
]
export const DEFAULT_FONT_FAMILY = FONT_PRESETS[0].stack

interface UIStore {
  theme: Theme
  locale: Locale
  fontSize: number
  fontFamily: string
  accentColor: string
  leftPanelWidth: number
  rightPanelWidth: number
  splitPosition: number
  isLeftPanelCollapsed: boolean
  activeSidebarPage: SidebarPage
  showImportModal: boolean
  // When the import modal opens with a pre-selected format ID, ImportModal
  // skips step 1 (format picker) and lands the user directly on step 2
  // (file / URL source). Cleared on close.
  importModalInitialFormatId: string | null
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
  consolePanelMaximized: boolean
  showProfileModal: boolean
  showAboutModal: boolean
  showEnterpriseModal: boolean
  showCommandPalette: boolean
  showShortcutCheatsheet: boolean
  gitLoading: string | null // null = idle, string = message to display
  /** Global transient status message (footer/header) with TTL auto-clear. */
  statusMessage: string | null
  addEndpointsSuiteId: string | null
  addEndpointsSuiteName: string | null
  rightPanelCollapsed: boolean
  rightPanelTab: RightPanelTab

  setTheme: (theme: Theme) => void
  setLocale: (locale: Locale) => void
  setFontSize: (size: number) => void
  setFontFamily: (value: string) => void
  setAccentColor: (color: string) => void
  hydrateFromSettings: () => Promise<void>
  setLeftPanelWidth: (width: number) => void
  setRightPanelWidth: (width: number) => void
  /** Persist the current left/right panel widths (called once on drag end). */
  commitPanelWidths: () => void
  setSplitPosition: (position: number) => void
  toggleLeftPanel: () => void
  setLeftPanelCollapsed: (collapsed: boolean) => void
  setActiveSidebarPage: (page: SidebarPage) => void
  setShowImportModal: (show: boolean, initialFormatId?: string | null) => void
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
  toggleConsolePanelMaximized: () => void
  setShowProfileModal: (show: boolean) => void
  setShowAboutModal: (show: boolean) => void
  setShowEnterpriseModal: (show: boolean) => void
  setShowCommandPalette: (show: boolean) => void
  setShowShortcutCheatsheet: (show: boolean) => void
  setGitLoading: (msg: string | null) => void
  /**
   * Transient bottom-of-screen / header status message. Auto-clears after
   * `ttlMs` (default 6 s) so a previous import banner can never get stuck
   * on screen — v1.3.1 B18 ("Oracle Employee (imported)" persisted across
   * a subsequent Insomnia import).
   */
  setStatusMessage: (text: string | null, ttlMs?: number) => void
  setAddEndpointsSuite: (suiteId: string | null, suiteName?: string | null) => void
  setRightPanelCollapsed: (collapsed: boolean) => void
  toggleRightPanel: () => void
  setRightPanelTab: (tab: RightPanelTab) => void
}

function applyTheme(theme: Theme): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
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
function settingsApi() {
  return window.api?.settings ?? null
}
async function persistSetting(key: string, value: unknown): Promise<void> {
  try {
    await settingsApi()?.set?.(key, value)
  } catch {
    /* noop */
  }
}

export const useUIStore = create<UIStore>((set, get) => ({
  theme: 'light',
  locale: 'en' as Locale,
  fontSize: 13,
  fontFamily: DEFAULT_FONT_FAMILY,
  accentColor: '#2D5FA0',
  leftPanelWidth: 300,
  rightPanelWidth: 300,
  splitPosition: 50,
  isLeftPanelCollapsed: false,
  activeSidebarPage: 'apis',
  showImportModal: false,
  importModalInitialFormatId: null,
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
  consolePanelMaximized: false,
  showProfileModal: false,
  showAboutModal: false,
  showEnterpriseModal: false,
  showCommandPalette: false,
  showShortcutCheatsheet: false,
  gitLoading: null,
  statusMessage: null,
  addEndpointsSuiteId: null,
  addEndpointsSuiteName: null,
  rightPanelCollapsed: false,
  rightPanelTab: 'variables',

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
      const keys = [
        'ui.theme',
        'ui.locale',
        'ui.fontSize',
        'ui.fontFamily',
        'ui.accentColor',
        'ui.leftPanelWidth',
        'ui.rightPanelWidth',
      ] as const
      const results = await Promise.all(keys.map((k) => api.get!(k)))
      const [themeRes, localeRes, sizeRes, familyRes, accentRes, leftWRes, rightWRes] = results
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
      const leftW = leftWRes?.data
      if (typeof leftW === 'number' && leftW >= 200 && leftW <= 600) patch.leftPanelWidth = leftW
      const rightW = rightWRes?.data
      if (typeof rightW === 'number' && rightW >= 240 && rightW <= 600)
        patch.rightPanelWidth = rightW
      set(patch)
    } catch {
      /* noop */
    }
  },

  // Live setters during a drag — set-only (no persist) so dragging stays
  // smooth. `commitPanelWidths` persists the final values once on mouse-up.
  setLeftPanelWidth: (width) => set({ leftPanelWidth: Math.max(200, Math.min(600, width)) }),

  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(240, Math.min(600, width)) }),

  commitPanelWidths: () => {
    const { leftPanelWidth, rightPanelWidth } = get()
    void persistSetting('ui.leftPanelWidth', leftPanelWidth)
    void persistSetting('ui.rightPanelWidth', rightPanelWidth)
  },

  setSplitPosition: (position) => set({ splitPosition: Math.max(22, Math.min(78, position)) }),

  toggleLeftPanel: () => set((state) => ({ isLeftPanelCollapsed: !state.isLeftPanelCollapsed })),

  setLeftPanelCollapsed: (collapsed) => set({ isLeftPanelCollapsed: collapsed }),

  setActiveSidebarPage: (page) => {
    // Remember the last-active tab for the page we're leaving, then restore
    // the previously-active tab for the page we're entering. v1.3.1 B13
    // (R-6 regression): switching APIs → Tests → APIs reopened the welcome
    // surface instead of the endpoint preview tab that had been visible
    // before the round trip. We delegate to tabs.store so the move stays in
    // sync with whatever tab cleanup happens elsewhere.
    void import('./tabs.store').then(({ useTabsStore }) => {
      useTabsStore.getState().rememberAndRestoreForPage(page)
    })
    set((state) => ({
      activeSidebarPage: page,
      // Tests-only overlays must not survive a workbench switch — otherwise
      // the Workbench keeps rendering the AddEndpoints view over the new page.
      addEndpointsSuiteId: page === 'tests' ? state.addEndpointsSuiteId : null,
      addEndpointsSuiteName: page === 'tests' ? state.addEndpointsSuiteName : null,
    }))
  },

  setShowImportModal: (show, initialFormatId) =>
    set({
      showImportModal: show,
      // Reset on close so a later "plain" open of the modal lands back on
      // step 1; preserve only when explicitly provided.
      importModalInitialFormatId: show ? (initialFormatId ?? null) : null,
    }),
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
  toggleConsolePanelMaximized: () =>
    set((s) => ({ consolePanelMaximized: !s.consolePanelMaximized })),
  setShowProfileModal: (show) => set({ showProfileModal: show }),
  setShowAboutModal: (show) => set({ showAboutModal: show }),
  setShowEnterpriseModal: (show) => set({ showEnterpriseModal: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowShortcutCheatsheet: (show) => set({ showShortcutCheatsheet: show }),
  setGitLoading: (msg) => set({ gitLoading: msg }),
  setStatusMessage: (text, ttlMs = 6000) => {
    set({ statusMessage: text })
    if (text) {
      // Schedule an auto-clear so a stale banner can't outlive its
      // relevance. We compare against `text` at clear-time so two rapid
      // overlapping calls don't trample each other — only the most recent
      // text is actually cleared by its own timer.
      const target = text
      const timer = window.setTimeout(() => {
        if (useUIStore.getState().statusMessage === target) {
          useUIStore.setState({ statusMessage: null })
        }
      }, ttlMs)
      // Best-effort cleanup if the user navigates away — non-blocking.
      void timer
    }
  },
  setAddEndpointsSuite: (suiteId, suiteName) =>
    set({ addEndpointsSuiteId: suiteId, addEndpointsSuiteName: suiteName ?? null }),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab, rightPanelCollapsed: false }),
}))

// Apply initial theme + font defaults. Real values are loaded via hydrateFromSettings()
// which the app bootstrap invokes once the settings bridge is available.
applyTheme('light')
applyFontFamily(DEFAULT_FONT_FAMILY)
applyFontSize(13)
