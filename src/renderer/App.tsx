import { useEffect } from 'react'
import { Toaster } from 'sonner'
import AppShell from './components/layout/AppShell'
import AboutModal from './components/modals/AboutModal'
import EulaConsentGate from './components/eula/EulaConsentGate'
import { useUIStore } from './stores/ui.store'
import { useWorkspaceStore } from './stores/workspace.store'
import { initUpdaterListeners } from './stores/updater.store'
import { initConsoleListeners } from './stores/console.store'
import { useAutoUpdater } from './lib/use-auto-updater'

function App(): React.JSX.Element {
  const hydrateFromSettings = useUIStore((s) => s.hydrateFromSettings)
  const setShowAboutModal = useUIStore((s) => s.setShowAboutModal)
  // Drive the "Automatically check / download updates" toggles from the active
  // project's settings (previously inert — nothing read them).
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  useAutoUpdater(activeProjectId)
  useEffect(() => {
    void hydrateFromSettings()
    const cleanupUpdater = initUpdaterListeners()
    const cleanupConsole = initConsoleListeners()
    // Native "About Testnizer" menu → in-app AboutModal. Registered at the
    // root (not in AppShell) so it also fires on the login / welcome screen,
    // where AppShell isn't mounted (user-reported: About did nothing pre-login).
    const cleanupAbout = window.api?.app?.onOpenAbout?.(() => {
      setShowAboutModal(true)
    })
    return () => {
      cleanupUpdater?.()
      cleanupConsole()
      cleanupAbout?.()
    }
  }, [hydrateFromSettings, setShowAboutModal])
  return (
    <EulaConsentGate>
      <AppShell />
      {/* Mounted at the root (outside AppShell) so the native "About
          Testnizer" menu works on the login / welcome screen too. */}
      <AboutModal />
      {/* Toaster mounted at top level so toasts can layer above any modal.
          Modals use zIndex up to ~9999; we set 10001 to stay above. */}
      <Toaster
        richColors
        position="bottom-right"
        closeButton
        toastOptions={{ style: { zIndex: 10001 } }}
      />
    </EulaConsentGate>
  )
}

export default App
