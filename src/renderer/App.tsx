import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { useUIStore } from './stores/ui.store'

function App(): React.JSX.Element {
  const hydrateFromSettings = useUIStore((s) => s.hydrateFromSettings)
  useEffect(() => {
    void hydrateFromSettings()
  }, [hydrateFromSettings])
  return <AppShell />
}

export default App
