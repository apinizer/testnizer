/**
 * "MCP servers" group of the Mocks panel (issue #140): lists the active
 * project's Mock MCP servers beside the HTTP mocks, with a preset "New" menu.
 * Opening a row opens its `mockMcpServer` tab in the Workbench.
 */
import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type { MockMcpServer } from '../../types/mock-mcp'
import MockMcpNewMenu from './MockMcpNewMenu'
import MockMcpServerRow from './MockMcpServerRow'
import { buildPresetInput, type MockMcpPresetId } from './mock-mcp-presets'
import { closeMockMcpServerTab, openMockMcpServerTab } from './mock-mcp-tabs'

const EMPTY: readonly MockMcpServer[] = []

export default function MockMcpServersSection({ query }: { query: string }) {
  const { t } = useTranslation()
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const allServers = useMockMcpStore((s) => s.servers)
  const loadedFor = useMockMcpStore((s) => s.projectId)
  const loadServers = useMockMcpStore((s) => s.loadServers)
  const createServer = useMockMcpStore((s) => s.createServer)
  const deleteServer = useMockMcpStore((s) => s.deleteServer)
  const [deleteTarget, setDeleteTarget] = useState<MockMcpServer | null>(null)

  useEffect(() => {
    if (projectId) void loadServers(projectId)
  }, [projectId, loadServers])

  // Never show the previous project's list while the new one loads.
  const servers = loadedFor && loadedFor === projectId ? allServers : EMPTY
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? servers.filter((s) => s.name.toLowerCase().includes(q)) : servers
  }, [servers, query])

  async function handleCreate(preset: MockMcpPresetId): Promise<void> {
    if (!projectId) {
      toast.error(t('mock.noActiveProject'))
      return
    }
    const input = buildPresetInput(preset, {
      projectId,
      takenNames: servers.map((s) => s.name),
      takenPorts: servers.map((s) => s.port),
    })
    const r = await createServer(input)
    if (!r.server) {
      toast.error(`${t('mockMcp.createFailed')}: ${r.error}`)
      return
    }
    openMockMcpServerTab(r.server)
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    const err = await deleteServer(target.id)
    if (err) {
      toast.error(err)
      return
    }
    closeMockMcpServerTab(target.id)
  }

  return (
    <section data-testid="mock-mcp-section" className="border-t border-[var(--border)]">
      <div className="flex h-9 items-center gap-2 px-3">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {t('mockMcp.sectionTitle')}
        </span>
        <MockMcpNewMenu onCreate={(p) => void handleCreate(p)} disabled={!projectId} />
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 pb-4 pt-1 text-center text-[12px] text-[var(--muted)]">
          {servers.length === 0 ? t('mockMcp.empty') : t('mock.noMatches')}
        </div>
      ) : (
        filtered.map((s) => (
          <MockMcpServerRow
            key={s.id}
            server={s}
            onOpen={openMockMcpServerTab}
            onDelete={setDeleteTarget}
          />
        ))
      )}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        itemName={deleteTarget?.name ?? ''}
        itemType={t('mockMcp.itemType')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}
