/**
 * Mock MCP Server editor (issue #140), opened as a `mockMcpServer` Workbench
 * tab. Tabs: General | Scenarios | Tools | Resources | Prompts | Logs.
 *
 * Edits go into a draft held by the store (it survives tab switches, which
 * unmount this component); Save sends ONE `update` and the backend
 * hot-reloads a running server. Ctrl/Cmd+S inside the editor saves too; both
 * go through `saveMockMcpDraft`, the same path the Workbench's unsaved-changes
 * dialog uses (issue #154).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { MockMcpDraftUpdater, MockMcpEditorTab } from '../../types/mock-mcp'
import { serverToDraft } from './mock-mcp-draft'
import { useMockMcpTabDirty } from './mock-mcp-tabs'
import { isMockMcpSaving, saveMockMcpDraft, type MockMcpSaveResult } from './mock-mcp-save'
import { isSaveChord } from './mock-mcp-format'
import MockMcpEditorHeader from './MockMcpEditorHeader'
import MockMcpGeneralTab from './MockMcpGeneralTab'
import MockMcpScenariosTab from './MockMcpScenariosTab'
import MockMcpToolsTab from './MockMcpToolsTab'
import MockMcpResourcesTab from './MockMcpResourcesTab'
import MockMcpPromptsTab from './MockMcpPromptsTab'
import MockMcpLogsTab from './MockMcpLogsTab'

const TABS: readonly MockMcpEditorTab[] = [
  'general',
  'scenarios',
  'tools',
  'resources',
  'prompts',
  'logs',
]

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: MockMcpEditorTab
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`mock-mcp-tab-${id}`}
      onClick={onClick}
      className={`cursor-pointer border-x-0 border-b-2 border-t-0 bg-transparent px-4 py-2 text-[12px] font-semibold ${
        active
          ? 'border-[var(--accent)] text-[var(--accent-text)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  )
}

export default function MockMcpServerEditor({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const server = useMockMcpStore((s) => s.servers.find((x) => x.id === serverId)) ?? null
  const stored = useMockMcpStore((s) => s.drafts[serverId])
  const setDraft = useMockMcpStore((s) => s.setDraft)
  const discardDraft = useMockMcpStore((s) => s.discardDraft)
  const loadServers = useMockMcpStore((s) => s.loadServers)
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const [tab, setTab] = useState<MockMcpEditorTab>('general')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const triedLoad = useRef(false)

  // A tab restored at launch: the Mocks panel may not have loaded the list yet.
  useEffect(() => {
    if (!server && projectId && !triedLoad.current) {
      triedLoad.current = true
      void loadServers(projectId)
    }
  }, [server, projectId, loadServers])

  const baseDraft = useMemo(() => (server ? serverToDraft(server) : null), [server])
  const draft = stored ?? baseDraft
  const dirty = stored !== undefined
  useMockMcpTabDirty(serverId, dirty)

  const change = useCallback<MockMcpDraftUpdater>(
    (fn) => {
      const cur = useMockMcpStore.getState().drafts[serverId] ?? baseDraft
      if (cur) setDraft(serverId, fn(cur))
    },
    [serverId, baseDraft, setDraft],
  )

  const save = useCallback(async (): Promise<void> => {
    if (!useMockMcpStore.getState().drafts[serverId] || isMockMcpSaving(serverId)) return
    setSaving(true)
    let result: MockMcpSaveResult
    try {
      result = await saveMockMcpDraft(serverId)
    } finally {
      setSaving(false)
    }
    if (!result.ok) {
      if (result.error) setSaveError(result.error)
      return
    }
    setSaveError(null)
    if (result.saved) toast.success(t('mockMcp.saved'))
  }, [serverId, t])

  if (!server || !draft) {
    return (
      <div className="p-4 text-[13px] text-[var(--muted)]" data-testid="mock-mcp-editor-missing">
        {t('mockMcp.notFound')}
      </div>
    )
  }

  const labels: Record<MockMcpEditorTab, string> = {
    general: t('mockMcp.tab.general'),
    scenarios: t('mockMcp.tab.scenarios'),
    tools: `${t('mockMcp.tab.tools')} (${draft.tools.length})`,
    resources: `${t('mockMcp.tab.resources')} (${draft.resources.length})`,
    prompts: `${t('mockMcp.tab.prompts')} (${draft.prompts.length})`,
    logs: t('mockMcp.tab.logs'),
  }

  return (
    <div
      data-testid="mock-mcp-editor"
      className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]"
      onKeyDown={(e) => {
        if (isSaveChord(e)) {
          e.preventDefault()
          e.stopPropagation()
          void save()
        }
      }}
    >
      <MockMcpEditorHeader
        server={server}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => {
          discardDraft(serverId)
          setSaveError(null)
        }}
      />
      {saveError && (
        <div
          role="alert"
          data-testid="mock-mcp-save-error"
          className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[12px] text-[var(--red)]"
        >
          {saveError}
        </div>
      )}
      <div
        role="tablist"
        className="flex shrink-0 border-b border-[var(--border)] bg-[var(--white)]"
      >
        {TABS.map((id) => (
          <TabButton key={id} id={id} active={tab === id} onClick={() => setTab(id)}>
            {labels[id]}
          </TabButton>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === 'general' && <MockMcpGeneralTab draft={draft} change={change} />}
        {tab === 'scenarios' && <MockMcpScenariosTab draft={draft} change={change} />}
        {tab === 'tools' && <MockMcpToolsTab draft={draft} change={change} />}
        {tab === 'resources' && <MockMcpResourcesTab draft={draft} change={change} />}
        {tab === 'prompts' && <MockMcpPromptsTab draft={draft} change={change} />}
        {tab === 'logs' && <MockMcpLogsTab serverId={serverId} />}
      </div>
    </div>
  )
}
