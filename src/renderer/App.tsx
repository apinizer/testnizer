import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { useUIStore } from './stores/ui.store'
import { initUpdaterListeners } from './stores/updater.store'

function App(): React.JSX.Element {
  const hydrateFromSettings = useUIStore((s) => s.hydrateFromSettings)
  useEffect(() => {
    void hydrateFromSettings()
    const cleanup = initUpdaterListeners()
    return cleanup
  }, [hydrateFromSettings])
  return <AppShell />
}

export default App
