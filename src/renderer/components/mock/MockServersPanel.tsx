/**
 * Sidebar panel that lists all mock servers in the active project: header +
 * search + one group per type — HTTP, MCP, SSE, AI (issues #140, #221), in
 * the dialog's order — that share one row design.
 *
 * Layout follows the APIs panel (LeftPanel.tsx): a 44px header, a search box
 * with a magnifier, sizes in px. Tailwind spacing is rem-based and the app
 * sets the root font size to the user's font size (13px by default), so
 * `h-11` would render ~36px and drift from the other panels — hence the
 * arbitrary `[px]` classes.
 *
 * The header "+" opens a type menu (`MockNewMenu`); every entry and each
 * group's hover "+" open the same "New mock server" dialog with that type
 * preselected. With no server at all the panel shows one empty state instead
 * of four empty groups — but only once BOTH lists of the active project have
 * landed, so it never flashes while loading or for the previous project.
 */
import { useEffect, useMemo, useState } from 'react'
import { Server } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMockStore } from '../../stores/mock.store'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import { normalizeMockServerKind } from '../../../shared/mock-kind'
import MockMcpServersSection from '../mock-mcp/MockMcpServersSection'
import MockKindServersSection from './MockKindServersSection'
import MockNewMenu from './MockNewMenu'
import NewMockServerModal from './NewMockServerModal'
import LeftPanelCollapseButton from '../layout/LeftPanelCollapseButton'
import { matchesMockQuery } from './mock-kind-ui'
import type { MockKind } from './new-mock-server'
import type { MockServer } from '../../types'
import type { MockMcpServer } from '../../types/mock-mcp'

const NO_HTTP: readonly MockServer[] = []
const NO_MCP: readonly MockMcpServer[] = []

export default function MockServersPanel() {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const loadServers = useMockStore((s) => s.loadServers)
  const httpAll = useMockStore((s) => s.servers)
  const httpLoadedFor = useMockStore((s) => s.projectId)
  const mcpAll = useMockMcpStore((s) => s.servers)
  const mcpLoadedFor = useMockMcpStore((s) => s.projectId)
  const [query, setQuery] = useState('')
  // The kind preselected in the open "New mock server" dialog; null = closed.
  const [newKind, setNewKind] = useState<MockKind | null>(null)

  useEffect(() => {
    if (activeProjectId) void loadServers(activeProjectId)
  }, [activeProjectId, loadServers])

  // A list counts only once it is the ACTIVE project's (the stores set
  // `projectId` when a load lands). Until both have landed the panel shows
  // neither the empty state nor the groups (which would still hold the
  // previous project's rows). A failed load never lands, so the panel then
  // stays blank under the search rather than claiming "no servers"; the
  // header "+" still works. No project → nothing to load: the empty state
  // shows with its button disabled.
  const loaded =
    !activeProjectId || (httpLoadedFor === activeProjectId && mcpLoadedFor === activeProjectId)
  const httpServers = httpLoadedFor && httpLoadedFor === activeProjectId ? httpAll : NO_HTTP
  const mcpServers = mcpLoadedFor && mcpLoadedFor === activeProjectId ? mcpAll : NO_MCP
  const total = httpServers.length + mcpServers.length
  const matchCount = useMemo(() => {
    if (!query.trim()) return total
    const http = httpServers.filter((s) =>
      matchesMockQuery(query, {
        name: s.name,
        kind: normalizeMockServerKind(s.kind),
        port: s.port,
      }),
    ).length
    const mcp = mcpServers.filter((s) =>
      matchesMockQuery(query, { name: s.name, kind: 'mcp', port: s.port }),
    ).length
    return http + mcp
  }, [query, total, httpServers, mcpServers])

  const panelEmpty = loaded && total === 0 && !query.trim()
  const noMatches = loaded && query.trim() !== '' && matchCount === 0

  return (
    <div className="flex h-full flex-col">
      {/* Header — 44px, same as the APIs panel */}
      <div className="flex h-[44px] shrink-0 items-center gap-[6px] border-b border-[var(--border)] px-[10px]">
        <span className="flex-1 text-[15px] font-bold text-[var(--text)]">
          {t('mock.sidebarTitle')}
        </span>
        <MockNewMenu disabled={!activeProjectId} onPick={setNewKind} />
        <LeftPanelCollapseButton />
      </div>

      {/* Search — filters every group; same box as the APIs panel */}
      <div className="shrink-0 border-b border-[var(--border)] px-[10px] py-[8px]">
        <div className="flex items-center gap-[7px] rounded-[8px] border-[1.5px] border-[var(--border2)] bg-[var(--surface)] px-[10px] py-[6px]">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="shrink-0 text-[var(--hint)]"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            data-testid="mock-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('mock.searchServers')}
            className="w-full border-none bg-transparent text-sm text-[var(--text)] outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {panelEmpty && (
          <div
            data-testid="mock-panel-empty"
            className="mx-3 mt-4 rounded-[7px] border border-dashed border-[var(--border2)] py-6 text-center"
          >
            <Server size={28} className="mx-auto mb-[8px] text-[var(--hint)]" />
            <div className="text-sm text-[var(--hint)]">{t('mock.panelEmptyTitle')}</div>
            <button
              type="button"
              data-testid="mock-panel-empty-create"
              disabled={!activeProjectId}
              onClick={() => setNewKind('http')}
              className="mt-2 cursor-pointer border-none bg-transparent text-sm font-medium text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('mock.panelEmptyCreate')}
            </button>
          </div>
        )}

        {noMatches && (
          <div
            data-testid="mock-no-matches"
            className="px-4 py-4 text-center text-sm text-[var(--muted)]"
          >
            {t('mock.noMatches')}
          </div>
        )}

        {/* The groups stay mounted while hidden: the MCP group loads its own
         *  list, so hiding them must not unmount it (nothing would land). */}
        <div hidden={!loaded || panelEmpty}>
          <MockKindServersSection
            kind="http"
            query={query}
            onAdd={() => setNewKind('http')}
            disabled={!activeProjectId}
          />
          <MockMcpServersSection query={query} onAdd={() => setNewKind('mcp')} />
          <MockKindServersSection
            kind="sse"
            query={query}
            onAdd={() => setNewKind('sse')}
            disabled={!activeProjectId}
          />
          <MockKindServersSection
            kind="ai"
            query={query}
            onAdd={() => setNewKind('ai')}
            disabled={!activeProjectId}
          />
        </div>
      </div>

      {newKind && <NewMockServerModal initialKind={newKind} onClose={() => setNewKind(null)} />}
    </div>
  )
}
