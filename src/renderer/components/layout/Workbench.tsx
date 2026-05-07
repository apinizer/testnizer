import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import UrlBar from './UrlBar'
import RequestEditor from '../request/RequestEditor'
import ResponsePane from '../response/ResponsePane'
import SoapEditor from '../protocols/SoapEditor'
import WebSocketEditor from '../protocols/WebSocketEditor'
import GraphQLEditor from '../protocols/GraphQLEditor'
import GrpcEditor from '../protocols/GrpcEditor'
import SseEditor from '../protocols/SseEditor'
import AiChatEditor from '../protocols/AiChatEditor'
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
import RightPanel from './RightPanel'
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
import NewRequestWelcome from './NewRequestWelcome'
import ProjectWelcome from './ProjectWelcome'
import AddEndpointsView from '../runner/AddEndpointsView'
import MethodBadge from '../shared/MethodBadge'
import EnvironmentSelector from '../shared/EnvironmentSelector'
import { T } from '../../styles/tokens'

/**
 * Tear down state belonging to a tab being closed. Every protocol store now
 * keeps a per-tab cache keyed on `tabId`; calling `removeTabState(tabId)`
 * disposes any live subscription/connection that tab owns. The SOAP/HTTP
 * stores have always been per-tab; WS/SSE/gRPC/GraphQL/AI Chat were converted
 * to the same pattern so two tabs of the same protocol no longer share state.
 */
function cleanupTabState(tabId: string): void {
  const allTabs = useTabsStore.getState().tabs
  const closing = allTabs.find((t) => t.id === tabId)
  if (!closing) return

  useRequestStore.getState().removeTabState(tabId)
  useSoapStore.getState().removeTabState(tabId)
  useWebSocketStore.getState().removeTabState(tabId)
  useSseStore.getState().removeTabState(tabId)
  useGrpcStore.getState().removeTabState(tabId)
  useGraphQLStore.getState().removeTabState(tabId)
  useAiChatStore.getState().removeTabState(tabId)
}

function EndpointTabBar() {
  const tabs = useTabsStore((s) => s.tabs)
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

  function handleTabContextAction(
    tabId: string,
    action: 'close' | 'closeOthers' | 'closeRight' | 'closeLeft' | 'closeAll' | 'rename',
  ) {
    setContextMenu(null)
    const allTabs = useTabsStore.getState().tabs
    const idx = allTabs.findIndex((t) => t.id === tabId)
    if (idx < 0) return
    const idsToClose: string[] = []
    if (action === 'close') idsToClose.push(tabId)
    else if (action === 'closeOthers') idsToClose.push(...allTabs.filter((t) => t.id !== tabId).map((t) => t.id))
    else if (action === 'closeRight') idsToClose.push(...allTabs.slice(idx + 1).map((t) => t.id))
    else if (action === 'closeLeft') idsToClose.push(...allTabs.slice(0, idx).map((t) => t.id))
    else if (action === 'closeAll') idsToClose.push(...allTabs.map((t) => t.id))
    else if (action === 'rename') {
      const target = allTabs.find((t) => t.id === tabId)
      if (target) handleStartRename(tabId, target.name)
      return
    }
    for (const id of idsToClose) {
      cleanupTabState(id)
      closeTab(id)
    }
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
    clearResponse()
    setActiveTab(tabId)
  }

  function handleCloseTab(tabId: string, e: React.MouseEvent) {
    e.stopPropagation()
    cleanupTabState(tabId)
    closeTab(tabId)
    const newActiveId = useTabsStore.getState().activeTabId
    if (newActiveId) {
      switchToTab(newActiveId)
      useSoapStore.getState().switchToTab(newActiveId)
      useWebSocketStore.getState().switchToTab(newActiveId)
      useSseStore.getState().switchToTab(newActiveId)
      useGrpcStore.getState().switchToTab(newActiveId)
      useGraphQLStore.getState().switchToTab(newActiveId)
      useAiChatStore.getState().switchToTab(newActiveId)
      clearResponse()
    }
  }

  function handleNewTab() {
    const id = 'tab-' + Math.random().toString(36).substring(2, 10)
    openTab({ id, name: 'New Request', protocol: 'http', method: 'GET', url: '' })
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
        return (
          <div
            key={tab.id}
            className="group"
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
              color: isActive ? T.text : T.muted,
              whiteSpace: 'nowrap',
              flexShrink: 0,
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
            {tab.method && tab.protocol !== 'runner' && <MethodBadge method={tab.method} small />}
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
              <span
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

      {/* Push environment selector to right end */}
      <div style={{ flex: 1 }} />

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
              minWidth: 200,
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
              label="Rename"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'rename')}
            />
            <ContextMenuItem
              label="Close"
              onClick={() => handleTabContextAction(contextMenu.tabId, 'close')}
            />
            <ContextMenuItem
              label="Close Others"
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
            <div style={{ height: 1, background: 'var(--border-split)', margin: '4px 0' }} />
            <ContextMenuItem
              label="Close All"
              danger
              onClick={() => handleTabContextAction(contextMenu.tabId, 'closeAll')}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}

function ContextMenuItem({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center rounded-md text-left"
      style={{
        background: 'transparent',
        border: 'none',
        padding: '6px 10px',
        fontSize: 13,
        color: danger ? '#cc2200' : 'var(--text)',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = danger ? '#fff0f0' : 'var(--surface)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

export default function Workbench() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const protocol = activeTab?.protocol || 'http'
  const addEndpointsSuiteId = useUIStore((s) => s.addEndpointsSuiteId)

  // Add Endpoints view — takes over the workbench content area
  if (addEndpointsSuiteId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <AddEndpointsView />
      </div>
    )
  }

  // No active tab — show project welcome
  if (!activeTab) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <ProjectWelcome />
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

  if (protocol === 'soap') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <SoapEditor />
      </div>
    )
  }

  if (protocol === 'websocket') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <WebSocketEditor />
      </div>
    )
  }

  if (protocol === 'graphql') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <GraphQLEditor />
      </div>
    )
  }

  if (protocol === 'grpc') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <GrpcEditor />
      </div>
    )
  }

  if (protocol === 'sse') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <SseEditor />
      </div>
    )
  }

  if (protocol === 'ai') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <AiChatEditor />
      </div>
    )
  }

  if (protocol === 'tools.jwt') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <JwtTool />
      </div>
    )
  }

  if (protocol === 'tools.jsonFormat') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <JsonFormatTool />
      </div>
    )
  }

  if (protocol === 'tools.xmlFormat') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <XmlFormatTool />
      </div>
    )
  }

  if (protocol === 'tools.encode') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <EncodeTool />
      </div>
    )
  }

  if (protocol === 'tools.diff') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <DiffTool />
      </div>
    )
  }

  if (protocol === 'tools.jsonpath') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <JsonPathTool />
      </div>
    )
  }

  if (protocol === 'tools.xpath') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <XPathTool />
      </div>
    )
  }

  if (protocol === 'tools.xslt') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <XsltTool />
      </div>
    )
  }

  if (protocol === 'tools.jolt') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <JoltTool />
      </div>
    )
  }

  if (protocol === 'tools.wsSecurity') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <EndpointTabBar />
        <WsSecurityTool />
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

        {/* Split pane: Request (top) | Response (bottom) */}
        <PanelGroup direction="vertical" className="flex-1">
          <Panel defaultSize={65} minSize={25} maxSize={85}>
            <RequestEditor />
          </Panel>

          <PanelResizeHandle
            className="shrink-0 transition-colors hover:bg-[var(--accent)]"
            style={{ height: 4, background: 'var(--border)', cursor: 'row-resize' }}
          />

          <Panel defaultSize={35} minSize={15} maxSize={75}>
            <ResponsePane />
          </Panel>
        </PanelGroup>
      </div>

      {/* Right: Postman-style tabbed panel (Variables / Code / ...) */}
      <RightPanel />
    </div>
  )
}
