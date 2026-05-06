import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
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
  return <AppShell />
}

export default App
