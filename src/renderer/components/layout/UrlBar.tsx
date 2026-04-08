import { useState, useRef, useEffect } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import MethodBadge from '../shared/MethodBadge'
import { T, BTN_P, BTN_S, MONO_INP } from '../../styles/tokens'
import type { HttpMethod } from '../../types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function UrlBar() {
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const setMethod = useRequestStore((s) => s.setMethod)
  const setUrl = useRequestStore((s) => s.setUrl)
  const sendRequest = useRequestStore((s) => s.sendRequest)
  const isLoading = useResponseStore((s) => s.isLoading)
  const setShowEndpointSaveModal = useUIStore((s) => s.setShowEndpointSaveModal)
  const { t } = useTranslation()

  const [showMethodDrop, setShowMethodDrop] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowMethodDrop(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div
      style={{
        height: 56,
        background: T.white,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 16px',
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
            gap: 6,
            padding: '6px 10px',
            background: T.surface,
            border: `1.5px solid ${T.border2}`,
            borderRadius: 8,
            cursor: 'pointer',
            userSelect: 'none',
            minWidth: 102,
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
              borderRadius: 10,
              padding: 5,
              minWidth: 120,
              boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
            }}
          >
            {METHODS.map((m) => (
              <div
                key={m}
                onClick={() => {
                  setMethod(m)
                  setShowMethodDrop(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 7,
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

      {/* URL input */}
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
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
          ...MONO_INP,
          flex: 1,
          padding: '8px 12px',
        }}
      />

      {/* Send button */}
      <button
        type="button"
        onClick={sendRequest}
        disabled={isLoading}
        style={{
          ...BTN_P,
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

      {/* Save button */}
      <button
        type="button"
        onClick={() => setShowEndpointSaveModal(true)}
        style={BTN_S}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        {t('urlBar.save')}
      </button>
    </div>
  )
}
