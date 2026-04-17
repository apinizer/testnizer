import { useState, useCallback } from 'react'
import { X, Lock, LogOut, Check, AlertCircle, Eye, EyeOff, ShieldOff } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import { useTranslation } from '../../lib/i18n'

export default function ProfileModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.showProfileModal)
  const setOpen = useUIStore((s) => s.setShowProfileModal)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const changePassword = useAuthStore((s) => s.changePassword)
  const disablePassword = useAuthStore((s) => s.disablePassword)

  if (!open || !user) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="flex w-[520px] flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
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
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
            style={{ color: 'var(--muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Title */}
        <div className="flex shrink-0 items-center gap-1.5 border-b px-5 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <Lock size={14} style={{ color: 'var(--accent-text)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-text)' }}>{t('profile.changePassword')}</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-5">
          <PasswordTab changePassword={changePassword} />
          <DisablePasswordSection disablePassword={disablePassword} onDisabled={() => setOpen(false)} />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={async () => {
              await logout()
              setOpen(false)
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)', fontSize: 13 }}
          >
            <LogOut size={13} />
            {t('profile.signOut')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Password Tab ──────────────────────────────────────────── */

function PasswordTab({
  changePassword,
}: {
  changePassword: (current: string, newPw: string) => Promise<{ success: boolean; error?: string }>
}) {
  const { t } = useTranslation()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const passwordsMatch = newPw === confirmPw
  const hasValidNewPw = newPw.length >= 8 && /[a-zA-Z]/.test(newPw) && /[0-9]/.test(newPw)
  const canSubmit = currentPw && newPw && confirmPw && passwordsMatch && hasValidNewPw

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const result = await changePassword(currentPw, newPw)
    if (result.success) {
      setSaved(true)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError(result.error || 'Password change failed')
    }
  }, [currentPw, newPw, changePassword])

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(185,28,28,0.08)' }}>
          <AlertCircle size={14} style={{ color: 'var(--red)' }} />
          <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--green-bg)' }}>
          <Check size={14} style={{ color: 'var(--green)' }} />
          <span style={{ fontSize: 13, color: 'var(--green)' }}>{t('profile.passwordChanged')}</span>
        </div>
      )}

      <div>
        <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
          {t('profile.currentPassword')}
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="w-full rounded-lg border py-2.5 pl-3.5 pr-10 outline-none transition-colors"
            style={{ fontSize: 14, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
            onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
            onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
            style={{ color: 'var(--hint)' }}
          >
            {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            {t('profile.newPassword')}
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Min 6 characters"
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{ fontSize: 14, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
            onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
            onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
          />
        </div>
        <div className="flex-1">
          <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            {t('profile.confirmPassword')}
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{
              fontSize: 14,
              borderColor: confirmPw && !passwordsMatch ? 'var(--red)' : 'var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
            }}
            onFocus={(e) => {
              if (!confirmPw || passwordsMatch) (e.target as HTMLElement).style.borderColor = 'var(--accent)'
            }}
            onBlur={(e) => {
              (e.target as HTMLElement).style.borderColor = confirmPw && !passwordsMatch ? 'var(--red)' : 'var(--border)'
            }}
          />
          {confirmPw && !passwordsMatch && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{t('profile.passwordsDoNotMatch')}</div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border-none px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', fontSize: 13 }}
        >
          {t('profile.changePassword')}
        </button>
      </div>
    </form>
  )
}

/* ── Disable Password Section ──────────────────────────────── */

function DisablePasswordSection({
  disablePassword,
  onDisabled,
}: {
  disablePassword: (currentPassword: string) => Promise<{ success: boolean; error?: string }>
  onDisabled: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDisable = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!password) return
    setLoading(true)
    const result = await disablePassword(password)
    setLoading(false)
    if (result.success) {
      onDisabled()
    } else {
      setError(result.error || 'Failed to disable password')
    }
  }, [password, disablePassword, onDisabled])

  return (
    <div
      className="mt-6 rounded-lg border"
      style={{ borderColor: 'rgba(185,28,28,0.25)', background: 'rgba(185,28,28,0.04)' }}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <ShieldOff size={18} style={{ color: 'var(--red)', marginTop: 2, flexShrink: 0 }} />
        <div className="flex-1">
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {t('profile.disablePasswordTitle')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {t('profile.disablePasswordDesc')}
          </div>
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="cursor-pointer rounded-md border px-3 py-1.5 font-medium transition-colors"
            style={{ borderColor: 'rgba(185,28,28,0.4)', background: 'transparent', color: 'var(--red)', fontSize: 13 }}
          >
            {t('profile.disableButton')}
          </button>
        )}
      </div>

      {expanded && (
        <form onSubmit={handleDisable} className="flex flex-col gap-3 border-t px-4 py-3" style={{ borderColor: 'rgba(185,28,28,0.2)' }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>{t('profile.confirmDisable')}</div>
          {error && (
            <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: 'rgba(185,28,28,0.08)' }}>
              <AlertCircle size={14} style={{ color: 'var(--red)' }} />
              <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
            </div>
          )}
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('profile.currentPassword')}
              autoFocus
              className="w-full rounded-md border py-2 pl-3 pr-10 outline-none"
              style={{ fontSize: 13, borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
              style={{ color: 'var(--hint)' }}
            >
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setExpanded(false); setPassword(''); setError('') }}
              disabled={loading}
              className="cursor-pointer rounded-md border px-3 py-1.5 font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)', fontSize: 13 }}
            >
              {t('profile.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !password}
              className="cursor-pointer rounded-md border-none px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--red)', fontSize: 13 }}
            >
              {t('profile.disableConfirm')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/* ── Helpers ───────────────────────────────────────────────── */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.substring(0, 2).toUpperCase()
}
