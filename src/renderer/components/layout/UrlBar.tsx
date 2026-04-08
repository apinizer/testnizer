import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Save } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTranslation } from '../../lib/i18n'
import MethodBadge from '../shared/MethodBadge'
import type { HttpMethod } from '../../types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function UrlBar() {
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const setMethod = useRequestStore((s) => s.setMethod)
  const setUrl = useRequestStore((s) => s.setUrl)
  const sendRequest = useRequestStore((s) => s.sendRequest)
  const isLoading = useResponseStore((s) => s.isLoading)
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
      className="flex shrink-0 items-center gap-2"
      style={{
        height: 48,
        padding: '0 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--white)',
      }}
    >
      {/* Method dropdown */}
      <div ref={dropRef} className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowMethodDrop((v) => !v)
          }}
          className="flex cursor-pointer items-center gap-1 text-left"
          style={{
            minWidth: 88,
            background: 'var(--white)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '5px 8px',
          }}
        >
          <MethodBadge method={method} />
          <ChevronDown size={10} style={{ color: 'var(--muted)' }} />
        </button>

        {showMethodDrop && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              top: 'calc(100% + 4px)',
              zIndex: 200,
              minWidth: 120,
              background: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 4,
              boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
            }}
          >
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethod(m)
                  setShowMethodDrop(false)
                }}
                className="flex w-full cursor-pointer items-center gap-2"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 8px',
                  textAlign: 'left',
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--bg)'
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <MethodBadge method={m} small />
              </button>
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
        }}
        className="flex-1 font-mono text-[0.825rem] outline-none"
        style={{
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '6px 10px',
          color: 'var(--text)',
        }}
        placeholder={t('urlBar.enterUrl')}
      />

      {/* Send */}
      <button
        type="button"
        onClick={sendRequest}
        disabled={isLoading}
        className="cursor-pointer text-[0.825rem] font-semibold text-white"
        style={{
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 6,
          padding: '6px 16px',
          opacity: isLoading ? 0.7 : 1,
        }}
      >
        {isLoading ? t('urlBar.sending') : t('urlBar.send')}
      </button>

      {/* Save */}
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 text-[0.825rem]"
        style={{
          background: 'var(--white)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '5px 10px',
          color: 'var(--muted)',
        }}
      >
        <Save size={12} />
        {t('urlBar.save')}
      </button>
    </div>
  )
}
