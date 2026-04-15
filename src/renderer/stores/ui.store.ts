import { create } from 'zustand'
import type { Theme, Language } from '../types'

type Locale = Language
type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'settings'

interface UIStore {
  theme: Theme
  locale: Locale
  fontSize: number
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

  setTheme: (theme: Theme) => void
  setLocale: (locale: Locale) => void
  setFontSize: (size: number) => void
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
}

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
}

export const useUIStore = create<UIStore>((set) => ({
  theme: 'light',
  locale: 'en' as Locale,
  fontSize: 14,
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

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },

  setLocale: (locale) => set({ locale }),

  setFontSize: (size) => {
    const clamped = Math.max(10, Math.min(20, size))
    document.documentElement.style.fontSize = `${clamped}px`
    set({ fontSize: clamped })
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
}))

// Apply initial theme
applyTheme('light')
