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
import EnterpriseModal from '../modals/EnterpriseModal'
import CollectionRunnerModal from '../modals/CollectionRunnerModal'
import MergeConflictModal from '../modals/MergeConflictModal'
import ShortcutCheatsheetModal from '../modals/ShortcutCheatsheetModal'
import CommandPalette from '../shared/CommandPalette'
import ConsolePanel from './ConsolePanel'
import LoginScreen from '../auth/LoginScreen'
import QuickTestShell from './QuickTestShell'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useAuthStore } from '../../stores/auth.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useKeyboardShortcuts } from '../../lib/keyboard-shortcuts'
import { makeTabId } from '../../lib/utils'
import { toast } from '../../lib/toast'
import { closeTabSafely } from '../../lib/cleanup-tab-state'

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
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)
  const setShowSettingsModal = useUIStore((s) => s.setShowSettingsModal)
  const setShowSaveModal = useUIStore((s) => s.setShowSaveModal)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const initialized = useWorkspaceStore((s) => s.initialized)
  const initialize = useWorkspaceStore((s) => s.initialize)

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isGuest = useAuthStore((s) => s.isGuest)
  const hasPasswordSet = useAuthStore((s) => s.hasPasswordSet)
  const authLoading = useAuthStore((s) => s.isLoading)
  const checkSession = useAuthStore((s) => s.checkSession)

  useKeyboardShortcuts()

  // NOTE: the native "About Testnizer" menu listener + the AboutModal mount
  // were lifted to App.tsx (root) so they also work on the login / welcome
  // screen, where AppShell isn't rendered (user-reported: About did nothing
  // before sign-in).

  // Native File-menu commands. Routes each Electron menu click to the
  // matching modal/action so File → Import, Settings, Save etc. work.
  useEffect(() => {
    const unsub = window.api?.app?.onMenuCommand?.((command) => {
      switch (command) {
        case 'menu:openImport':
          setShowImportModal(true)
          break
        case 'menu:openSettings':
          setShowSettingsModal(true)
          break
        case 'menu:save':
          setShowSaveModal(true)
          break
        case 'menu:newTab': {
          // Previously dispatched a `testnizer:newTab` custom event with
          // no listener attached anywhere — clicking File → New Tab
          // therefore did nothing. Drive the tabs store directly here so
          // the menu path actually opens a tab. (Ctrl+T is handled by
          // the renderer keyboard listener — the menu item no longer
          // carries an accelerator, so there's no double-fire.)
          const tabs = useTabsStore.getState()
          tabs.openTab({
            id: makeTabId(),
            name: 'New Request',
            protocol: 'http',
            method: 'GET',
            url: '',
          })
          break
        }
        case 'menu:closeTab': {
          // Route through `closeTabSafely` so File → Close Tab matches the
          // Ctrl+W path: prompt before discarding unsaved edits, tear down
          // protocol-store slices (and their live WS/SSE/gRPC subscriptions)
          // via `cleanupTabState`. The naive `tabs.closeTab(id)` we had here
          // was leaking those slices on every menu-driven close.
          const activeId = useTabsStore.getState().activeTabId
          if (activeId) closeTabSafely(activeId)
          break
        }
        case 'menu:openExport': {
          // Previously dispatched `testnizer:openExport` to a custom event
          // that had no listener anywhere — File → Export was a silent
          // no-op (same dead-event class as menu:newTab/menu:closeTab,
          // missed in the v1.4.4 menu pass). Drive the export IPC
          // directly: the main-side `save:exportProject` handler opens
          // a native save dialog and writes the JSON, so no modal is
          // needed here. Surface the outcome via toast.
          const projectId = useWorkspaceStore.getState().activeProjectId
          if (!projectId) {
            toast.error('No active project to export')
            break
          }
          void window.api?.save
            ?.exportProject(projectId)
            .then((res) => {
              const r = res as { success: boolean; error?: string; data?: { path?: string } }
              if (r?.success) {
                toast.success(r.data?.path ? `Exported to ${r.data.path}` : 'Exported')
              } else if (r?.error) {
                toast.error(`Export failed: ${r.error}`)
              }
            })
            .catch((err: Error) => {
              toast.error(`Export failed: ${err.message}`)
            })
          break
        }
      }
    })
    return () => {
      unsub?.()
    }
  }, [setShowImportModal, setShowSettingsModal, setShowSaveModal])

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
        data-testid="project-home"
        className="flex h-screen w-screen overflow-hidden"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
        <ProjectHome />
        <SettingsModal />
        <UpdateModal />
        <NewProjectModal />
        <ProfileModal />
        <CommandPalette open={showCommandPalette} onOpenChange={setShowCommandPalette} />
        <ShortcutCheatsheetModal />
      </div>
    )
  }

  // Project is active — full layout
  return (
    <div
      data-testid="workbench"
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
      <EnterpriseModal />
      <CollectionRunnerModal />
      <MergeConflictModal />
      <ShortcutCheatsheetModal />
      <CommandPalette open={showCommandPalette} onOpenChange={setShowCommandPalette} />

      {/* Git loading overlay */}
      <GitLoadingOverlay />
    </div>
  )
}
