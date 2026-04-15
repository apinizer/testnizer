import { useState, useEffect } from 'react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useTabsStore } from '../../stores/tabs.store'
import type { Folder } from '../../types'

export default function EndpointSaveModal() {
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

  const [endpointName, setEndpointName] = useState('Yeni Endpoint')
  const [selectedFolder, setSelectedFolder] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [saving, setSaving] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])

  useEffect(() => {
    if (show && activeProjectId) {
      setEndpointName(activeTab?.name || 'Yeni Endpoint')
      loadFolders()
    }
  }, [show, activeProjectId])

  async function loadFolders() {
    if (!activeProjectId) return
    try {
      const result = await window.api?.folder?.list(activeProjectId) as { success: boolean; data?: Folder[] }
      if (result?.success && result.data) {
        setFolders(result.data)
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
      const result = await window.api?.folder?.create({
        project_id: activeProjectId,
        name: newFolderName.trim(),
      }) as { success: boolean; data?: Folder }
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
    try {
      const result = await window.api?.savedRequest?.create({
        project_id: activeProjectId,
        folder_id: selectedFolder || null,
        name: endpointName.trim() || 'Untitled',
        method,
        url,
        protocol: 'http',
        params: JSON.stringify(params),
        headers: JSON.stringify(headers),
        body: JSON.stringify(body),
        auth: JSON.stringify(auth),
        pre_script: preScript,
        post_script: postScript,
        assertions: JSON.stringify(assertions),
      }) as { success: boolean; data?: { id: string } }

      // Refresh tree to show the saved endpoint
      await refreshTree()

      // Update current tab with savedRequestId so future saves update in place
      const tabId = useTabsStore.getState().activeTabId
      if (tabId) {
        useTabsStore.getState().markDirty(tabId, false)
        useTabsStore.getState().updateTab(tabId, {
          name: endpointName.trim() || 'Untitled',
          savedRequestId: result?.data?.id,
        })
      }
      handleClose()
    } catch {
      // Error
    }
    setSaving(false)
  }

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
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
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--heading)', fontFamily: 'inherit' }}>
            Endpoint'i Kaydet
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
          {/* Endpoint name */}
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500, marginBottom: 5, fontFamily: 'inherit' }}>
              Endpoint Adı
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
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500, marginBottom: 8, fontFamily: 'inherit' }}>
              Klasöre Kaydet
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {folders.map((f) => (
                <div
                  key={f.id}
                  onClick={() => {
                    setSelectedFolder(f.id)
                    setCreatingFolder(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `1.5px solid ${selectedFolder === f.id ? '#5b6af0' : 'var(--border)'}`,
                    background: selectedFolder === f.id ? 'var(--accent-light)' : 'var(--white)',
                    transition: 'all 0.12s',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={selectedFolder === f.id ? '#5b6af0' : '#fbbf24'} stroke="none">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: selectedFolder === f.id ? 'var(--accent-text)' : 'var(--sub, var(--text))',
                      fontWeight: selectedFolder === f.id ? 500 : 400,
                      fontFamily: 'inherit',
                    }}
                  >
                    {f.name}
                  </span>
                  {selectedFolder === f.id && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b6af0" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              ))}

              {/* No folders message */}
              {folders.length === 0 && !creatingFolder && (
                <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 13, color: 'var(--hint)', fontFamily: 'inherit' }}>
                  Henüz klasör yok
                </div>
              )}

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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Yeni klasör oluştur
                </button>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '8px 12px',
                    border: '1.5px solid #5b6af0',
                    borderRadius: 8,
                    background: '#eef0fe',
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
                    placeholder="Klasör adı..."
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
            justifyContent: 'flex-end',
          }}
        >
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
            İptal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 18px',
              background: saving ? 'var(--hint)' : '#5b6af0',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
