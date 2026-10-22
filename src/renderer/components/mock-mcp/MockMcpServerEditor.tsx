/**
 * Mock MCP Server editor (issue #140), opened as a `mockMcpServer` Workbench
 * tab. Tabs: General | Scenarios | Tools | Resources | Prompts | Logs.
 *
 * Edits go into a draft held by the store (it survives tab switches, which
 * unmount this component); Save sends ONE `update` and the backend
 * hot-reloads a running server. Ctrl/Cmd+S saves too — inside the editor via
 * its own keydown, with focus elsewhere via the global shortcut
 * (`onMockMcpSaveRequest`). All of them go through `saveMockMcpDraft`, the
 * same path the Workbench's unsaved-changes dialog uses (issue #154).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { onMockMcpSaveRequest } from '../../lib/mock-mcp-save-request'
import type { MockMcpDraftUpdater, MockMcpEditorTab } from '../../types/mock-mcp'
import { serverToDraft } from './mock-mcp-draft'
import { useMockMcpTabDirty } from './mock-mcp-tabs'
import { isMockMcpSaving, saveMockMcpDraft, type MockMcpSaveResult } from './mock-mcp-save'
import { isSaveChord } from './mock-mcp-format'
import {
  blankDefaultItems,
  CLEAN_SECTIONS,
  sectionDirty,
  type MockMcpBlankItem,
} from './mock-mcp-dirty'
import MockMcpEditorHeader from './MockMcpEditorHeader'
import MockMcpEditorTabs from './MockMcpEditorTabs'
import MockMcpBlankItemsDialog from './MockMcpBlankItemsDialog'
import MockMcpGeneralTab from './MockMcpGeneralTab'
import MockMcpScenariosTab from './MockMcpScenariosTab'
import MockMcpToolsTab from './MockMcpToolsTab'
import MockMcpResourcesTab from './MockMcpResourcesTab'
import MockMcpPromptsTab from './MockMcpPromptsTab'
import MockMcpLogsTab from './MockMcpLogsTab'

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
  /** Non-empty = the "items still at their defaults" warning is open (issue #210). */
  const [blankItems, setBlankItems] = useState<MockMcpBlankItem[]>([])
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
  // Which list tab holds the unsaved edits (issue #210).
  const sections = useMemo(
    () => (stored && baseDraft ? sectionDirty(stored, baseDraft) : CLEAN_SECTIONS),
    [stored, baseDraft],
  )

  const change = useCallback<MockMcpDraftUpdater>(
    (fn) => {
      const cur = useMockMcpStore.getState().drafts[serverId] ?? baseDraft
      if (cur) setDraft(serverId, fn(cur))
    },
    [serverId, baseDraft, setDraft],
  )

  /**
   * Save every tab's edits. Unless `confirmed`, an item still at its "Add"
   * default opens the warning first (issue #210); the save itself stays the
   * single `saveMockMcpDraft` path.
   */
  const save = useCallback(
    async (confirmed = false): Promise<void> => {
      const st = useMockMcpStore.getState()
      const current = st.drafts[serverId]
      if (!current || isMockMcpSaving(serverId)) return
      const saved = st.servers.find((x) => x.id === serverId)
      if (!confirmed && saved) {
        const blanks = blankDefaultItems(current, saved)
        if (blanks.length > 0) {
          setBlankItems(blanks)
          return
        }
      }
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
    },
    [serverId, t],
  )

  // Ctrl+S with focus outside the editor arrives through the global shortcut
  // (issue #210 follow-up). Refs keep the listener current without
  // re-subscribing; an open warning dialog swallows the chord, as below.
  const saveRef = useRef(save)
  const warningOpenRef = useRef(false)
  useEffect(() => {
    saveRef.current = save
    warningOpenRef.current = blankItems.length > 0
  })
  useEffect(
    () =>
      onMockMcpSaveRequest(serverId, () => {
        if (!warningOpenRef.current) void saveRef.current()
      }),
    [serverId],
  )

  if (!server || !draft) {
    return (
      <div className="p-4 text-sm text-[var(--muted)]" data-testid="mock-mcp-editor-missing">
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
          // Also keeps the global Ctrl+S (project save / "Request saved"
          // toast) from firing on top of this one (issue #212).
          e.stopPropagation()
          // Keydowns inside the warning dialog bubble here through the portal.
          if (blankItems.length === 0) void save()
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
      <MockMcpEditorTabs tab={tab} onTab={setTab} labels={labels} dirty={sections} />
      <MockMcpBlankItemsDialog
        items={blankItems}
        onGoBack={() => setBlankItems([])}
        onSaveAnyway={() => {
          setBlankItems([])
          void save(true)
        }}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === 'general' && <MockMcpGeneralTab draft={draft} change={change} />}
        {tab === 'scenarios' && (
          <MockMcpScenariosTab
            draft={draft}
            change={change}
            tokenLocked={!!server.bearerTokenDecryptFailed}
          />
        )}
        {tab === 'tools' && <MockMcpToolsTab draft={draft} change={change} />}
        {tab === 'resources' && <MockMcpResourcesTab draft={draft} change={change} />}
        {tab === 'prompts' && <MockMcpPromptsTab draft={draft} change={change} />}
        {tab === 'logs' && <MockMcpLogsTab serverId={serverId} />}
      </div>
    </div>
  )
}
