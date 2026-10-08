/**
 * Sidebar panel that lists all mock servers in the active project: header +
 * search + two groups (HTTP servers, MCP servers — issue #140) that share one
 * row design. Every "+" (header, and the small one on each group) opens the
 * same "New mock server" dialog, with the group's type preselected.
 */
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import MockMcpServersSection from '../mock-mcp/MockMcpServersSection'
import MockHttpServersSection from './MockHttpServersSection'
import NewMockServerModal from './NewMockServerModal'
import type { MockKind } from './new-mock-server'

export default function MockServersPanel() {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const loadServers = useMockStore((s) => s.loadServers)
  const [query, setQuery] = useState('')
  // The kind preselected in the open "New mock server" dialog; null = closed.
  const [newKind, setNewKind] = useState<MockKind | null>(null)

  useEffect(() => {
    if (activeProjectId) void loadServers(activeProjectId)
  }, [activeProjectId, loadServers])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-2.5">
        <span className="flex-1 text-[15px] font-bold text-[var(--text)]">
          {t('mock.sidebarTitle')}
        </span>
        <button
          type="button"
          data-testid="mock-new"
          onClick={() => setNewKind('http')}
          title={t('mock.newServer')}
          aria-label={t('mock.newServer')}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] border-none bg-[var(--accent)] text-white"
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
      </div>

      {/* Search — filters both groups */}
      <div className="border-b border-[var(--border)] px-2.5 py-2">
        <input
          data-testid="mock-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('mock.searchServers')}
          className="w-full rounded-lg border-[1.5px] border-[var(--border2)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <MockHttpServersSection
          query={query}
          onAdd={() => setNewKind('http')}
          disabled={!activeProjectId}
        />
        <MockMcpServersSection query={query} onAdd={() => setNewKind('mcp')} />
      </div>

      {newKind && <NewMockServerModal initialKind={newKind} onClose={() => setNewKind(null)} />}
    </div>
  )
}
