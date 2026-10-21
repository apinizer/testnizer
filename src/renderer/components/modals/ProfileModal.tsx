import { X, Lock, LogOut } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import { useTranslation } from '../../lib/i18n'
import Modal from '../shared/Modal'
import { ChangePasswordForm, DisablePasswordCard } from '../auth/AppPasswordForms'

export default function ProfileModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.showProfileModal)
  const setOpen = useUIStore((s) => s.setShowProfileModal)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  if (!open || !user) return null

  return (
    <Modal open={open} onOpenChange={setOpen} title={t('profile.changePassword')}>
      <div
        className="flex w-[520px] flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div
              className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
              style={{
                width: 40,
                height: 40,
                background: 'var(--accent)',
                fontSize: 15,
              }}
            >
              {getInitials(user.displayName || user.username)}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>
                {user.displayName || user.username}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('profile.localAccount')}</div>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('a11y.closeDialog')}
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
            style={{ color: 'var(--muted)' }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Title */}
        <div
          className="flex shrink-0 items-center gap-1.5 border-b px-5 py-2.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <Lock size={14} aria-hidden="true" style={{ color: 'var(--accent-text)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-text)' }}>
            {t('profile.changePassword')}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-5">
          <ChangePasswordForm />
          <DisablePasswordCard onDisabled={() => setOpen(false)} />
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-end border-t px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={async () => {
              await logout()
              setOpen(false)
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--text)',
              fontSize: 13,
            }}
          >
            <LogOut size={13} aria-hidden="true" />
            {t('profile.signOut')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Helpers ───────────────────────────────────────────────── */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.substring(0, 2).toUpperCase()
}
