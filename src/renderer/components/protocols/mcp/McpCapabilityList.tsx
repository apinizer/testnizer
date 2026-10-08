import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import type { McpCapabilityTab } from '../../../types/mcp'
import { filterCapabilityItems, type McpListItem } from '../../../lib/mcp-store-helpers'
import McpCapabilityRow from './McpCapabilityRow'

const TABS: McpCapabilityTab[] = ['tools', 'resources', 'prompts']

/**
 * Left column of the MCP editor (issue #139): Tools | Resources | Prompts
 * tabs with counts, one search box filtering by name / title / description /
 * URI, and the matching list. Selecting a row drives the right pane.
 */
export default function McpCapabilityList() {
  const { t } = useTranslation()
  const tab = useMcpStore((s) => s.capabilityTab)
  const setTab = useMcpStore((s) => s.setCapabilityTab)
  const search = useMcpStore((s) => s.search)
  const setSearch = useMcpStore((s) => s.setSearch)
  const tools = useMcpStore((s) => s.tools)
  const resources = useMcpStore((s) => s.resources)
  const templates = useMcpStore((s) => s.resourceTemplates)
  const prompts = useMcpStore((s) => s.prompts)
  const isConnected = useMcpStore((s) => s.connectionState === 'connected')
  const selectedTool = useMcpStore((s) => s.selectedTool)
  const selectedResource = useMcpStore((s) => s.selectedResourceUri)
  const selectedPrompt = useMcpStore((s) => s.selectedPrompt)
  const setSelectedTool = useMcpStore((s) => s.setSelectedTool)
  const selectResource = useMcpStore((s) => s.selectResource)
  const setSelectedPrompt = useMcpStore((s) => s.setSelectedPrompt)

  const labels: Record<McpCapabilityTab, string> = {
    tools: t('mcp.tab.tools'),
    resources: t('mcp.tab.resources'),
    prompts: t('mcp.tab.prompts'),
  }
  const emptyLabels: Record<McpCapabilityTab, string> = {
    tools: t('mcp.list.emptyTools'),
    resources: t('mcp.list.emptyResources'),
    prompts: t('mcp.list.emptyPrompts'),
  }
  const counts: Record<McpCapabilityTab, number> = {
    tools: tools.length,
    resources: resources.length + templates.length,
    prompts: prompts.length,
  }

  const items = useMemo<McpListItem[]>(() => {
    if (tab === 'tools') return tools.map((item) => ({ kind: 'tool', key: item.name, item }))
    if (tab === 'prompts') return prompts.map((item) => ({ kind: 'prompt', key: item.name, item }))
    return [
      ...resources.map((item): McpListItem => ({ kind: 'resource', key: item.uri, item })),
      ...templates.map((item): McpListItem => ({ kind: 'template', key: item.uriTemplate, item })),
    ]
  }, [tab, tools, resources, templates, prompts])

  const filtered = filterCapabilityItems(items, search)
  const selectedKey =
    tab === 'tools' ? selectedTool : tab === 'prompts' ? selectedPrompt : selectedResource

  const onSelect = (entry: McpListItem): void => {
    if (entry.kind === 'tool') setSelectedTool(entry.key)
    else if (entry.kind === 'prompt') setSelectedPrompt(entry.key)
    else selectResource(entry.key)
  }

  let emptyText: string | null = null
  if (!isConnected && items.length === 0) emptyText = t('mcp.list.connectFirst')
  else if (items.length === 0) emptyText = emptyLabels[tab]
  else if (filtered.length === 0) emptyText = t('mcp.list.noMatches')

  return (
    <div
      data-testid="mcp-capability-list"
      className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r border-[var(--border)]"
    >
      <div role="tablist" className="flex shrink-0 border-b border-[var(--border)]">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`mcp-cap-tab-${id}`}
            onClick={() => setTab(id)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1 border-x-0 border-t-0 border-b-2 bg-transparent px-1 py-2 text-[12px] font-medium ${
              tab === id
                ? 'border-[var(--accent)] text-[var(--accent-text)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {labels[id]}
            <span className="rounded-full bg-[var(--surface)] px-1.5 text-[10px] text-[var(--muted)]">
              {counts[id]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-2.5 py-1.5">
        <Search size={13} className="shrink-0 text-[var(--muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="mcp-search"
          placeholder={t('mcp.list.search')}
          className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)]"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {emptyText ? (
          <div className="p-4 text-center text-[12px] text-[var(--hint)]">{emptyText}</div>
        ) : (
          filtered.map((entry, i) => (
            <McpCapabilityRow
              key={`${entry.kind}:${entry.key}`}
              entry={entry}
              selected={selectedKey === entry.key}
              showTemplateHeader={
                entry.kind === 'template' && (i === 0 || filtered[i - 1].kind !== 'template')
              }
              onSelect={() => onSelect(entry)}
            />
          ))
        )}
      </div>
    </div>
  )
}
