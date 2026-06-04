import { useState, useRef, useEffect } from 'react'
import { User, Lock, KeyRound, Info } from 'lucide-react'
import { useAuthStore } from '../../stores/auth.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { T } from '../../styles/tokens'

/**
 * Header session menu (issue #3). Testnizer has no account system — only an
 * optional local password — so this surfaces session actions (lock / set a
 * password) plus About, rather than a cloud-account profile menu. Shown on
 * Home and inside a project.
 */
export default function UserMenu() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isGuest = useAuthStore((s) => s.isGuest)
  const hasPasswordSet = useAuthStore((s) => s.hasPasswordSet)
  const logout = useAuthStore((s) => s.logout)
  const setShowAboutModal = useUIStore((s) => s.setShowAboutModal)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  const protectedMode = hasPasswordSet === true && !isGuest

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    color: T.text,
    fontSize: 13,
    textAlign: 'left',
  }

  return (
    <div ref={ref} className="no-drag" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('userMenu.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: '50%',
          border: `1px solid ${T.border}`,
          background: 'var(--accent-light)',
          color: 'var(--accent-text)',
          cursor: 'pointer',
        }}
      >
        <User size={14} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 200,
            minWidth: 220,
            background: T.white,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
          }}
        >
          <div
            style={{
              padding: '6px 10px 8px',
              fontSize: 12,
              color: T.muted,
              borderBottom: `1px solid ${T.border}`,
              marginBottom: 4,
            }}
          >
            {protectedMode ? t('userMenu.protected') : t('userMenu.guest')}
          </div>

          {protectedMode ? (
            <button
              type="button"
              style={itemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => {
                setOpen(false)
                void logout()
              }}
            >
              <Lock size={13} aria-hidden="true" />
              {t('userMenu.lock')}
            </button>
          ) : (
            <button
              type="button"
              style={itemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.surface)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => {
                // Returns to the auth screen; with no password set that screen
                // is the set-password step. Data stays in the local DB.
                setOpen(false)
                void logout()
              }}
            >
              <KeyRound size={13} aria-hidden="true" />
              {t('userMenu.setPassword')}
            </button>
          )}

          <button
            type="button"
            style={itemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.surface)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              setOpen(false)
              setShowAboutModal(true)
            }}
          >
            <Info size={13} aria-hidden="true" />
            {t('userMenu.about')}
          </button>
        </div>
      )}
    </div>
  )
}
