import { useEffect } from 'react'
import IconSidebar from './IconSidebar'
import Header from './Header'
import LeftPanel from './LeftPanel'
import Workbench from './Workbench'
import Footer from './Footer'
import ProjectHome from './ProjectHome'
import ImportModal from '../modals/ImportModal'
import EnvironmentModal from '../modals/EnvironmentModal'
import SettingsModal from '../modals/SettingsModal'
import CodeGeneratorModal from '../modals/CodeGeneratorModal'
import UpdateModal from '../modals/UpdateModal'
import SaveModal from '../modals/SaveModal'
import NewProjectModal from '../modals/NewProjectModal'
import EndpointSaveModal from '../modals/EndpointSaveModal'
import ProjectDetailModal from '../modals/ProjectDetailModal'
import ProfileModal from '../modals/ProfileModal'
import AboutModal from '../modals/AboutModal'
import MergeConflictModal from '../modals/MergeConflictModal'
import ShortcutCheatsheetModal from '../modals/ShortcutCheatsheetModal'
import CommandPalette from '../shared/CommandPalette'
import ConsolePanel from './ConsolePanel'
import LoginScreen from '../auth/LoginScreen'
import QuickTestShell from './QuickTestShell'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useAuthStore } from '../../stores/auth.store'
import { useKeyboardShortcuts } from '../../lib/keyboard-shortcuts'

function GitLoadingOverlay() {
  const gitLoading = useUIStore((s) => s.gitLoading)
  if (!gitLoading) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="flex flex-col items-center gap-4 rounded-2xl px-10 py-8"
        style={{ background: 'var(--white)', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{gitLoading}</div>
      </div>
    </div>
  )
}

export default function AppShell() {
  const isLeftPanelCollapsed = useUIStore((s) => s.isLeftPanelCollapsed)
  const activeSidebarPage = useUIStore((s) => s.activeSidebarPage)
  const showCommandPalette = useUIStore((s) => s.showCommandPalette)
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const initialized = useWorkspaceStore((s) => s.initialized)
  const initialize = useWorkspaceStore((s) => s.initialize)

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isGuest = useAuthStore((s) => s.isGuest)
  const hasPasswordSet = useAuthStore((s) => s.hasPasswordSet)
  const authLoading = useAuthStore((s) => s.isLoading)
  const checkSession = useAuthStore((s) => s.checkSession)

  useKeyboardShortcuts()

  // Check auth session on mount
  useEffect(() => {
    checkSession()
  }, [checkSession])

  useEffect(() => {
    if (isAuthenticated && !isGuest) {
      initialize()
    }
  }, [initialize, isAuthenticated, isGuest])

  // Auth loading state
  if (authLoading) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    )
  }

  // Not authenticated — show login screen
  if (!isAuthenticated) {
    return <LoginScreen />
  }

  // Guest mode with password set = Quick Test only (no project access)
  if (isGuest && hasPasswordSet) {
    return <QuickTestShell />
  }

  // Guest mode without password = full access (initialize workspace)
  if (isGuest && !hasPasswordSet) {
    // Need to initialize for full access
    if (!initialized) {
      initialize()
      return (
        <div
          className="flex h-screen w-screen items-center justify-center"
          style={{ background: 'var(--bg)', color: 'var(--muted)' }}
        >
          <div>Loading...</div>
        </div>
      )
    }
  }

  if (!initialized) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
      >
        <div>Loading...</div>
      </div>
    )
  }

  // No project selected — show home/project selection
  if (!activeProjectId) {
    return (
      <div
        className="flex h-screen w-screen overflow-hidden"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
        <ProjectHome />
        <SettingsModal />
        <UpdateModal />
        <NewProjectModal />
        <ProfileModal />
        <AboutModal />
        <CommandPalette open={showCommandPalette} onOpenChange={setShowCommandPalette} />
        <ShortcutCheatsheetModal />
      </div>
    )
  }

  // Project is active — full layout
  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Header — full width, 44px */}
      <Header />

      {/* Body — sidebar + content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Icon Sidebar — 64px, no top border, starts below header */}
        <IconSidebar />

        {/* Left Panel — collection tree or history */}
        {(!isLeftPanelCollapsed ||
          activeSidebarPage === 'history' ||
          activeSidebarPage === 'tests') && <LeftPanel />}

        {/* Workbench — flex:1 */}
        <Workbench />
      </div>

      {/* Console Panel — absolute, slides up above footer */}
      <ConsolePanel />

      {/* Footer — full width, 28px */}
      <Footer />

      {/* Modals */}
      <ImportModal />
      <EnvironmentModal />
      <SettingsModal />
      <CodeGeneratorModal />
      <UpdateModal />
      <SaveModal />
      <NewProjectModal />
      <EndpointSaveModal />
      <ProjectDetailModal />
      <ProfileModal />
      <AboutModal />
      <MergeConflictModal />
      <ShortcutCheatsheetModal />
      <CommandPalette open={showCommandPalette} onOpenChange={setShowCommandPalette} />

      {/* Git loading overlay */}
      <GitLoadingOverlay />
    </div>
  )
}
