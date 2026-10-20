/**
 * Mocks page centre when no tab is open (issue #226).
 *
 * The project has no mock server of any kind (HTTP, MCP, SSE, AI) → an empty
 * state with ONE primary action, "New mock server", that opens the same
 * dialog as the sidebar "+". Otherwise — and while the lists are not yet
 * known for the active project ("unknown" is not "empty") — the line that
 * points at the left panel. Both lists are loaded here too: with the sidebar
 * collapsed nothing else would load them (both stores drop stale answers).
 */
import { useEffect, useState } from 'react'
import { Plus, Server } from 'lucide-react'
import EmptyState from '../shared/EmptyState'
import { useTranslation } from '../../lib/i18n'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMockStore } from '../../stores/mock.store'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import NewMockServerModal from './NewMockServerModal'

export default function MocksWelcome() {
  const { t } = useTranslation()
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const httpFor = useMockStore((s) => s.projectId)
  const httpCount = useMockStore((s) => s.servers.length)
  const loadHttp = useMockStore((s) => s.loadServers)
  const mcpFor = useMockMcpStore((s) => s.projectId)
  const mcpCount = useMockMcpStore((s) => s.servers.length)
  const loadMcp = useMockMcpStore((s) => s.loadServers)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!projectId) return
    void loadHttp(projectId)
    void loadMcp(projectId)
  }, [projectId, loadHttp, loadMcp])

  const known = projectId !== null && httpFor === projectId && mcpFor === projectId
  const empty = known && httpCount === 0 && mcpCount === 0

  return (
    <>
      {empty ? (
        <EmptyState
          icon={Server}
          title={t('welcome.mocksEmptyTitle')}
          description={t('welcome.mocksEmptyDesc')}
          action={{
            label: t('mock.newServer'),
            icon: Plus,
            onClick: () => setCreating(true),
            testId: 'mocks-empty-new',
          }}
        />
      ) : (
        <EmptyState icon={Server} title={t('welcome.mocks')} />
      )}
      {creating && <NewMockServerModal initialKind="http" onClose={() => setCreating(false)} />}
    </>
  )
}
