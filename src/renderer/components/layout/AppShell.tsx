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
import CollectionRunnerModal from '../modals/CollectionRunnerModal'
import UpdateModal from '../modals/UpdateModal'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useKeyboardShortcuts } from '../../lib/keyboard-shortcuts'

export default function AppShell() {
  const isLeftPanelCollapsed = useUIStore((s) => s.isLeftPanelCollapsed)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const initialized = useWorkspaceStore((s) => s.initialized)
  const initialize = useWorkspaceStore((s) => s.initialize)

  useKeyboardShortcuts()

  // Initialize workspace data from DB on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Show loading state while initializing
  if (!initialized) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ background: 'var(--bg)', color: 'var(--muted)' }}
      >
        <div className="text-[0.825rem]">Loading...</div>
      </div>
    )
  }

  // No project selected — show home/project selection
  if (!activeProjectId) {
    return (
      <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <ProjectHome />

        {/* Modals still available */}
        <SettingsModal />
        <UpdateModal />
      </div>
    )
  }

  // Project is active — show main workspace
  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Icon Sidebar — 80px (Apidog nav rail) */}
      <IconSidebar />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header tab bar — 44px */}
        <Header />

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel — 256px */}
          {!isLeftPanelCollapsed && <LeftPanel />}

          {/* Workbench */}
          <Workbench />
        </div>

        {/* Footer — 36px */}
        <Footer />
      </div>

      {/* Modals */}
      <ImportModal />
      <EnvironmentModal />
      <SettingsModal />
      <CodeGeneratorModal />
      <CollectionRunnerModal />
      <UpdateModal />
    </div>
  )
}
