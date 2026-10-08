/**
 * Mock MCP Server editor (issue #140), opened as a `mockMcpServer` Workbench
 * tab. Tabs: General | Scenarios | Tools | Resources | Prompts | Logs.
 *
 * Edits go into a draft held by the store (it survives tab switches, which
 * unmount this component); Save sends ONE `update` and the backend
 * hot-reloads a running server. Ctrl/Cmd+S inside the editor saves too.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { MockMcpDraftUpdater, MockMcpEditorTab } from '../../types/mock-mcp'
import { draftToPatch, serverToDraft } from './mock-mcp-draft'
import { mockMcpTabId, useMockMcpTabDirty } from './mock-mcp-tabs'
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
  const updateServer = useMockMcpStore((s) => s.updateServer)
  const loadServers = useMockMcpStore((s) => s.loadServers)
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const [tab, setTab] = useState<MockMcpEditorTab>('general')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const triedLoad = useRef(false)
  // Synchronous in-flight guard: `saving` state is stale inside a second
  // Ctrl+S dispatched before the re-render, which sent two updates.
  const savingRef = useRef(false)

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
    const snapshot = useMockMcpStore.getState().drafts[serverId]
    if (!snapshot) return
    const built = draftToPatch(snapshot)
    if (!built.patch) {
      const p = built.problem
      setSaveError(t(p.key).replace('{tool}', p.tool).replace('{detail}', p.detail))
      return
    }
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    let err: string | null
    try {
      err = await updateServer(serverId, built.patch)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
    if (err) {
      setSaveError(err)
      return
    }
    setSaveError(null)
    // Keep edits typed while the save was in flight.
    if (useMockMcpStore.getState().drafts[serverId] === snapshot) discardDraft(serverId)
    // A rename shows up in the Workbench tab strip too.
    const tabs = useTabsStore.getState()
    const tabId = mockMcpTabId(serverId)
    const name = built.patch.name
    if (name && tabs.tabs.some((x) => x.id === tabId && x.name !== name)) {
      tabs.updateTab(tabId, { name })
    }
    toast.success(t('mockMcp.saved'))
  }, [serverId, t, updateServer, discardDraft])

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
