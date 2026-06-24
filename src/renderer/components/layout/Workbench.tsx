import { useState, useRef, useEffect, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { isMac } from '../../lib/platform'
import { makeTabId } from '../../lib/utils'
import UrlBar from './UrlBar'
import UrlPreview from './UrlPreview'
import RequestEditor from '../request/RequestEditor'
import ResponsePane from '../response/ResponsePane'
import SoapEditor from '../protocols/SoapEditor'
import WebSocketEditor from '../protocols/WebSocketEditor'
import GraphQLEditor from '../protocols/GraphQLEditor'
import GrpcEditor from '../protocols/GrpcEditor'
import SseEditor from '../protocols/SseEditor'
import AiChatEditor from '../protocols/AiChatEditor'
import McpEditor from '../protocols/McpEditor'
import SocketIOEditor from '../protocols/SocketIOEditor'
import RunnerTab from '../runner/RunnerTab'
import JwtTool from '../tools/JwtTool'
import JsonFormatTool from '../tools/JsonFormatTool'
import XmlFormatTool from '../tools/XmlFormatTool'
import EncodeTool from '../tools/EncodeTool'
import DiffTool from '../tools/DiffTool'
import JsonPathTool from '../tools/JsonPathTool'
import XPathTool from '../tools/XPathTool'
import XsltTool from '../tools/XsltTool'
import JoltTool from '../tools/JoltTool'
import WsSecurityTool from '../tools/WsSecurityTool'
import HashTool from '../tools/HashTool'
import HmacTool from '../tools/HmacTool'
import JsonSchemaTool from '../tools/JsonSchemaTool'
import JsonXmlTool from '../tools/JsonXmlTool'
import EpochTool from '../tools/EpochTool'
import HttpStatusTool from '../tools/HttpStatusTool'
import BaseConverterTool from '../tools/BaseConverterTool'
import UuidTool from '../tools/UuidTool'
import RegexTool from '../tools/RegexTool'
import YamlJsonTool from '../tools/YamlJsonTool'
import MockServerEditor from '../mock/MockServerEditor'
import RightPanel from './RightPanel'
import EdgeResizeHandle from './EdgeResizeHandle'
import { useTabsStore } from '../../stores/tabs.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useSoapStore } from '../../stores/soap.store'
import { useWebSocketStore } from '../../stores/websocket.store'
import { useSseStore } from '../../stores/sse.store'
import { useGrpcStore } from '../../stores/grpc.store'
import { useGraphQLStore } from '../../stores/graphql.store'
import { useAiChatStore } from '../../stores/ai-chat.store'
import { useMcpStore } from '../../stores/mcp.store'
import { useSocketIOStore } from '../../stores/socketio.store'
import NewRequestWelcome from './NewRequestWelcome'
import PageWelcome from './PageWelcome'
import AddEndpointsView from '../runner/AddEndpointsView'
import MethodBadge from '../shared/MethodBadge'
import { openSuiteItemTab } from '../../lib/open-endpoint-tab'
import EnvironmentSelector from '../shared/EnvironmentSelector'
import { T } from '../../styles/tokens'
import { tabBelongsToPage } from '../../lib/sidebar-pages'

// `cleanupTabState` moved to ../../lib/cleanup-tab-state so the AppShell
// File → Close Tab menu path can share it (otherwise closing via the menu
// leaked protocol-store slices that the in-Workbench Ctrl+W path cleaned
// up — v1.4.4 close-bypass).
import { cleanupTabState } from '../../lib/cleanup-tab-state'
import { saveActiveRequestInPlace } from '../../lib/save-active-request'
import UnsavedChangesDialog from '../modals/UnsavedChangesDialog'
import { toast } from '../../lib/toast'

// Tool-tab protocol → component. The Workbench renders EVERY open tool tab and
// toggles visibility (rather than mounting only the active one) so a tool's
// local input state survives switching to another tool tab and back.
const TOOL_COMPONENTS: Record<string, ComponentType> = {
  'tools.jwt': JwtTool,
  'tools.jsonFormat': JsonFormatTool,
  'tools.xmlFormat': XmlFormatTool,
  'tools.encode': EncodeTool,
  'tools.diff': DiffTool,
  'tools.jsonpath': JsonPathTool,
  'tools.xpath': XPathTool,
  'tools.xslt': XsltTool,
  'tools.jolt': JoltTool,
  'tools.wsSecurity': WsSecurityTool,
  'tools.hash': HashTool,
  'tools.hmac': HmacTool,
  'tools.jsonSchema': JsonSchemaTool,
  'tools.jsonXml': JsonXmlTool,
  'tools.epoch': EpochTool,
  'tools.httpStatus': HttpStatusTool,
  'tools.base': BaseConverterTool,
  'tools.uuid': UuidTool,
  'tools.regex': RegexTool,
  'tools.yamlJson': YamlJsonTool,
}

function EndpointTabBar() {
  const allTabs = useTabsStore((s) => s.tabs)
  const activePage = useUIStore((s) => s.activeSidebarPage)
  const tabs = allTabs.filter((tab) => tabBelongsToPage(tab, activePage))
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const openTab = useTabsStore((s) => s.openTab)
  const pinTab = useTabsStore((s) => s.pinTab)
  const updateTab = useTabsStore((s) => s.updateTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null,
  )
  // Drag-and-drop reorder. `dropBeforeId === null` means "drop after the
  // last tab" — drawn as a marker on the right edge of the strip.
  const [dropBeforeId, setDropBeforeId] = useState<string | null | undefined>(undefined)
  const moveTab = useTabsStore((s) => s.moveTab)
  // Tab pending an unsaved-changes confirm on close (issue #9), + Save in-flight.
  const [closeConfirmTabId, setCloseConfirmTabId] = useState<string | null>(null)
  const [closeSaving, setCloseSaving] = useState(false)

  const TAB_DND_MIME = 'application/testnizer-tab'

  function readDraggedTabId(e: React.DragEvent): string | null {
    const raw = e.dataTransfer.getData(TAB_DND_MIME)
    return raw || null
  }

  useEffect(() => {
    if (!contextMenu) return
    function dismiss() {
      setContextMenu(null)
    }
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('contextmenu', dismiss)
    }
  }, [contextMenu])

  // Whenever the active tab changes — regardless of where the change came
  // from (handleSwitchTab, openTab from NewDropdown / Welcome / Tools,
  // tabs.store.rememberAndRestoreForPage, etc.) — flip every protocol store
  // to the corresponding tab's cached state. Without this, "+ New" in the
  // tab strip or "New HTTP endpoint" from the welcome screen left the
  // editor showing the previous endpoint's data (v1.3.1 M1 / M6).
  useEffect(() => {
    if (!activeTabId) return
    switchToTab(activeTabId)
    useSoapStore.getState().switchToTab(activeTabId)
    useWebSocketStore.getState().switchToTab(activeTabId)
    useSseStore.getState().switchToTab(activeTabId)
    useGrpcStore.getState().switchToTab(activeTabId)
    useGraphQLStore.getState().switchToTab(activeTabId)
    useAiChatStore.getState().switchToTab(activeTabId)
    useMcpStore.getState().switchToTab(activeTabId)
    useSocketIOStore.getState().switchToTab(activeTabId)
  }, [activeTabId, switchToTab])

  type TabContextAction =
    | 'newRequest'
    | 'duplicate'
    | 'close'
    | 'closeForce'
    | 'closeOthers'
    | 'closeLeft'
    | 'closeRight'
    | 'closeAll'
    | 'closeAllForce'

  function handleTabContextAction(tabId: string, action: TabContextAction) {
    setContextMenu(null)
    if (action === 'newRequest') {
      handleNewTab()
      return
    }
    if (action === 'duplicate') {
      handleDuplicateTab(tabId)
      return
    }
    // Single-tab "Close" → the 3-way Save / Discard / Cancel dialog (issue #9).
    // Bulk variants (closeOthers/Left/Right/All) keep the lighter batch confirm
    // below since there's no single Save target for them.
    if (action === 'close') {
      requestCloseTab(tabId)
      return
    }

    const allTabs = useTabsStore.getState().tabs
    const idx = allTabs.findIndex((t) => t.id === tabId)
    if (idx < 0) return
    const idsToClose: string[] = []
    if (action === 'closeForce') {
      idsToClose.push(tabId)
    } else if (action === 'closeOthers') {
      idsToClose.push(...allTabs.filter((t) => t.id !== tabId).map((t) => t.id))
    } else if (action === 'closeLeft') {
      idsToClose.push(...allTabs.slice(0, idx).map((t) => t.id))
    } else if (action === 'closeRight') {
      idsToClose.push(...allTabs.slice(idx + 1).map((t) => t.id))
    } else if (action === 'closeAll' || action === 'closeAllForce') {
      idsToClose.push(...allTabs.map((t) => t.id))
    }

    // Non-force variants prompt before discarding unsaved changes. Force
    // variants skip the confirm — meant for "I know, just close them".
    const isForce = action === 'closeForce' || action === 'closeAllForce'
    if (!isForce) {
      const dirtyCount = idsToClose.filter((id) => allTabs.find((t) => t.id === id)?.isDirty).length
      if (dirtyCount > 0) {
        const ok = window.confirm(
          dirtyCount === 1
            ? 'This tab has unsaved changes. Close anyway?'
            : `${dirtyCount} tabs have unsaved changes. Close anyway?`,
        )
        if (!ok) return
      }
    }

    for (const id of idsToClose) {
      cleanupTabState(id)
      closeTab(id)
    }
  }

  async function handleDuplicateTab(tabId: string) {
    const src = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (!src) return

    // Suite-item tabs duplicate at the DATA layer, not just the tab layer —
    // we create a new `test_suite_items` row so the copy is editable and
    // saveable on its own. Without this branch the old code copied only the
    // tab metadata while leaving `testSuiteItemId` out, which orphaned the
    // duplicate and made Save fall through to the APIs-folder modal.
    if (src.testSuiteItemId) {
      const itemRes = (await window.api?.testSuiteItem?.get(src.testSuiteItemId)) as {
        success: boolean
        data?: {
          suite_id: string
          folder_id: string | null
          protocol: string
          name: string
          method: string | null
          url: string | null
          request_schema: string
          assertions: string | null
          source_endpoint_id: string | null
        }
      }
      if (!itemRes?.success || !itemRes.data) return
      const item = itemRes.data
      const createRes = (await window.api?.testSuiteItem?.create({
        suite_id: item.suite_id,
        folder_id: item.folder_id,
        protocol: item.protocol,
        name: `${item.name} (copy)`,
        method: item.method,
        url: item.url,
        request_schema: item.request_schema,
        assertions: item.assertions,
        source_endpoint_id: item.source_endpoint_id,
      })) as { success: boolean; data?: { id: string } }
      if (!createRes?.success || !createRes.data) return
      await openSuiteItemTab(createRes.data.id, { pinned: true })
      window.dispatchEvent(new CustomEvent('tests:suite-item-changed'))
      return
    }

    const newId = makeTabId()
    // Open with the same metadata. The unsaved/edited state lives in protocol
    // stores keyed on tabId — clone the source's cache into the new id so
    // unsaved edits travel with the duplicate. Only the request store has a
    // public cloneTabState today; other protocols start from the persisted
    // metadata, which is acceptable until they grow the same hook.
    openTab({
      id: newId,
      name: `${src.name} (copy)`,
      protocol: src.protocol,
      method: src.method,
      url: src.url,
      endpointId: src.endpointId,
      savedRequestId: src.savedRequestId,
      folderId: src.folderId,
    })
    useRequestStore.getState().cloneTabState(tabId, newId)
    // Switch every store onto the new tab so stale per-tab caches are loaded.
    handleSwitchTab(newId)
  }

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingTabId])

  function handleStartRename(tabId: string, currentName: string) {
    setRenamingTabId(tabId)
    setRenameValue(currentName)
  }

  async function handleConfirmRename(tabId: string) {
    if (renameValue.trim()) {
      updateTab(tabId, { name: renameValue.trim() })
      // Also update saved request name in DB and refresh tree
      const tab = tabs.find((t) => t.id === tabId)
      let dbUpdated = false
      if (tab?.savedRequestId) {
        try {
          await window.api?.savedRequest?.update(tab.savedRequestId, { name: renameValue.trim() })
          dbUpdated = true
        } catch {
          /* ignore */
        }
      } else if (tab?.endpointId) {
        try {
          await window.api?.endpoint?.update(tab.endpointId, { name: renameValue.trim() })
          dbUpdated = true
        } catch {
          /* ignore */
        }
      } else if (tab?.testSuiteItemId) {
        try {
          await window.api?.testSuiteItem?.update(tab.testSuiteItemId, {
            name: renameValue.trim(),
          })
          // Suite items aren't in the APIs tree, so refreshTree() doesn't
          // help. Signal the Tests sidebar instead — it listens for this
          // event and reloads its currently-expanded suites.
          window.dispatchEvent(new CustomEvent('tests:suite-item-changed'))
        } catch {
          /* ignore */
        }
      }
      if (dbUpdated) {
        await refreshTree()
      }
    }
    setRenamingTabId(null)
  }

  function handleSwitchTab(tabId: string) {
    if (tabId === activeTabId) return
    // Each protocol store keeps its own per-tab cache — switch them all so
    // every editor renders the activated tab's saved state. Stores that have
    // never seen this tab fall back to their empty/default state.
    switchToTab(tabId)
    useSoapStore.getState().switchToTab(tabId)
    useWebSocketStore.getState().switchToTab(tabId)
    useSseStore.getState().switchToTab(tabId)
    useGrpcStore.getState().switchToTab(tabId)
    useGraphQLStore.getState().switchToTab(tabId)
    useAiChatStore.getState().switchToTab(tabId)
    useMcpStore.getState().switchToTab(tabId)
    useSocketIOStore.getState().switchToTab(tabId)
    clearResponse()
    setActiveTab(tabId)
  }

  /** Switch the active tab + every protocol store to `tabId`. */
  function activateTab(tabId: string) {
    switchToTab(tabId)
    useSoapStore.getState().switchToTab(tabId)
    useWebSocketStore.getState().switchToTab(tabId)
    useSseStore.getState().switchToTab(tabId)
    useGrpcStore.getState().switchToTab(tabId)
    useGraphQLStore.getState().switchToTab(tabId)
    useAiChatStore.getState().switchToTab(tabId)
    useMcpStore.getState().switchToTab(tabId)
    useSocketIOStore.getState().switchToTab(tabId)
  }

  /** Actually close a tab (cleanup + close + re-sync the new active tab). */
  function doCloseTab(tabId: string) {
    cleanupTabState(tabId)
    closeTab(tabId)
    const newActiveId = useTabsStore.getState().activeTabId
    if (newActiveId) {
      activateTab(newActiveId)
      clearResponse()
    }
  }

  /** Close a tab, prompting first if it has unsaved changes (issue #9). */
  function requestCloseTab(tabId: string) {
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (tab?.isDirty) {
      setCloseConfirmTabId(tabId)
    } else {
      doCloseTab(tabId)
    }
  }

  function handleCloseTab(tabId: string, e: React.MouseEvent) {
    e.stopPropagation()
    requestCloseTab(tabId)
  }

  // ─── Unsaved-changes confirm handlers (issue #9) ────────────────
  async function handleCloseSave() {
    const tabId = closeConfirmTabId
    if (!tabId) return
    setCloseSaving(true)
    try {
      // `saveActiveRequestInPlace` targets the ACTIVE tab — make the closing tab
      // active first so a background tab's × still saves the right request.
      if (useTabsStore.getState().activeTabId !== tabId) activateTab(tabId)
      const result = await saveActiveRequestInPlace()
      if (!result.success && !result.notApplicable) {
        toast.error(`Failed to save: ${result.error ?? 'unknown error'}`)
        setCloseSaving(false)
        return // keep the dialog open so the user can retry or cancel
      }
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message || 'unknown error'}`)
      setCloseSaving(false)
      return
    }
    setCloseSaving(false)
    setCloseConfirmTabId(null)
    doCloseTab(tabId)
  }

  function handleCloseDiscard() {
    const tabId = closeConfirmTabId
    setCloseConfirmTabId(null)
    if (tabId) doCloseTab(tabId)
  }

  function handleCloseCancel() {
    if (closeSaving) return
    setCloseConfirmTabId(null)
  }

  function handleNewTab() {
    const id = makeTabId()
    openTab({ id, name: 'New Request', protocol: 'http', method: 'GET', url: '' })
    // Reset every protocol store to its empty baseline for the new tab so the
    // editor doesn't keep showing the previous endpoint's URL / params /
    // headers / scripts. v1.3.1 M1: "+ New" used to clone the last request
    // because activeTabId changed but no store ever flipped to a fresh state.
    switchToTab(id)
    useSoapStore.getState().switchToTab(id)
    useWebSocketStore.getState().switchToTab(id)
    useSseStore.getState().switchToTab(id)
    useGrpcStore.getState().switchToTab(id)
    useGraphQLStore.getState().switchToTab(id)
    useAiChatStore.getState().switchToTab(id)
    useMcpStore.getState().switchToTab(id)
    useSocketIOStore.getState().switchToTab(id)
    clearResponse()
  }

  if (tabs.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: T.white,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        overflowX: 'auto',
        height: 32,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const isPreview = tab.isPreview
        const isDropTarget = dropBeforeId === tab.id
        return (
          <div
            key={tab.id}
            data-testid="endpoint-tab"
            data-tab-name={tab.name}
            data-preview={isPreview ? 'true' : 'false'}
            data-dirty={tab.isDirty ? 'true' : 'false'}
            data-active={isActive ? 'true' : 'false'}
            className="group"
            draggable={renamingTabId !== tab.id}
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_DND_MIME, tab.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TAB_DND_MIME)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              // Left half of the tab → insert before this tab; right half →
              // insert before the NEXT tab. We just toggle the marker; the
              // store call happens on drop.
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const before = e.clientX - rect.left < rect.width / 2
              const targetId = before ? tab.id : null /* placeholder, replaced below */
              if (!before) {
                const idx = tabs.findIndex((t) => t.id === tab.id)
                const next = tabs[idx + 1]
                setDropBeforeId(next ? next.id : null)
              } else {
                setDropBeforeId(targetId)
              }
            }}
            onDragLeave={() => {
              // Defer so we don't flicker when the cursor crosses into an
              // adjacent tab's onDragOver. Cleared on drop anyway.
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes(TAB_DND_MIME)) return
              e.preventDefault()
              const draggedId = readDraggedTabId(e)
              setDropBeforeId(undefined)
              if (!draggedId || draggedId === tab.id) return
              moveTab(draggedId, dropBeforeId === undefined ? tab.id : dropBeforeId)
            }}
            onClick={() => handleSwitchTab(tab.id)}
            onDoubleClick={() => {
              // Double-click pins preview tab (Postman behavior)
              if (isPreview) pinTab(tab.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const x = e.clientX
              const y = e.clientY
              const id = tab.id
              // Defer state update so the current contextmenu event finishes
              // bubbling before the global dismiss listener attaches.
              setTimeout(() => setContextMenu({ tabId: id, x, y }), 0)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '0 10px',
              height: '100%',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              fontStyle: isPreview ? 'italic' : 'normal',
              borderBottom: isActive ? `2px solid ${T.accent}` : '2px solid transparent',
              // Left-edge marker for drop-before-this-tab.
              boxShadow: isDropTarget ? `inset 2px 0 0 0 ${T.accent}` : undefined,
              color: isActive ? T.text : T.muted,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              // Without this, mousedown on the tab label can start a text
              // selection that pre-empts the drag gesture — Chrome's drag
              // policy prefers an in-progress selection over a draggable
              // ancestor. `none` keeps the drag the only thing that can fire.
              userSelect: 'none',
            }}
          >
            {tab.protocol === 'runner' && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                style={{ flexShrink: 0 }}
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
                <path d="M3 9h6" />
                <path d="M3 15h6" />
              </svg>
            )}
            {/* Subtle flask icon marks tabs sourced from a Test Suite — APIs
                tree tabs don't get one. Muted stroke, no fill, no extra
                colour: the discriminator is the shape, not the palette. */}
            {tab.testSuiteItemId && (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
                aria-label="Test suite item"
              >
                <path d="M9 3h6" />
                <path d="M10 3v6.5L5.5 19a2 2 0 0 0 1.7 3h9.6a2 2 0 0 0 1.7-3L14 9.5V3" />
              </svg>
            )}
            {tab.method && (tab.protocol === 'http' || tab.protocol === 'soap') && (
              <MethodBadge method={tab.method} small />
            )}
            {renamingTabId === tab.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmRename(tab.id)
                  if (e.key === 'Escape') setRenamingTabId(null)
                }}
                onBlur={() => handleConfirmRename(tab.id)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.accent}`,
                  borderRadius: 3,
                  padding: '0 4px',
                  fontSize: 13,
                  color: T.text,
                  outline: 'none',
                  width: 120,
                  fontStyle: 'normal',
                }}
              />
            ) : (
              // `draggable={false}` here is critical: an inner span carrying
              // text is treated by Chrome as a "selection-drag" source, which
              // races against the parent's draggable=true and can swallow the
              // tab-drag gesture entirely (the SOAP tab in particular sees
              // the user mouse-down on this label). Forcing the span out of
              // the drag-source set lets the gesture bubble to the parent.
              <span
                draggable={false}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (isPreview) {
                    pinTab(tab.id)
                  } else {
                    handleStartRename(tab.id, tab.name)
                  }
                }}
              >
                {tab.name}
              </span>
            )}
            {tab.isDirty && (
              <span
                data-testid="tab-dirty"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: T.accent,
                  flexShrink: 0,
                }}
              />
            )}
            <span
              data-testid="tab-close"
              className="hidden cursor-pointer group-hover:inline"
              style={{ color: T.ghost, fontSize: 13 }}
              onClick={(e) => handleCloseTab(tab.id, e)}
            >
              ×
            </span>
          </div>
        )
      })}

      {/* + new tab */}
      <div
        onClick={handleNewTab}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 10px',
          height: '100%',
          cursor: 'pointer',
          color: T.ghost,
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        +
      </div>

      {/* Drop zone for "move tab to end" — covers the empty space to the
          right of the + button so users can drop past every existing tab. */}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_DND_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (dropBeforeId !== null) setDropBeforeId(null)
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(TAB_DND_MIME)) return
          e.preventDefault()
          const draggedId = readDraggedTabId(e)
          setDropBeforeId(undefined)
          if (draggedId) moveTab(draggedId, null)
        }}
        style={{ flex: 1, height: '100%' }}
      />

      {/* Environment selector (Postman parity — right end of tab bar) */}
      <div className="flex shrink-0 items-center" style={{ paddingRight: 10, paddingLeft: 8 }}>
        <EnvironmentSelector />
      </div>

      {contextMenu &&
        createPortal(
          <div
            className="fixed z-[9000] overflow-hidden rounded-[8px]"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
              minWidth: 220,
              background: 'var(--white)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-drop)',
              padding: 4,
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <ContextMenuItem
              label="New Request"
              shortcut={cmdOrCtrl('T')}
              onClick={() => handleTabContextAction(contextMenu.tabId, 'newRequest')}
            />
            <ContextMenuItem
              label="Duplicate Tab"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'duplicate')}
            />
            <div style={{ height: 1, background: 'var(--border-split)', margin: '4px 0' }} />
            <ContextMenuItem
              label="Close Tab"
              shortcut={cmdOrCtrl('W')}
              onClick={() => handleTabContextAction(contextMenu.tabId, 'close')}
            />
            <ContextMenuItem
              label="Force Close Tab"
              shortcut={altCmdOrCtrl('W')}
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeForce')}
            />
            <ContextMenuItem
              label="Close Other Tabs"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeOthers')}
            />
            <ContextMenuItem
              label="Close to the Left"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeLeft')}
            />
            <ContextMenuItem
              label="Close to the Right"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeRight')}
            />
            <ContextMenuItem
              label="Close All Tabs"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeAll')}
            />
            <ContextMenuItem
              label="Force Close All Tabs"
              danger
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeAllForce')}
            />
          </div>,
          document.body,
        )}

      <UnsavedChangesDialog
        open={closeConfirmTabId !== null}
        itemName={allTabs.find((t) => t.id === closeConfirmTabId)?.name ?? 'this request'}
        saving={closeSaving}
        onSave={handleCloseSave}
        onDiscard={handleCloseDiscard}
        onCancel={handleCloseCancel}
      />
    </div>
  )
}

function cmdOrCtrl(key: string): string {
  return isMac() ? `⌘${key}` : `Ctrl+${key}`
}
function altCmdOrCtrl(key: string): string {
  return isMac() ? `⌥⌘${key}` : `Ctrl+Alt+${key}`
}

function ContextMenuItem({
  label,
  onClick,
  danger,
  shortcut,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  shortcut?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center justify-between rounded-md text-left"
      style={{
        background: 'transparent',
        border: 'none',
        padding: '6px 10px',
        fontSize: 13,
        color: danger ? '#cc2200' : 'var(--text)',
        gap: 24,
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = danger ? '#fff0f0' : 'var(--surface)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
      }}
    >
      <span>{label}</span>
      {shortcut && (
        <span style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          {shortcut}
        </span>
      )}
    </button>
  )
}

export default function Workbench() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeSidebarPage = useUIStore((s) => s.activeSidebarPage)
  // Tab "lives" on a specific sidebar page (runner → Tests, mockServer → Mocks,
  // everything else → APIs). When the active tab belongs to a different page
  // we treat it as absent so the workbench falls through to the page-aware
  // welcome instead of leaking a runner UI into the APIs view.
  const activeTab = tabs.find((t) => t.id === activeTabId && tabBelongsToPage(t, activeSidebarPage))
  const protocol = activeTab?.protocol || 'http'
  const addEndpointsSuiteId = useUIStore((s) => s.addEndpointsSuiteId)

  // Global tab keyboard shortcuts (mirror the labels shown in the tab
  // right-click menu). Mounted once at workbench scope so they fire
  // regardless of which tab/editor has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Skip when typing inside Monaco / inputs unless the modifier combo is
      // unambiguous — Cmd+W is special-cased so users can close tabs from
      // anywhere.
      if (e.key === 't' || e.key === 'T') {
        if (e.altKey || e.shiftKey) return
        e.preventDefault()
        const id = makeTabId()
        useTabsStore.getState().openTab({
          id,
          name: 'New Request',
          protocol: 'http',
          method: 'GET',
          url: '',
        })
        return
      }
      if (e.key === 'w' || e.key === 'W') {
        const force = e.altKey
        const currentId = useTabsStore.getState().activeTabId
        if (!currentId) return
        e.preventDefault()
        const target = useTabsStore.getState().tabs.find((t) => t.id === currentId)
        if (!force && target?.isDirty) {
          const ok = window.confirm('This tab has unsaved changes. Close anyway?')
          if (!ok) return
        }
        cleanupTabState(currentId)
        useTabsStore.getState().closeTab(currentId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Add Endpoints view — takes over the workbench content area
  if (addEndpointsSuiteId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <AddEndpointsView />
      </div>
    )
  }

  // No active tab for the current page — show the page's welcome surface.
  if (!activeTab) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <PageWelcome page={activeSidebarPage} />
      </div>
    )
  }

  const isNewEmptyTab = activeTab.name === 'New Request' && !activeTab.url

  if (isNewEmptyTab) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <NewRequestWelcome />
      </div>
    )
  }

  // Each protocol editor below is keyed by `activeTab.id` so a fast tab
  // switch remounts the editor with the new tab's state. Without this, local
  // component state (Monaco models, useState in sub-tabs, scroll positions)
  // from the previous tab can leak into the next. Zustand state is already
  // tab-aware; this pins the React tree to the same boundary.
  if (protocol === 'soap') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <SoapEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'websocket') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <WebSocketEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'graphql') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <GraphQLEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'grpc') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <GrpcEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'sse') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <SseEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'ai') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <AiChatEditor key={activeTab.id} />
      </div>
    )
  }

  // Tools (JWT, Hash, Encoders, …): render every OPEN tool tab and toggle
  // visibility so each tool's local input state survives switching to another
  // tool tab and back, instead of unmounting and losing it. One lightweight
  // instance per open tool tab.
  if (protocol.startsWith('tools.')) {
    const toolTabs = tabs.filter(
      (t) => t.protocol.startsWith('tools.') && tabBelongsToPage(t, activeSidebarPage),
    )
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <div className="relative flex-1 overflow-hidden">
          {toolTabs.map((t) => {
            const ToolComp = TOOL_COMPONENTS[t.protocol]
            if (!ToolComp) return null
            const isActive = t.id === activeTab.id
            return (
              <div
                key={t.id}
                className="absolute inset-0 flex flex-col overflow-hidden"
                style={{ display: isActive ? 'flex' : 'none' }}
                aria-hidden={!isActive}
              >
                <ToolComp />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (protocol === 'mockServer') {
    const id = activeTab.mockServerId ?? ''
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <MockServerEditor key={id} serverId={id} />
      </div>
    )
  }

  if (protocol === 'mcp') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <McpEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'socketio') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <SocketIOEditor key={activeTab.id} />
      </div>
    )
  }

  if (protocol === 'runner') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <RunnerTab
          folderId={activeTab.folderId}
          tabId={activeTab.id}
          sessionKey={activeTab.sessionKey}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Endpoint tab bar */}
        <EndpointTabBar />

        {/* URL Bar */}
        <UrlBar />

        {/* URL Preview — shows resolved variables (Postman-style) */}
        <UrlPreview />

        {/* Split pane: Request (top) | Response (bottom).
         *
         * `key={activeTab.id}` is intentional — it forces RequestEditor and
         * ResponsePane to remount on every tab switch. Without this, the
         * Monaco editor inside RequestEditor and any local component state
         * (`useState` in BodyTab, ResultRow, ResponsePane sub-tabs) would
         * survive across tabs and could leak the previous request's content
         * into the next one when the user switches quickly. The Zustand
         * stores are already tab-aware, but the React component instances
         * are not — this is the simplest atomic fix. */}
        <PanelGroup direction="vertical" className="flex-1">
          <Panel defaultSize={65} minSize={25} maxSize={85}>
            <RequestEditor key={activeTab.id} />
          </Panel>

          <PanelResizeHandle
            className="shrink-0 transition-colors hover:bg-[var(--accent)]"
            style={{ height: 4, background: 'var(--border)', cursor: 'row-resize' }}
          />

          <Panel defaultSize={35} minSize={15} maxSize={75}>
            <ResponsePane key={activeTab.id} />
          </Panel>
        </PanelGroup>
      </div>

      {/* Drag divider between the workbench and the Variables pane (issue #15) */}
      <EdgeResizeHandle target="right" />

      {/* Right: Postman-style tabbed panel (Variables / Code / ...) */}
      <RightPanel />
    </div>
  )
}
