import { useState, useRef, useEffect, useCallback } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import { useCompactUrlBar } from '../../lib/use-narrow-layout'
import {
  URL_BAR_COMPACT_METHOD_MIN_PX,
  URL_BAR_COMPACT_PAD_X_PX,
  URL_BAR_COMPACT_SEND_GAP_PX,
  URL_FIELD_MIN_PX,
} from '../../lib/narrow-layout'
import MethodBadge from '../shared/MethodBadge'
import VariableAutocompleteInput from '../shared/VariableAutocompleteInput'
import { handleUrlBarPaste } from './url-bar-paste'
import { UrlBarMoreMenu, UrlBarSaveButton } from './UrlBarSave'
import { useUrlBarSave } from './use-url-bar-save'
import { T, BTN_P, BASE_INP } from '../../styles/tokens'
import type { HttpMethod } from '../../types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY']

export default function UrlBar() {
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const setMethod = useRequestStore((s) => s.setMethod)
  const setUrl = useRequestStore((s) => s.setUrl)
  const sendRequest = useRequestStore((s) => s.sendRequest)
  const cancelRequest = useRequestStore((s) => s.cancelRequest)
  const isLoading = useResponseStore((s) => s.isLoading)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const pinTab = useTabsStore((s) => s.pinTab)
  const { t } = useTranslation()

  /** Pin preview tab when user starts editing */
  function pinIfPreview() {
    if (activeTab?.isPreview) pinTab(activeTab.id)
  }

  const [showMethodDrop, setShowMethodDrop] = useState(false)
  const [showSendDrop, setShowSendDrop] = useState(false)
  const saveState = useUrlBarSave()
  // Issue #251: below URL_BAR_COMPACT_BELOW the bar's own width cannot hold
  // method + URL + Send + Save, so Save moves into an overflow menu.
  const barRef = useRef<HTMLDivElement>(null)
  const compact = useCompactUrlBar(barRef)
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
      const ext = ct.includes('json')
        ? '.json'
        : ct.includes('xml')
          ? '.xml'
          : ct.includes('html')
            ? '.html'
            : '.txt'
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
      ref={barRef}
      data-testid="url-bar"
      data-compact={compact ? 'true' : 'false'}
      style={{
        height: 44,
        background: T.white,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        // Compact (#251): every px of chrome goes to the URL field.
        padding: compact ? `0 ${URL_BAR_COMPACT_PAD_X_PX}px` : '0 12px',
        flexShrink: 0,
      }}
    >
      {/* Method dropdown — Postman style: bordered pill on the left, flush with URL input */}
      <div ref={dropRef} style={{ position: 'relative', flexShrink: 0 }}>
        <div
          data-testid="url-method"
          onClick={(e) => {
            e.stopPropagation()
            setShowMethodDrop((v) => !v)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 10px',
            background: T.white,
            border: `1px solid ${T.border}`,
            borderRight: 'none',
            borderRadius: '8px 0 0 8px',
            cursor: 'pointer',
            userSelect: 'none',
            minWidth: compact ? URL_BAR_COMPACT_METHOD_MIN_PX : 90,
            height: 32,
          }}
        >
          <MethodBadge method={method} />
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={T.ghost}
            strokeWidth="2"
          >
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
                data-testid={`url-method-option-${m}`}
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
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = T.surface
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <MethodBadge method={m} small />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* URL input — Postman style: flush with method dropdown */}
      <VariableAutocompleteInput
        data-testid="url-input"
        spellCheck={false}
        autoComplete="off"
        value={url}
        onChange={(v) => {
          pinIfPreview()
          setUrl(v)
        }}
        onPaste={handleUrlBarPaste}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            sendRequest()
          }
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            sendRequest()
          }
        }}
        placeholder={t('urlBar.enterUrl')}
        // Issue #251: the URL never shrinks to a sliver (it was ~30 px at 1024 px).
        // On the outer flex item, so Send / the overflow menu can never overlap it.
        fieldMinWidth={URL_FIELD_MIN_PX}
        style={{
          ...BASE_INP,
          flex: 1,
          height: 32,
          fontWeight: 400,
          borderRadius: '0 8px 8px 0',
          border: `1px solid ${T.border}`,
        }}
      />

      {/* Send split button — Postman style */}
      <div
        ref={sendDropRef}
        style={{
          position: 'relative',
          display: 'flex',
          marginLeft: compact ? URL_BAR_COMPACT_SEND_GAP_PX : 8,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          data-testid="send-btn"
          onClick={() => {
            if (isLoading) {
              cancelRequest()
            } else {
              pinIfPreview()
              sendRequest()
            }
          }}
          title={isLoading ? t('urlBar.cancel') : undefined}
          style={{
            ...BTN_P,
            height: 32,
            borderRadius: '8px 0 0 8px',
            // Switch to a "stop" treatment while in flight — same width so the
            // button does not jump when the user clicks Cancel.
            background: isLoading ? '#cc2200' : (BTN_P as { background?: string }).background,
          }}
        >
          {isLoading ? (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="white"
                stroke="white"
                strokeWidth="2"
              >
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              {t('urlBar.cancel')}
            </>
          ) : (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
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
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            height: 32,
            opacity: isLoading ? 0.75 : 1,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
          >
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
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = T.surface
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
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
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {t('urlBar.send')}
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
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = T.surface
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('urlBar.sendAndDownload')}
            </div>
          </div>
        )}
      </div>

      {/* Save — inline when there is room, in the overflow menu when not (#251) */}
      {compact ? <UrlBarMoreMenu state={saveState} /> : <UrlBarSaveButton state={saveState} />}
    </div>
  )
}
