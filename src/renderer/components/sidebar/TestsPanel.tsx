import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useUIStore } from '../../stores/ui.store'
import { T } from '../../styles/tokens'
import {
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Play,
  Trash2,
  FolderOpen,
  MoreHorizontal,
  Globe,
  Pencil,
  BarChart2,
  Clock,
  Home,
  Download,
  Upload,
  Copy,
  ExternalLink,
  Settings,
} from 'lucide-react'
import type {
  TestSuiteRow,
  TestSuiteItemRow,
  TestSuiteFolderRow,
  TestSuiteContents,
} from '../../types'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import ImportTestSuiteModal from '../modals/ImportTestSuiteModal'
import FolderSettingsModal from '../modals/FolderSettingsModal'
import MethodBadge from '../shared/MethodBadge'
import { useTranslation } from '../../lib/i18n'
import { openSuiteItemTab } from '../../lib/open-endpoint-tab'
import { openOrReuseRunnerTab as sharedOpenRunnerTab } from '../../lib/open-runner-tab'

/* ── Types ─────────────────────────────────────────────────── */

// Renderer-side aliases for the test-suite row shapes shared with preload.
type TestSuite = TestSuiteRow
type TestSuiteItem = TestSuiteItemRow
type TestSuiteFolder = TestSuiteFolderRow
type SuiteContents = TestSuiteContents

const api = () => window.api

/* ── Main panel ────────────────────────────────────────────── */

export default function TestsPanel() {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  // Subscribe to the project tree so suite endpoint lists refresh when a
  // folder/endpoint is added or moved elsewhere (Bug 3).
  const treeData = useWorkspaceStore((s) => s.treeData)
  const addEndpointsSuiteId = useUIStore((s) => s.addEndpointsSuiteId)

  const [searchQuery, setSearchQuery] = useState('')
  const [suites, setSuites] = useState<TestSuite[]>([])
  const [expandedSuites, setExpandedSuites] = useState<Record<string, boolean>>({})
  // Suite contents — items + folders, keyed by suite id. Replaces the old
  // `suiteEndpoints` shape which carried APIs-tree endpoint references.
  const [suiteContents, setSuiteContents] = useState<Record<string, SuiteContents>>({})

  // Create suite
  const [showNewSuiteInput, setShowNewSuiteInput] = useState(false)
  const [newSuiteName, setNewSuiteName] = useState('')
  const newSuiteRef = useRef<HTMLInputElement>(null)

  // Rename
  const [renamingSuiteId, setRenamingSuiteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  // Context menu (suite-level — Run / New Request / Import / Rename / Duplicate / Export / Delete)
  const [contextMenu, setContextMenu] = useState<{ suiteId: string; x: number; y: number } | null>(
    null,
  )

  // Item-level context menu + rename. Suite items are decoupled from APIs
  // tree endpoints, so rename/duplicate/delete here only touch
  // `test_suite_items` — never `endpoints` or `saved_requests`.
  const [itemContextMenu, setItemContextMenu] = useState<{
    item: TestSuiteItem
    suiteId: string
    x: number
    y: number
  } | null>(null)
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null)
  const [renameItemValue, setRenameItemValue] = useState('')
  const renameItemRef = useRef<HTMLInputElement>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TestSuite | null>(null)

  // ─── Load suites ──────────────────────────────────────────
  const loadSuites = useCallback(async () => {
    if (!activeProjectId) return
    const result = await api().testSuite.list(activeProjectId)
    if (result?.success && result.data) setSuites(result.data)
  }, [activeProjectId])

  useEffect(() => {
    loadSuites()
  }, [loadSuites])

  // ─── Load contents for a suite (items + folders) ─────────
  const loadSuiteContents = useCallback(async (suiteId: string) => {
    const result = await api().testSuite.listEndpoints(suiteId)
    if (result?.success && result.data) {
      const data = result.data
      setSuiteContents((prev) => ({ ...prev, [suiteId]: data }))
    }
  }, [])

  // Auto-load suite contents on expand
  useEffect(() => {
    for (const suiteId of Object.keys(expandedSuites)) {
      if (expandedSuites[suiteId] && !suiteContents[suiteId]) {
        loadSuiteContents(suiteId)
      }
    }
  }, [expandedSuites, suiteContents, loadSuiteContents])

  // Refresh expanded suites when a suite item is renamed/edited elsewhere
  // (URL-bar Save or tab-title rename). The producers don't know which
  // suite owns the affected item, so we just reload every suite that's
  // currently expanded — cheap and matches what the user can see.
  useEffect(() => {
    const handler = () => {
      for (const suiteId of Object.keys(expandedSuites)) {
        if (expandedSuites[suiteId]) loadSuiteContents(suiteId)
      }
    }
    window.addEventListener('tests:suite-item-changed', handler)
    return () => window.removeEventListener('tests:suite-item-changed', handler)
  }, [expandedSuites, loadSuiteContents])

  // Suite items are decoupled from the APIs tree now (each item is a
  // self-contained snapshot), so we don't need to refresh on `treeData`
  // anymore — kept the hook stub commented for clarity. Manual refresh
  // happens via `loadSuiteContents` from item-level mutations.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  treeData

  // Reload suite contents when AddEndpoints view closes (addEndpointsSuiteId goes null)
  const prevAddSuiteIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prevId = prevAddSuiteIdRef.current
    prevAddSuiteIdRef.current = addEndpointsSuiteId
    // When it transitions from a value to null, reload that suite
    if (prevId && !addEndpointsSuiteId) {
      loadSuiteContents(prevId)
      // Auto-expand the suite
      setExpandedSuites((s) => ({ ...s, [prevId]: true }))
    }
  }, [addEndpointsSuiteId, loadSuiteContents])

  // ─── Create suite ─────────────────────────────────────────
  const handleCreateSuite = useCallback(async () => {
    if (!newSuiteName.trim() || !activeProjectId) return
    await api().testSuite.create({ project_id: activeProjectId, name: newSuiteName.trim() })
    setNewSuiteName('')
    setShowNewSuiteInput(false)
    await loadSuites()
  }, [newSuiteName, activeProjectId, loadSuites])

  // ─── Delete suite ─────────────────────────────────────────
  const handleDeleteSuite = useCallback(async () => {
    if (!deleteTarget) return
    await api().testSuite.delete(deleteTarget.id)
    setDeleteTarget(null)
    setContextMenu(null)
    await loadSuites()
  }, [deleteTarget, loadSuites])

  // ─── Rename suite ─────────────────────────────────────────
  const handleRenameSuite = useCallback(async () => {
    if (!renamingSuiteId || !renameValue.trim()) {
      setRenamingSuiteId(null)
      return
    }
    await api().testSuite.update(renamingSuiteId, { name: renameValue.trim() })
    setRenamingSuiteId(null)
    await loadSuites()
  }, [renamingSuiteId, renameValue, loadSuites])

  // ─── Run suite ────────────────────────────────────────────
  // The runner now resolves suite item ids directly to their snapshots in
  // the main process (see `getRunnableEntity` in runner.handler.ts); we
  // just pass the ordered id list.
  const handleRunSuite = useCallback(
    async (suite: TestSuite, quick = false) => {
      let items = suiteContents[suite.id]?.items
      if (!items) {
        const result = await api().testSuite.listEndpoints(suite.id)
        if (!result?.success || !result.data) return
        items = result.data.items
      }
      if (!items.length) return
      runEndpoints(
        items.map((i) => i.id),
        suite.name,
        suite.id,
        quick,
      )
      setContextMenu(null)
    },
    [suiteContents],
  )

  // ─── Open / reuse the runner tab with optional session data ─
  const openOrReuseRunnerTab = useCallback(
    (sessionData?: Record<string, unknown>) => {
      sharedOpenRunnerTab(sessionData, t('testsPanel.runnerName'))
    },
    [t],
  )

  const runEndpoints = useCallback(
    (endpointIds: string[], suiteName: string, suiteId?: string, quick = false) => {
      // v1.3.1 §5.6 (E6): plain "Run" lands on the runner's configuration view so
      // the user reviews iterations/delay/data before launching. "Quick Run"
      // (quick=true) skips the config screen and starts immediately (D-4).
      openOrReuseRunnerTab({
        autoRun: quick,
        endpointIds,
        folderName: suiteName,
        sourceType: 'suite',
        suiteId,
      })
    },
    [openOrReuseRunnerTab],
  )

  const openTestsHome = useCallback(() => {
    openOrReuseRunnerTab({ viewHome: true })
  }, [openOrReuseRunnerTab])

  // Click a suite (its name, not the chevron) → open the runner with that
  // suite preselected as the run scope. No auto-run — the user reviews the
  // sequence and clicks Start run themselves. This mirrors how the APIs tree
  // treats folder clicks: open the workbench scoped to that folder.
  const openSuiteInRunner = useCallback(
    (suite: TestSuite) => {
      openOrReuseRunnerTab({
        autoRun: false,
        sourceType: 'suite',
        folderName: suite.name,
        suiteId: suite.id,
      })
    },
    [openOrReuseRunnerTab],
  )

  const openAllRuns = useCallback(() => {
    openOrReuseRunnerTab({ viewAllRuns: true })
  }, [openOrReuseRunnerTab])

  const openScheduledTasks = useCallback(() => {
    openOrReuseRunnerTab({ viewScheduledTasks: true })
  }, [openOrReuseRunnerTab])

  // ─── Remove (delete) an item from a suite ─────────────────
  const handleRemoveItem = useCallback(
    async (suiteId: string, itemId: string) => {
      await api().testSuiteItem.delete(itemId)
      await loadSuiteContents(suiteId)
      // Close the tab if the deleted item was open.
      const tabs = useTabsStore.getState().tabs
      const openTab = tabs.find((t) => t.testSuiteItemId === itemId)
      if (openTab) useTabsStore.getState().closeTab(openTab.id)
    },
    [loadSuiteContents],
  )

  // ─── Rename an item ────────────────────────────────────────
  const handleRenameItem = useCallback(
    async (suiteId: string) => {
      if (!renamingItemId || !renameItemValue.trim()) {
        setRenamingItemId(null)
        return
      }
      const newName = renameItemValue.trim()
      await api().testSuiteItem.update(renamingItemId, { name: newName })
      await loadSuiteContents(suiteId)
      // Reflect the new name in any open tab for this item.
      const tabs = useTabsStore.getState().tabs
      const openTab = tabs.find((t) => t.testSuiteItemId === renamingItemId)
      if (openTab) useTabsStore.getState().updateTab(openTab.id, { name: newName })
      setRenamingItemId(null)
    },
    [renamingItemId, renameItemValue, loadSuiteContents],
  )

  // ─── Duplicate an item ─────────────────────────────────────
  // Snapshot every field of the source row into a new row with " (copy)"
  // suffix. The new id is generated by the create endpoint so the tab + DB
  // identities never collide with the source.
  const handleDuplicateItem = useCallback(
    async (item: TestSuiteItem, suiteId: string) => {
      await api().testSuiteItem.create({
        suite_id: suiteId,
        folder_id: item.folder_id,
        protocol: item.protocol,
        name: `${item.name} (copy)`,
        method: item.method,
        url: item.url,
        request_schema: item.request_schema,
        assertions: item.assertions,
        source_endpoint_id: item.source_endpoint_id,
      })
      await loadSuiteContents(suiteId)
      setItemContextMenu(null)
    },
    [loadSuiteContents],
  )

  // Focus the rename input when an item enters rename mode.
  useEffect(() => {
    if (renamingItemId) renameItemRef.current?.focus()
  }, [renamingItemId])

  // ─── Reorder items within a suite (drag-drop) ──────────────
  // Backend has `testSuiteItem.move({ id, targetSuiteId, targetFolderId,
  // insertBeforeId })` with a single-transaction renumber, so the renderer
  // just emits the drop target and refreshes. Cross-suite drag is blocked
  // explicitly — moving an item to another suite is a separate UX.
  const handleMoveItem = useCallback(
    async (opts: {
      itemId: string
      suiteId: string
      targetFolderId: string | null
      insertBeforeId: string | null
    }) => {
      await api().testSuiteItem.move({
        id: opts.itemId,
        targetSuiteId: opts.suiteId,
        targetFolderId: opts.targetFolderId,
        insertBeforeId: opts.insertBeforeId,
      })
      await loadSuiteContents(opts.suiteId)
    },
    [loadSuiteContents],
  )

  // ─── Add a fresh request directly to a suite ──────────────
  // Creates a blank item, refreshes the suite tree, then opens the editor
  // so the user can fill in URL/headers/body/assertions. 9-protocol picker
  // is a follow-up; HTTP covers the dominant case today.
  const handleAddItem = useCallback(
    async (suite: TestSuite, protocol = 'http', method: string | null = 'GET') => {
      const name = t('testsPanel.newRequestDefaultName')
      const result = await api().testSuiteItem.create({
        suite_id: suite.id,
        folder_id: null,
        protocol,
        name,
        method,
        url: '',
        request_schema: JSON.stringify({
          method,
          url: '',
          params: [],
          headers: [],
          body: { type: 'none' },
          auth: { type: 'none' },
          preScript: '',
          postScript: '',
        }),
        assertions: '[]',
      })
      if (!result?.success || !result.data) return
      setExpandedSuites((s) => ({ ...s, [suite.id]: true }))
      await loadSuiteContents(suite.id)
      // Pinned so two consecutive "New Request" clicks don't both land in
      // the single preview slot — that collision was the source of the
      // tab-state cross-talk where renaming one item leaked into the
      // other's tab.
      void openSuiteItemTab(result.data.id, { pinned: true })
      setContextMenu(null)
    },
    [loadSuiteContents, t],
  )

  // ─── Export suite ─────────────────────────────────────────
  // `format` picks the wire shape — the self-contained Testnizer snapshot or a
  // Postman v2.1 / Insomnia collection so the suite can be carried into those
  // tools (folder tree + per-item request snapshot + cascade scripts).
  const handleExportSuite = useCallback(
    async (suiteId: string, format: 'testnizer' | 'postman' | 'insomnia' = 'testnizer') => {
      try {
        const result = await api().save?.exportTestSuite?.(suiteId, format)
        if (!result?.success && result?.error && result.error !== 'Cancelled') {
          console.error('Export suite failed:', result.error)
        }
      } catch (err) {
        console.error(err)
      }
      setContextMenu(null)
    },
    [],
  )

  // ─── Import suite ─────────────────────────────────────────
  // Opens a modal that lets the user pick a source format before the OS file
  // dialog appears — without this step the native picker shows up cold and
  // the user has no idea what file types are accepted (raised in QA).
  const [showImportModal, setShowImportModal] = useState(false)
  const handleImportSuite = useCallback(() => {
    if (!activeProjectId) return
    setShowImportModal(true)
  }, [activeProjectId])
  const handleImported = useCallback(() => {
    void loadSuites()
  }, [loadSuites])

  // ─── Duplicate suite ──────────────────────────────────────
  // Single IPC clones the suite + every folder and every item in one
  // transaction so the copy shows up with the same request set in place.
  const handleDuplicateSuite = useCallback(
    async (suiteId: string) => {
      try {
        const result = await api().testSuite.duplicate(suiteId)
        if (result?.success) await loadSuites()
      } catch (err) {
        console.error('Duplicate suite failed:', err)
      }
      setContextMenu(null)
    },
    [loadSuites],
  )

  // ─── Focus new suite input ────────────────────────────────
  useEffect(() => {
    if (showNewSuiteInput) newSuiteRef.current?.focus()
  }, [showNewSuiteInput])

  useEffect(() => {
    if (renamingSuiteId) renameRef.current?.focus()
  }, [renamingSuiteId])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // Same outside-click dismissal for the suite-item context menu (open /
  // rename / duplicate / delete). Without this it stayed pinned on screen
  // until the user picked one of the four actions, which is the v1.3.1
  // §5.5 bug.
  useEffect(() => {
    if (!itemContextMenu) return
    const handler = () => setItemContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [itemContextMenu])

  // ─── Filter ───────────────────────────────────────────────
  const filteredSuites = searchQuery.trim()
    ? suites.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : suites

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3"
        style={{ height: 44, borderColor: T.border }}
      >
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: T.text }}>
          {t('tests.title')}
        </span>
        {/* Test Suites have a dedicated import modal (format picker +
         *  destination-suite step) — pointing this button at the APIs
         *  ImportDropdown opened the APIs Import wizard instead, which
         *  then rejected `{ kind: 'testSuite' }` exports with
         *  "Selected type is native but file appears to be JSON"
         *  (v1.4.4 §5.4). Reuse the suite-level handler so the Tests
         *  sidebar header behaves like every suite's right-click
         *  Import. */}
        <button
          type="button"
          onClick={() => handleImportSuite()}
          aria-label={t('tests.importSuiteModalTitle')}
          title={t('tests.importSuiteModalTitle')}
          className="flex cursor-pointer items-center justify-center rounded-[7px] border text-[var(--muted)] hover:bg-[var(--bg)]"
          style={{
            width: 28,
            height: 28,
            borderColor: 'var(--border2)',
            background: 'var(--white)',
          }}
        >
          <Download size={15} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => {
            setShowNewSuiteInput(true)
            setNewSuiteName('')
          }}
          className="flex cursor-pointer items-center justify-center rounded-[7px] border-none"
          style={{ width: 28, height: 28, background: 'var(--accent)', color: '#fff' }}
          title={t('tests.newSuite')}
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: T.border }}>
        <div
          className="flex items-center gap-2 rounded-[7px] px-2.5 py-[5px]"
          style={{ background: 'var(--surface)', border: `1.5px solid ${T.border2}` }}
        >
          <Search size={13} style={{ color: T.ghost, flexShrink: 0 }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('tests.search')}
            className="w-full border-none bg-transparent outline-none"
            style={{ color: T.text, fontFamily: 'inherit', fontSize: 13 }}
          />
        </div>
      </div>

      {/* Quick nav — Home / All Runs / Scheduled Tasks */}
      <div className="shrink-0 border-b py-1" style={{ borderColor: T.border }}>
        <NavItem
          icon={<Home size={14} style={{ color: 'var(--accent)' }} />}
          label={t('tests.overview')}
          onClick={openTestsHome}
        />
        <NavItem
          icon={<BarChart2 size={14} style={{ color: '#4285f4' }} />}
          label={t('tests.allRuns')}
          onClick={openAllRuns}
        />
        <NavItem
          icon={<Clock size={14} style={{ color: '#0369a1' }} />}
          label={t('tests.scheduled')}
          onClick={openScheduledTasks}
        />
      </div>

      {/* Suites section label */}
      <div
        className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2"
        style={{ color: 'var(--muted)' }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('tests.testSuites')}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* New suite input */}
        {showNewSuiteInput && (
          <div className="flex items-center gap-2 px-3 py-2">
            <FolderOpen size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <input
              ref={newSuiteRef}
              value={newSuiteName}
              onChange={(e) => setNewSuiteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSuite()
                if (e.key === 'Escape') setShowNewSuiteInput(false)
              }}
              onBlur={() => {
                if (newSuiteName.trim()) handleCreateSuite()
                else setShowNewSuiteInput(false)
              }}
              placeholder={t('tests.newSuitePlaceholder')}
              className="flex-1 rounded border px-2 py-1 outline-none"
              style={{
                fontSize: 13,
                borderColor: 'var(--accent)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
              }}
            />
          </div>
        )}

        {/* Suite list */}
        {filteredSuites.length === 0 && !showNewSuiteInput ? (
          <div
            className="mx-3 mt-4 rounded-[7px] border border-dashed py-6 text-center"
            style={{ borderColor: T.border2 }}
          >
            <FolderOpen size={28} style={{ color: 'var(--hint)', margin: '0 auto 8px' }} />
            <div style={{ color: 'var(--hint)', fontSize: 13 }}>{t('tests.noSuites')}</div>
            <button
              type="button"
              onClick={() => {
                setShowNewSuiteInput(true)
                setNewSuiteName('')
              }}
              className="mt-2 cursor-pointer border-none bg-transparent font-medium"
              style={{ color: 'var(--accent)', fontSize: 13 }}
            >
              {t('tests.createSuite')}
            </button>
          </div>
        ) : (
          filteredSuites.map((suite) => (
            <SuiteNode
              key={suite.id}
              suite={suite}
              expanded={expandedSuites[suite.id] ?? false}
              contents={suiteContents[suite.id] || { items: [], folders: [] }}
              isRenaming={renamingSuiteId === suite.id}
              renameValue={renameValue}
              renameRef={renameRef}
              renamingItemId={renamingItemId}
              renameItemValue={renameItemValue}
              renameItemRef={renameItemRef}
              onItemRenameChange={setRenameItemValue}
              onItemRenameSubmit={() => handleRenameItem(suite.id)}
              onItemRenameCancel={() => setRenamingItemId(null)}
              onItemContextMenu={(item, e) => {
                e.preventDefault()
                e.stopPropagation()
                setItemContextMenu({
                  item,
                  suiteId: suite.id,
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
              onItemMove={(itemId, targetFolderId, insertBeforeId) =>
                handleMoveItem({
                  itemId,
                  suiteId: suite.id,
                  targetFolderId,
                  insertBeforeId,
                })
              }
              onToggle={() => setExpandedSuites((s) => ({ ...s, [suite.id]: !s[suite.id] }))}
              onOpen={() => {
                setExpandedSuites((s) => ({ ...s, [suite.id]: true }))
                openSuiteInRunner(suite)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ suiteId: suite.id, x: e.clientX, y: e.clientY })
              }}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSuite}
              onRenameCancel={() => setRenamingSuiteId(null)}
              onRemoveItem={(iid) => handleRemoveItem(suite.id, iid)}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu &&
        (() => {
          const suite = suites.find((s) => s.id === contextMenu.suiteId)
          if (!suite) return null
          return (
            <div
              className="fixed z-[500] rounded-lg border py-1"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                background: 'var(--white)',
                borderColor: 'var(--border)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                minWidth: 160,
              }}
            >
              <ContextMenuItem
                icon={<Play size={13} />}
                label={t('testsPanel.runSuite')}
                onClick={() => handleRunSuite(suite)}
              />
              <ContextMenuItem
                icon={<Play size={13} />}
                label={t('testsPanel.quickRunSuite') || 'Quick Run (skip config)'}
                onClick={() => handleRunSuite(suite, true)}
              />
              <ContextMenuItem
                icon={<Plus size={13} />}
                label={t('testsPanel.newRequest')}
                onClick={() => handleAddItem(suite)}
              />
              <ContextMenuItem
                icon={<Download size={13} />}
                label={t('testsPanel.importEndpoints')}
                onClick={() => {
                  setContextMenu(null)
                  useUIStore.getState().setAddEndpointsSuite(suite.id, suite.name)
                }}
              />
              <ContextMenuItem
                icon={<Pencil size={13} />}
                label={t('testsPanel.rename')}
                onClick={() => {
                  setRenamingSuiteId(suite.id)
                  setRenameValue(suite.name)
                  setContextMenu(null)
                }}
              />
              <ContextMenuItem
                icon={<Copy size={13} />}
                label={t('testsPanel.duplicate')}
                onClick={() => handleDuplicateSuite(suite.id)}
              />
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <ContextMenuItem
                icon={<Upload size={13} />}
                label={t('testsPanel.exportTestnizer')}
                onClick={() => handleExportSuite(suite.id, 'testnizer')}
              />
              <ContextMenuItem
                icon={<Upload size={13} />}
                label={t('testsPanel.exportPostman')}
                onClick={() => handleExportSuite(suite.id, 'postman')}
              />
              <ContextMenuItem
                icon={<Upload size={13} />}
                label={t('testsPanel.exportInsomnia')}
                onClick={() => handleExportSuite(suite.id, 'insomnia')}
              />
              <ContextMenuItem
                icon={<Download size={13} />}
                label={t('testsPanel.import')}
                onClick={() => {
                  setContextMenu(null)
                  handleImportSuite()
                }}
              />
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <ContextMenuItem
                icon={<Trash2 size={13} />}
                label={t('testsPanel.delete')}
                danger
                onClick={() => {
                  setDeleteTarget(suite)
                  setContextMenu(null)
                }}
              />
            </div>
          )
        })()}

      {/* Item-level context menu (right-click on a request inside a suite).
          Operates strictly on `test_suite_items` — Open / Rename / Duplicate
          / Delete never touch the APIs `endpoints` or `saved_requests`
          tables, so a Tests-side action can't drift into the APIs tree. */}
      {itemContextMenu && (
        <div
          className="fixed z-[500] rounded-lg border py-1"
          style={{
            left: itemContextMenu.x,
            top: itemContextMenu.y,
            background: 'var(--white)',
            borderColor: 'var(--border)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            minWidth: 160,
          }}
        >
          <ContextMenuItem
            icon={<ExternalLink size={13} />}
            label={t('testsPanel.openItem')}
            onClick={() => {
              void openSuiteItemTab(itemContextMenu.item.id)
              setItemContextMenu(null)
            }}
          />
          <ContextMenuItem
            icon={<Pencil size={13} />}
            label={t('testsPanel.rename')}
            onClick={() => {
              setRenamingItemId(itemContextMenu.item.id)
              setRenameItemValue(itemContextMenu.item.name)
              setItemContextMenu(null)
            }}
          />
          <ContextMenuItem
            icon={<Copy size={13} />}
            label={t('testsPanel.duplicate')}
            onClick={() => handleDuplicateItem(itemContextMenu.item, itemContextMenu.suiteId)}
          />
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <ContextMenuItem
            icon={<Trash2 size={13} />}
            label={t('testsPanel.delete')}
            danger
            onClick={() => {
              void handleRemoveItem(itemContextMenu.suiteId, itemContextMenu.item.id)
              setItemContextMenu(null)
            }}
          />
        </div>
      )}

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        itemName={deleteTarget?.name || ''}
        itemType={t('testsPanel.testSuiteLabel')}
        onConfirm={handleDeleteSuite}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Import suite — format picker before the OS file dialog */}
      {activeProjectId && (
        <ImportTestSuiteModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          projectId={activeProjectId}
          onImported={handleImported}
        />
      )}
    </div>
  )
}

/* ── Suite node (top-level folder) ───────────────────────── */

function SuiteNode({
  suite,
  expanded,
  contents,
  isRenaming,
  renameValue,
  renameRef,
  renamingItemId,
  renameItemValue,
  renameItemRef,
  onItemRenameChange,
  onItemRenameSubmit,
  onItemRenameCancel,
  onItemContextMenu,
  onItemMove,
  onToggle,
  onOpen,
  onContextMenu,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onRemoveItem,
}: {
  suite: TestSuite
  expanded: boolean
  contents: SuiteContents
  isRenaming: boolean
  renameValue: string
  renameRef: React.RefObject<HTMLInputElement | null>
  renamingItemId: string | null
  renameItemValue: string
  renameItemRef: React.RefObject<HTMLInputElement | null>
  onItemRenameChange: (v: string) => void
  onItemRenameSubmit: () => void
  onItemRenameCancel: () => void
  onItemContextMenu: (item: TestSuiteItem, e: React.MouseEvent) => void
  onItemMove: (itemId: string, targetFolderId: string | null, insertBeforeId: string | null) => void
  onToggle: () => void
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onRenameChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onRemoveItem: (itemId: string) => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)

  return (
    <div>
      {/* Suite header — row click opens the runner with this suite, chevron
          just expands/collapses. Matches APIs tree's "folder click → folder
          workbench" pattern. */}
      <div
        className="flex items-center gap-1.5 px-3 py-[6px]"
        style={{ background: hovered ? 'var(--item-hover)' : 'transparent', cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onOpen}
        onContextMenu={onContextMenu}
      >
        <span
          style={{ color: T.ghost, flexShrink: 0, cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <FolderOpen size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />

        {isRenaming ? (
          <input
            ref={renameRef as React.RefObject<HTMLInputElement>}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border px-1.5 py-0.5 outline-none"
            style={{
              fontSize: 13,
              borderColor: 'var(--accent)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
            }}
          />
        ) : (
          <span
            className="flex-1 truncate"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
          >
            {suite.name}
          </span>
        )}

        <span style={{ fontSize: 13, color: 'var(--hint)', flexShrink: 0 }}>
          {contents.items.length > 0 ? contents.items.length : ''}
        </span>

        {hovered && !isRenaming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onContextMenu(e)
            }}
            className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
            style={{ color: T.ghost }}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {/* Items + folders below */}
      {expanded && (
        <div>
          {contents.items.length === 0 && contents.folders.length === 0 ? (
            <div className="py-2 pl-10 pr-3" style={{ color: 'var(--hint)', fontSize: 13 }}>
              {t('testsPanel.noEndpointsHint')}
            </div>
          ) : (
            <SuiteContentsTree
              contents={contents}
              renamingItemId={renamingItemId}
              renameItemValue={renameItemValue}
              renameItemRef={renameItemRef}
              onItemRenameChange={onItemRenameChange}
              onItemRenameSubmit={onItemRenameSubmit}
              onItemRenameCancel={onItemRenameCancel}
              onItemContextMenu={onItemContextMenu}
              onItemMove={onItemMove}
              onRemoveItem={onRemoveItem}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* ── Suite contents tree (folders + items) ──────────────── */

function SuiteContentsTree({
  contents,
  renamingItemId,
  renameItemValue,
  renameItemRef,
  onItemRenameChange,
  onItemRenameSubmit,
  onItemRenameCancel,
  onItemContextMenu,
  onItemMove,
  onRemoveItem,
}: {
  contents: SuiteContents
  renamingItemId: string | null
  renameItemValue: string
  renameItemRef: React.RefObject<HTMLInputElement | null>
  onItemRenameChange: (v: string) => void
  onItemRenameSubmit: () => void
  onItemRenameCancel: () => void
  onItemContextMenu: (item: TestSuiteItem, e: React.MouseEvent) => void
  onItemMove: (itemId: string, targetFolderId: string | null, insertBeforeId: string | null) => void
  onRemoveItem: (itemId: string) => void
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
  // Which suite folder's auth/scripts settings modal is open (D-2).
  const [settingsFolder, setSettingsFolder] = useState<{ id: string; name: string } | null>(null)
  const settingsFolderId = settingsFolder?.id

  const loadFolderSettings = useCallback(async () => {
    if (!settingsFolderId) return undefined
    const r = (await window.api?.testSuiteFolder?.getSettings(settingsFolderId)) as
      | {
          success: boolean
          data?: { auth: string | null; pre_script: string | null; post_script: string | null }
        }
      | undefined
    return r?.success ? r.data : undefined
  }, [settingsFolderId])

  const saveFolderSettings = useCallback(
    async (s: { auth: string | null; pre_script: string | null; post_script: string | null }) => {
      if (!settingsFolderId) return { success: false, error: 'No folder selected' }
      const r = (await window.api?.testSuiteFolder?.updateSettings(settingsFolderId, s)) as
        | { success: boolean; error?: string }
        | undefined
      return r ?? { success: false, error: 'Save failed' }
    },
    [settingsFolderId],
  )

  // Group items by folder_id (null = suite root).
  const itemsByFolder = new Map<string | null, TestSuiteItem[]>()
  for (const item of contents.items) {
    const key = item.folder_id ?? null
    const arr = itemsByFolder.get(key) ?? []
    arr.push(item)
    itemsByFolder.set(key, arr)
  }

  // Group folders by parent_id (null = top level), preserving sort order — so
  // an imported collection's full nested hierarchy (Setup → Flow → Teardown,
  // arbitrarily deep) renders, not just a single level.
  const foldersByParent = new Map<string | null, TestSuiteFolder[]>()
  for (const f of [...contents.folders].sort((a, b) => a.sort_order - b.sort_order)) {
    const key = f.parent_id ?? null
    const arr = foldersByParent.get(key) ?? []
    arr.push(f)
    foldersByParent.set(key, arr)
  }

  const FOLDER_BASE = 12
  const STEP = 14

  const renderItem = (it: TestSuiteItem, indent: number) => (
    <SuiteItemRow
      key={it.id}
      item={it}
      indent={indent}
      isRenaming={renamingItemId === it.id}
      renameValue={renameItemValue}
      renameRef={renameItemRef}
      onRenameChange={onItemRenameChange}
      onRenameSubmit={onItemRenameSubmit}
      onRenameCancel={onItemRenameCancel}
      onContextMenu={(e) => onItemContextMenu(it, e)}
      onMove={onItemMove}
      onRemove={() => onRemoveItem(it.id)}
    />
  )

  // Recursively render a folder, its child folders, then its items. Cycle-safe
  // via the `seen` set (a corrupt parent loop can't blow the stack).
  const renderFolder = (
    folder: TestSuiteFolder,
    depth: number,
    seen: Set<string>,
  ): React.ReactNode => {
    if (seen.has(folder.id)) return null
    const nextSeen = new Set(seen).add(folder.id)
    const collapsed = collapsedFolders[folder.id] ?? false
    const items = itemsByFolder.get(folder.id) ?? []
    const childFolders = foldersByParent.get(folder.id) ?? []
    return (
      <div key={folder.id}>
        <div
          className="group flex cursor-pointer items-center gap-1.5 py-[3px] pr-3"
          style={{ color: 'var(--muted)', paddingLeft: FOLDER_BASE + depth * STEP }}
          onClick={() => setCollapsedFolders((s) => ({ ...s, [folder.id]: !collapsed }))}
        >
          <span style={{ flexShrink: 0 }}>
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </span>
          <FolderOpen size={12} style={{ color: 'var(--hint)', flexShrink: 0 }} />
          <span className="flex-1 truncate" style={{ fontSize: 13, fontWeight: 500 }}>
            {folder.name}
          </span>
          {/* Folder auth + cascade scripts (imported setup/teardown lands here). */}
          <button
            type="button"
            title="Folder settings (auth + scripts)"
            className="flex-shrink-0 opacity-0 group-hover:opacity-100"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={(e) => {
              e.stopPropagation()
              setSettingsFolder({ id: folder.id, name: folder.name })
            }}
          >
            <Settings size={12} />
          </button>
        </div>
        {!collapsed && (
          <>
            {childFolders.map((cf) => renderFolder(cf, depth + 1, nextSeen))}
            {items.map((it) => renderItem(it, FOLDER_BASE + (depth + 1) * STEP + 6))}
          </>
        )}
      </div>
    )
  }

  const topFolders = foldersByParent.get(null) ?? []
  const rootItems = itemsByFolder.get(null) ?? []

  return (
    <>
      {topFolders.map((folder) => renderFolder(folder, 0, new Set()))}
      {rootItems.map((it) => renderItem(it, 10))}
      {settingsFolder && (
        <FolderSettingsModal
          open
          folderId={settingsFolder.id}
          folderName={settingsFolder.name}
          loadRow={loadFolderSettings}
          saveSettings={saveFolderSettings}
          onClose={() => setSettingsFolder(null)}
        />
      )}
    </>
  )
}

/* ── Single item row ──────────────────────────────────────── */

function SuiteItemRow({
  item,
  indent = 10,
  isRenaming,
  renameValue,
  renameRef,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
  onMove,
  onRemove,
}: {
  item: TestSuiteItem
  indent?: number
  isRenaming: boolean
  renameValue: string
  renameRef: React.RefObject<HTMLInputElement | null>
  onRenameChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMove: (
    draggedItemId: string,
    targetFolderId: string | null,
    insertBeforeId: string | null,
  ) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  // 'before' = drop indicator above this row (insert before)
  // 'after'  = drop indicator below this row (insert after)
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null)

  // Clicking opens the inline-snapshot request in the Workbench. Save
  // routes back to `testSuiteItem.update`, so changes never bleed into
  // the APIs-tree endpoint the item was imported from.
  const handleOpen = useCallback(() => {
    void openSuiteItemTab(item.id)
  }, [item.id])

  const handleDragStart = (e: React.DragEvent) => {
    if (isRenaming) return
    e.dataTransfer.setData('application/testnizer-suite-item', item.id)
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/testnizer-suite-item')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    if (dropPos !== pos) setDropPos(pos)
  }

  const handleDragLeave = () => {
    if (dropPos !== null) setDropPos(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    const draggedId = e.dataTransfer.getData('application/testnizer-suite-item')
    if (!draggedId) return
    e.preventDefault()
    e.stopPropagation()
    const pos = dropPos ?? 'after'
    setDropPos(null)
    if (draggedId === item.id) return
    // 'before' → insert before this row. 'after' → insert before the row that
    // would come *after* this one — we don't have that id here, so we pass
    // null (append). The parent renumbers in a single transaction.
    onMove(draggedId, item.folder_id, pos === 'before' ? item.id : null)
  }

  return (
    <div style={{ position: 'relative' }}>
      {dropPos === 'before' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: indent + 28,
            right: 8,
            height: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
      {dropPos === 'after' && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: indent + 28,
            right: 8,
            height: 2,
            background: 'var(--accent)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
      <div
        draggable={!isRenaming}
        className="flex cursor-pointer items-center gap-2 py-[3px] pr-3"
        style={{
          paddingLeft: indent + 28,
          background: hovered ? 'var(--item-hover)' : 'transparent',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleOpen}
        onContextMenu={onContextMenu}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        title={t('testsPanel.openEndpoint')}
      >
        {item.method ? (
          <MethodBadge method={item.method} small />
        ) : (
          <Globe size={12} style={{ color: 'var(--hint)' }} />
        )}
        {isRenaming ? (
          <input
            ref={renameRef as React.RefObject<HTMLInputElement>}
            data-testid="suite-item-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border px-1.5 py-0.5 outline-none"
            style={{
              fontSize: 13,
              borderColor: 'var(--accent)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
            }}
          />
        ) : (
          <span
            draggable={false}
            className="flex-1 truncate"
            style={{ fontSize: 13, color: 'var(--text)' }}
          >
            {item.name}
          </span>
        )}
        {hovered && !isRenaming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
            title={t('testsPanel.removeFromSuite')}
            style={{ color: '#cc2200' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Context menu item ────────────────────────────────────── */

function ContextMenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
      style={{ fontSize: 13, color: danger ? '#cc2200' : 'var(--text)' }}
    >
      {icon}
      {label}
    </button>
  )
}

/* ── Sidebar nav item (All Runs / Scheduled Tasks) ────────── */

function NavItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex w-full cursor-pointer items-center gap-2 border-none px-3 py-[7px] text-left"
      style={{
        background: hovered ? 'var(--item-hover)' : 'transparent',
        transition: 'background 0.1s',
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--text)',
      }}
    >
      <span className="flex shrink-0 items-center justify-center" style={{ width: 16 }}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      <ChevronRight size={12} style={{ color: 'var(--hint)', flexShrink: 0 }} />
    </button>
  )
}
