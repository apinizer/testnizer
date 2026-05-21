import { useState, useEffect } from 'react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import { useWebSocketStore } from '../../stores/websocket.store'
import { useSseStore } from '../../stores/sse.store'
import { useTranslation } from '../../lib/i18n'
import Modal from '../shared/Modal'
import type { Folder, Tab } from '../../types'

export default function EndpointSaveModal() {
  const { t } = useTranslation()
  const show = useUIStore((s) => s.showEndpointSaveModal)
  const setShow = useUIStore((s) => s.setShowEndpointSaveModal)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)
  const activeTab = useTabsStore((s) => {
    const tabs = s.tabs
    const id = s.activeTabId
    return tabs.find((t) => t.id === id)
  })
  const url = useRequestStore((s) => s.url)
  const method = useRequestStore((s) => s.method)
  const params = useRequestStore((s) => s.params)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)
  const preScript = useRequestStore((s) => s.preScript)
  const postScript = useRequestStore((s) => s.postScript)
  const assertions = useRequestStore((s) => s.assertions)

  const [endpointName, setEndpointName] = useState(t('endpointSave.defaultName'))
  const [selectedFolder, setSelectedFolder] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})

  // Are we editing an existing saved endpoint? Drives label changes
  // ("Update" instead of "Save") and surfaces the overwrite hint.
  const existingSavedRequestId = activeTab?.savedRequestId
  const isUpdate = !!existingSavedRequestId

  useEffect(() => {
    if (show && activeProjectId) {
      setEndpointName(activeTab?.name || t('endpointSave.defaultName'))
      // Reset folder selection on every open so the dropdown does not leak
      // across modal sessions (the modal is mounted at AppShell level and
      // only hidden via `if (!show) return null`, so state survives close).
      setSelectedFolder('')
      loadFolders()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, activeProjectId])

  async function loadFolders() {
    if (!activeProjectId) return
    try {
      const result = (await window.api?.folder?.list(activeProjectId)) as {
        success: boolean
        data?: Folder[]
      }
      if (result?.success && result.data) {
        setFolders(result.data)

        // Pre-select the existing folder when updating. A null folder_id
        // means the saved request lives at the project root — leave the
        // selection empty in that case so the auto-select fallback below is
        // skipped and we don't silently relocate the request.
        if (isUpdate && activeTab?.savedRequestId) {
          try {
            const sr = (await window.api?.savedRequest?.get(activeTab.savedRequestId)) as {
              success: boolean
              data?: { folder_id?: string | null }
            }
            if (sr?.success) {
              setSelectedFolder(sr.data?.folder_id ?? '')
              return
            }
          } catch {
            /* fall through */
          }
        }
        if (result.data.length > 0 && !selectedFolder) {
          setSelectedFolder(result.data[0].id)
        }
      }
    } catch {
      // IPC not available
    }
  }

  if (!show) return null

  function handleClose() {
    setShow(false)
    setCreatingFolder(false)
    setNewFolderName('')
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || !activeProjectId) return
    try {
      const result = (await window.api?.folder?.create({
        project_id: activeProjectId,
        name: newFolderName.trim(),
      })) as { success: boolean; data?: Folder }
      if (result?.success && result.data) {
        setSelectedFolder(result.data.id)
        setCreatingFolder(false)
        setNewFolderName('')
        await loadFolders()
        await refreshTree()
      }
    } catch {
      // Error
    }
  }

  async function handleSave() {
    if (!activeProjectId) return
    setSaving(true)
    setSaveError(null)
    try {
      // Pull protocol-specific data from the matching store. The legacy
      // EndpointSaveModal only ever read useRequestStore (HTTP), which is
      // why saving a SOAP / WebSocket / SSE tab into a folder used to
      // persist an empty HTTP request and lose the original protocol
      // payload (v1.4.2 T-12.6/8/9).
      const protocol = (activeTab?.protocol ?? 'http') as string
      let effectiveUrl = url
      let effectiveMethod = method
      let effectiveBody: unknown = body
      const protocolMeta: Record<string, unknown> = {}

      if (protocol === 'soap') {
        const soap = useSoapStore.getState()
        effectiveUrl = soap.endpointUrl || soap.wsdlUrl || url
        effectiveMethod = 'POST'
        effectiveBody = { type: 'xml', content: soap.rawXml }
        protocolMeta.soap = {
          wsdlUrl: soap.wsdlUrl,
          selectedService: soap.selectedService,
          selectedPort: soap.selectedPort,
          selectedOperation: soap.selectedOperation,
          bodyMode: soap.bodyMode,
          wsSecurity: soap.wsSecurity,
        }
      } else if (protocol === 'websocket') {
        const ws = useWebSocketStore.getState()
        effectiveUrl = ws.url || url
        effectiveMethod = 'GET'
        effectiveBody = { type: 'none' }
      } else if (protocol === 'sse') {
        const sse = useSseStore.getState()
        effectiveUrl = sse.url || url
        effectiveMethod = sse.method || 'GET'
        effectiveBody = { type: sse.bodyType === 'json' ? 'json' : 'text', content: sse.body }
      }

      const payload = {
        name: endpointName.trim() || 'Untitled',
        method: effectiveMethod,
        url: effectiveUrl,
        protocol,
        params: JSON.stringify(params),
        headers: JSON.stringify(headers),
        body: JSON.stringify(effectiveBody),
        auth: JSON.stringify(auth),
        pre_script: preScript,
        post_script: postScript,
        assertions: JSON.stringify(assertions),
        folder_id: selectedFolder || null,
        ...(Object.keys(protocolMeta).length > 0 ? { metadata: JSON.stringify(protocolMeta) } : {}),
      }

      let savedId: string | undefined

      if (isUpdate && existingSavedRequestId) {
        // Update + move (folder change is included in the same call).
        const result = (await window.api?.savedRequest?.update(
          existingSavedRequestId,
          payload,
        )) as { success: boolean; data?: { id: string } }
        if (result?.success) {
          savedId = existingSavedRequestId
        }
      } else {
        const result = (await window.api?.savedRequest?.create({
          project_id: activeProjectId,
          ...payload,
        })) as { success: boolean; data?: { id: string } }
        savedId = result?.data?.id
      }

      // Refresh tree to show the saved endpoint (or surface the move).
      await refreshTree()

      // Only mutate tab state when the IPC actually succeeded. On a soft
      // `{success:false}` we'd otherwise wipe `savedRequestId` (because
      // `updateTab` shallow-merges `undefined` over the existing id),
      // orphaning the original DB row and turning the next Save into a
      // duplicate-creating "create" branch.
      if (savedId) {
        const tabId = useTabsStore.getState().activeTabId
        if (tabId) {
          useTabsStore.getState().markDirty(tabId, false)
          useTabsStore.getState().updateTab(tabId, {
            name: endpointName.trim() || 'Untitled',
            savedRequestId: savedId,
            // Sync the tab badge with the current method so changing
            // GET → POST in the URL bar then saving updates the
            // method chip on the tab immediately, without requiring a
            // close + reopen of the tab (v1.4.2 T-12.2).
            method: effectiveMethod,
            url: effectiveUrl,
            protocol: protocol as Tab['protocol'],
          })
        }
        handleClose()
      }
    } catch (e) {
      // IPC threw — keep modal open so the user can retry; tab state is
      // intact because we never reached the updateTab call above. Surface
      // the failure so the user knows why nothing happened (previously
      // silently swallowed → modal looked frozen).
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={show} onOpenChange={(o) => !o && handleClose()} title="Save endpoint">
      <div
        style={{
          background: 'var(--white)',
          borderRadius: 14,
          width: 420,
          boxShadow: '0 16px 48px rgba(0,0,0,0.14)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: 'var(--heading)',
              fontFamily: 'inherit',
            }}
          >
            {isUpdate ? t('endpointSave.titleUpdate') : t('endpointSave.title')}
          </span>
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: 'var(--hint)',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isUpdate && (
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.45,
                color: 'var(--muted)',
                background: 'var(--accent-light)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 11px',
                fontFamily: 'inherit',
              }}
            >
              {t('endpointSave.alreadySavedHint')}
            </div>
          )}

          {/* Endpoint name */}
          <div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                fontWeight: 500,
                marginBottom: 5,
                fontFamily: 'inherit',
              }}
            >
              {t('endpointSave.endpointName')}
            </div>
            <input
              value={endpointName}
              onChange={(e) => setEndpointName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
              autoFocus
              style={{
                width: '100%',
                background: 'var(--white)',
                border: '1.5px solid var(--border2)',
                borderRadius: 8,
                padding: '8px 11px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box' as const,
              }}
            />
          </div>

          {/* Folder selection */}
          <div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                fontWeight: 500,
                marginBottom: 8,
                fontFamily: 'inherit',
              }}
            >
              {t('endpointSave.saveToFolder')}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                maxHeight: 280,
                overflowY: 'auto',
                scrollbarGutter: 'stable',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 4,
                background: 'var(--surface)',
              }}
            >
              {(() => {
                const childrenOf = new Map<string | null, Folder[]>()
                for (const f of folders) {
                  const arr = childrenOf.get(f.parent_id) ?? []
                  arr.push(f)
                  childrenOf.set(f.parent_id, arr)
                }

                const renderNodes = (parentId: string | null, depth: number): React.ReactNode[] => {
                  const nodes = childrenOf.get(parentId) ?? []
                  return nodes.map((f) => {
                    const children = childrenOf.get(f.id) ?? []
                    const hasChildren = children.length > 0
                    const isExpanded = expandedFolders[f.id] ?? true
                    const isSelected = selectedFolder === f.id
                    return (
                      <div key={f.id}>
                        <div
                          onClick={() => {
                            setSelectedFolder(f.id)
                            setCreatingFolder(false)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 8px',
                            paddingLeft: 8 + depth * 14,
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: isSelected ? 'var(--accent-light)' : 'transparent',
                          }}
                        >
                          {hasChildren ? (
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedFolders((s) => ({ ...s, [f.id]: !isExpanded }))
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 14,
                                height: 14,
                                color: 'var(--hint)',
                                cursor: 'pointer',
                                userSelect: 'none',
                                transition: 'transform 0.12s',
                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              }}
                            >
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5l8 7-8 7z" />
                              </svg>
                            </span>
                          ) : (
                            <span style={{ display: 'inline-block', width: 14 }} />
                          )}
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill={isSelected ? '#2D5FA0' : '#fbbf24'}
                            stroke="none"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span
                            style={{
                              flex: 1,
                              fontSize: 13,
                              color: isSelected ? 'var(--accent-text)' : 'var(--text)',
                              fontWeight: isSelected ? 500 : 400,
                              fontFamily: 'inherit',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {f.name}
                          </span>
                          {isSelected && (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#2D5FA0"
                              strokeWidth="2.5"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        {hasChildren && isExpanded && renderNodes(f.id, depth + 1)}
                      </div>
                    )
                  })
                }

                return renderNodes(null, 0)
              })()}

              {/* No folders message */}
              {folders.length === 0 && !creatingFolder && (
                <div
                  style={{
                    padding: '12px 0',
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--hint)',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('endpointSave.noFolders')}
                </div>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Create new folder */}
              {!creatingFolder ? (
                <button
                  type="button"
                  onClick={() => setCreatingFolder(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 12px',
                    background: 'var(--white)',
                    border: '1.5px dashed var(--border2)',
                    borderRadius: 8,
                    color: 'var(--hint)',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t('endpointSave.createFolder')}
                </button>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    border: '1.5px solid var(--accent)',
                    borderRadius: 8,
                    background: 'var(--white)',
                  }}
                >
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') {
                        setCreatingFolder(false)
                        setNewFolderName('')
                      }
                    }}
                    placeholder={t('endpointSave.folderNamePlaceholder')}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: 13,
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFolder(false)
                      setNewFolderName('')
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--hint)',
                      cursor: 'pointer',
                      fontSize: 16,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          {saveError && (
            <span
              style={{
                color: 'var(--red, #cc2200)',
                fontSize: 12,
                marginRight: 'auto',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 380,
              }}
              title={saveError}
            >
              {saveError}
            </span>
          )}
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '7px 14px',
              background: 'var(--white)',
              border: '1.5px solid var(--border2)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 18px',
              background: saving ? 'var(--hint)' : '#2D5FA0',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {saving
              ? isUpdate
                ? t('endpointSave.updating')
                : t('common.saving')
              : isUpdate
                ? t('endpointSave.update')
                : t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
