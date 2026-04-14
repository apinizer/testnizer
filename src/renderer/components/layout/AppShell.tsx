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
import ConsolePanel from './ConsolePanel'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useKeyboardShortcuts } from '../../lib/keyboard-shortcuts'

export default function AppShell() {
  const isLeftPanelCollapsed = useUIStore((s) => s.isLeftPanelCollapsed)
  const activeSidebarPage = useUIStore((s) => s.activeSidebarPage)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const initialized = useWorkspaceStore((s) => s.initialized)
  const initialize = useWorkspaceStore((s) => s.initialize)

  useKeyboardShortcuts()

  useEffect(() => {
    initialize()
  }, [initialize])

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
        <SettingsModal />
        <UpdateModal />
        <NewProjectModal />
      </div>
    )
  }

  // Project is active — Apidog layout:
  // Header spans full width (including over sidebar area)
  // Below header: IconSidebar | LeftPanel | Workbench
  // Footer spans full width
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
        {(!isLeftPanelCollapsed || activeSidebarPage === 'history' || activeSidebarPage === 'tests') && <LeftPanel />}

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
    </div>
  )
}
