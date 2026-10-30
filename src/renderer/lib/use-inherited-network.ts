import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useUIStore } from '../stores/ui.store'
import { loadInheritedNetwork, type InheritedNetwork } from './network-settings'

/**
 * The active project's inherited network settings (issue #287) for display —
 * the request Settings tab's "Inherited (project: off)" and Generate Code's
 * effective `-k`. Reloaded when the project changes and whenever one of the
 * two settings dialogs closes (that is where the inherited values change).
 * `null` until the first read lands.
 */
export function useInheritedNetwork(): InheritedNetwork | null {
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const projectModalOpen = useUIStore((s) => s.showProjectDetailModal)
  const settingsModalOpen = useUIStore((s) => s.showSettingsModal)
  const [net, setNet] = useState<InheritedNetwork | null>(null)

  useEffect(() => {
    if (projectModalOpen || settingsModalOpen) return
    let alive = true
    void loadInheritedNetwork(projectId).then((v) => {
      if (alive) setNet(v)
    })
    return () => {
      alive = false
    }
  }, [projectId, projectModalOpen, settingsModalOpen])

  return net
}
