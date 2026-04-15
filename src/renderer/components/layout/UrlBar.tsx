import { useState, useRef, useEffect, useCallback } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useUIStore } from '../../stores/ui.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import MethodBadge from '../shared/MethodBadge'
import VariableAutocompleteInput from '../shared/VariableAutocompleteInput'
import { T, BTN_P, BTN_S, BASE_INP } from '../../styles/tokens'
import type { HttpMethod } from '../../types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function UrlBar() {
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const params = useRequestStore((s) => s.params)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)
  const preScript = useRequestStore((s) => s.preScript)
  const postScript = useRequestStore((s) => s.postScript)
  const assertions = useRequestStore((s) => s.assertions)
  const setMethod = useRequestStore((s) => s.setMethod)
  const setUrl = useRequestStore((s) => s.setUrl)
  const sendRequest = useRequestStore((s) => s.sendRequest)
  const isLoading = useResponseStore((s) => s.isLoading)
  const setShowEndpointSaveModal = useUIStore((s) => s.setShowEndpointSaveModal)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const pinTab = useTabsStore((s) => s.pinTab)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)
  const { t } = useTranslation()

  /** Pin preview tab when user starts editing */
  function pinIfPreview() {
    if (activeTab?.isPreview) pinTab(activeTab.id)
  }

  const [showMethodDrop, setShowMethodDrop] = useState(false)
  const [showSendDrop, setShowSendDrop] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const sendDropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowMethodDrop(false)
      }
      if (sendDropRef.current && !sendDropRef.current.contains(e.target as Node)) {
        setShowSendDrop(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  const handleSendAndDownload = useCallback(async () => {
    pinIfPreview()
    await sendRequest()
    const response = useResponseStore.getState().response
    if (response?.body) {
      const ct = response.headers?.['content-type'] || 'application/octet-stream'
      const ext = ct.includes('json') ? '.json' : ct.includes('xml') ? '.xml' : ct.includes('html') ? '.html' : '.txt'
      const blob = new Blob([response.body], { type: ct })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `response${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }, [sendRequest])

  return (
    <div
      style={{
        height: 40,
        background: T.white,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 12px',
        flexShrink: 0,
      }}
    >
      {/* Method dropdown */}
      <div ref={dropRef} style={{ position: 'relative' }}>
        <div
          onClick={(e) => {
            e.stopPropagation()
            setShowMethodDrop((v) => !v)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            background: T.surface,
            border: `1px solid ${T.border2}`,
            borderRadius: 6,
            cursor: 'pointer',
            userSelect: 'none',
            minWidth: 80,
            height: 28,
          }}
        >
          <MethodBadge method={method} />
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={T.ghost} strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {showMethodDrop && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 200,
              background: T.white,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: 4,
              minWidth: 110,
              boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
            }}
          >
            {METHODS.map((m) => (
              <div
                key={m}
                onClick={() => {
                  pinIfPreview()
                  setMethod(m)
                  setShowMethodDrop(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 5,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = T.surface }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <MethodBadge method={m} small />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* URL input with variable autocomplete */}
      <VariableAutocompleteInput
        value={url}
        onChange={(v) => { pinIfPreview(); setUrl(v) }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            sendRequest()
          }
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            sendRequest()
          }
        }}
        placeholder={t('urlBar.enterUrl')}
        style={{
          ...BASE_INP,
          flex: 1,
          height: 28,
          fontWeight: 400,
        }}
      />

      {/* Send split button — Postman style */}
      <div ref={sendDropRef} style={{ position: 'relative', display: 'flex' }}>
        <button
          type="button"
          onClick={() => { pinIfPreview(); sendRequest() }}
          disabled={isLoading}
          style={{
            ...BTN_P,
            background: 'var(--accent)',
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            opacity: isLoading ? 0.75 : 1,
          }}
        >
          {isLoading ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ animation: 'spin 0.8s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8" />
              </svg>
              {t('urlBar.sending')}
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {t('urlBar.send')}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowSendDrop((v) => !v)
          }}
          disabled={isLoading}
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderLeft: '1px solid rgba(255,255,255,0.25)',
            borderTopRightRadius: 6,
            borderBottomRightRadius: 6,
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            height: 28,
            opacity: isLoading ? 0.75 : 1,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showSendDrop && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              zIndex: 200,
              background: T.white,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: 4,
              minWidth: 180,
              boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
            }}
          >
            <div
              onClick={() => {
                setShowSendDrop(false)
                sendRequest()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: 13,
                color: T.text,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = T.surface }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Send
            </div>
            <div
              onClick={() => {
                setShowSendDrop(false)
                handleSendAndDownload()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: 13,
                color: T.text,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = T.surface }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Send and Download
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      <button
        type="button"
        onClick={async () => {
          const isSaved = activeTab?.savedRequestId || activeTab?.endpointId
          if (!isSaved) {
            // Not saved yet — open save modal
            setShowEndpointSaveModal(true)
            return
          }
          // Already saved — update in place
          setSaveLoading(true)
          try {
            if (activeTab.savedRequestId) {
              await window.api?.savedRequest?.update(activeTab.savedRequestId, {
                method,
                url,
                params: JSON.stringify(params),
                headers: JSON.stringify(headers),
                body: JSON.stringify(body),
                auth: JSON.stringify(auth),
                pre_script: preScript,
                post_script: postScript,
                assertions: JSON.stringify(assertions),
              })
            } else if (activeTab.endpointId) {
              await window.api?.endpoint?.update(activeTab.endpointId, {
                method,
                path: url,
                request_schema: JSON.stringify({ params, headers, body, auth }),
              })
            }
            // Update tab
            useTabsStore.getState().updateTab(activeTab.id, { method, url })
            useTabsStore.getState().markDirty(activeTab.id, false)
            await refreshTree()
            setSaveOk(true)
            setTimeout(() => setSaveOk(false), 1500)
          } catch { /* ignore */ }
          setSaveLoading(false)
        }}
        disabled={saveLoading}
        style={{
          ...BTN_S,
          borderColor: saveOk ? 'var(--green)' : undefined,
          color: saveOk ? 'var(--green)' : undefined,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        {saveOk ? '✓' : t('urlBar.save')}
      </button>
    </div>
  )
}
