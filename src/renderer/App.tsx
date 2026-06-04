import { useEffect } from 'react'
import { Toaster } from 'sonner'
import AppShell from './components/layout/AppShell'
import EulaConsentGate from './components/eula/EulaConsentGate'
import { useUIStore } from './stores/ui.store'
import { initUpdaterListeners } from './stores/updater.store'
import { initConsoleListeners } from './stores/console.store'

function App(): React.JSX.Element {
  const hydrateFromSettings = useUIStore((s) => s.hydrateFromSettings)
  useEffect(() => {
    void hydrateFromSettings()
    const cleanupUpdater = initUpdaterListeners()
    const cleanupConsole = initConsoleListeners()
    return () => {
      cleanupUpdater?.()
      cleanupConsole()
    }
  }, [hydrateFromSettings])
  return (
    <EulaConsentGate>
      <AppShell />
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
