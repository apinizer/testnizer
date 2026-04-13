import { useState, useRef, useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import UrlBar from './UrlBar'
import RequestEditor from '../request/RequestEditor'
import ResponsePane from '../response/ResponsePane'
import SoapEditor from '../protocols/SoapEditor'
import WebSocketEditor from '../protocols/WebSocketEditor'
import GraphQLEditor from '../protocols/GraphQLEditor'
import GrpcEditor from '../protocols/GrpcEditor'
import SseEditor from '../protocols/SseEditor'
import { useTabsStore } from '../../stores/tabs.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import NewRequestWelcome from './NewRequestWelcome'
import ProjectWelcome from './ProjectWelcome'
import MethodBadge from '../shared/MethodBadge'
import EnvironmentSelector from '../shared/EnvironmentSelector'
import { T } from '../../styles/tokens'

function EndpointTabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const openTab = useTabsStore((s) => s.openTab)
  const pinTab = useTabsStore((s) => s.pinTab)
  const updateTab = useTabsStore((s) => s.updateTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const removeTabState = useRequestStore((s) => s.removeTabState)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

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
        } catch { /* ignore */ }
      } else if (tab?.endpointId) {
        try {
          await window.api?.endpoint?.update(tab.endpointId, { name: renameValue.trim() })
          dbUpdated = true
        } catch { /* ignore */ }
      }
      if (dbUpdated) {
        await refreshTree()
      }
    }
    setRenamingTabId(null)
  }

  function handleSwitchTab(tabId: string) {
    if (tabId === activeTabId) return
    switchToTab(tabId)
    clearResponse()
    setActiveTab(tabId)
  }

  function handleCloseTab(tabId: string, e: React.MouseEvent) {
    e.stopPropagation()
    removeTabState(tabId)
    closeTab(tabId)
    const newActiveId = useTabsStore.getState().activeTabId
    if (newActiveId) {
      switchToTab(newActiveId)
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
            {tab.method && <MethodBadge method={tab.method} small />}
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
                  fontSize: 12,
                  color: T.text,
                  outline: 'none',
                  width: 120,
                  fontStyle: 'normal',
                }}
              />
            ) : (
              <span onDoubleClick={(e) => {
                e.stopPropagation()
                if (isPreview) {
                  pinTab(tab.id)
                } else {
                  handleStartRename(tab.id, tab.name)
                }
              }}>
                {tab.name}
              </span>
            )}
            {tab.isDirty && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.accent, flexShrink: 0 }} />
            )}
            <span
              className="hidden cursor-pointer group-hover:inline"
              style={{ color: T.ghost, fontSize: 14 }}
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

      {/* ··· more */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          height: '100%',
          cursor: 'pointer',
          color: T.ghost,
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        ···
      </div>

      {/* Push environment selector to right end */}
      <div style={{ flex: 1 }} />

      {/* Environment selector (Postman parity — right end of tab bar) */}
      <div
        className="flex shrink-0 items-center"
        style={{ paddingRight: 10, paddingLeft: 8 }}
      >
        <EnvironmentSelector />
      </div>
    </div>
  )
}

export default function Workbench() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const protocol = activeTab?.protocol || 'http'

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* Endpoint tab bar */}
      <EndpointTabBar />

      {/* URL Bar */}
      <UrlBar />

      {/* Split pane: Request (top) | Response (bottom) */}
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={50} minSize={20} maxSize={80}>
          <RequestEditor />
        </Panel>

        <PanelResizeHandle
          className="shrink-0"
          style={{ height: 1, background: 'var(--border)', cursor: 'row-resize' }}
        />

        <Panel defaultSize={50} minSize={20} maxSize={80}>
          <ResponsePane />
        </Panel>
      </PanelGroup>
    </div>
  )
}
