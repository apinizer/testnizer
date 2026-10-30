import { useState, useCallback, useId } from 'react'
import { Eye, EyeOff, ShieldOff } from 'lucide-react'
import { useAuthStore } from '../../stores/auth.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'

/**
 * App-password forms shared by the Profile dialog and Settings → App password
 * (issue #240). Both surfaces drive the same store actions
 * (`changePassword` / `disablePassword`); only the trigger around them differs,
 * so the forms live here once instead of being copied into Settings.
 */

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text)',
  display: 'block',
  marginBottom: 6,
}

const INPUT_CLS = 'w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors'
const GHOST_BTN_CLS =
  'cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 font-medium text-[var(--text)] transition-colors hover:opacity-80 disabled:opacity-50'

function inputStyle(invalid = false): React.CSSProperties {
  return {
    fontSize: 14,
    borderColor: invalid ? 'var(--red)' : 'var(--border)',
    background: 'var(--input-bg)',
    color: 'var(--text)',
  }
}

export function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-label={shown ? t('a11y.hidePassword') : t('a11y.showPassword')}
      aria-pressed={shown}
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
      style={{ color: 'var(--hint)' }}
    >
      {shown ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
    </button>
  )
}

/* ── Change password ───────────────────────────────────────── */

export function ChangePasswordForm({
  onCancel,
  onChanged,
}: {
  /** When given, a Cancel button is shown next to the submit button. */
  onCancel?: () => void
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const changePassword = useAuthStore((s) => s.changePassword)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const currentPwId = useId()
  const newPwId = useId()
  const confirmPwId = useId()

  const passwordsMatch = newPw === confirmPw
  const hasValidNewPw = newPw.length >= 8 && /[a-zA-Z]/.test(newPw) && /[0-9]/.test(newPw)
  const canSubmit = !!currentPw && !!newPw && !!confirmPw && passwordsMatch && hasValidNewPw

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit || busy) return
      setBusy(true)
      const result = await changePassword(currentPw, newPw)
      setBusy(false)
      if (result.success) {
        toast.success(t('profile.passwordChanged'))
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
        onChanged?.()
      } else {
        toast.error(result.error || t('toast.passwordChangeFailed'))
      }
    },
    [canSubmit, busy, currentPw, newPw, changePassword, onChanged, t],
  )

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      data-testid="password-change-form"
    >
      <div>
        <label htmlFor={currentPwId} style={LABEL_STYLE}>
          {t('profile.currentPassword')}
        </label>
        <div className="relative">
          <input
            id={currentPwId}
            data-testid="password-change-current"
            type={showPw ? 'text' : 'password'}
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className={`${INPUT_CLS} pr-10`}
            style={inputStyle()}
          />
          <RevealButton shown={showPw} onToggle={() => setShowPw(!showPw)} />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor={newPwId} style={LABEL_STYLE}>
            {t('profile.newPassword')}
          </label>
          <input
            id={newPwId}
            data-testid="password-change-new"
            type={showPw ? 'text' : 'password'}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={t('profile.newPasswordPlaceholder')}
            title={t('profile.newPasswordPlaceholder')}
            className={INPUT_CLS}
            style={inputStyle()}
          />
        </div>
        <div className="flex-1">
          <label htmlFor={confirmPwId} style={LABEL_STYLE}>
            {t('profile.confirmPassword')}
          </label>
          <input
            id={confirmPwId}
            data-testid="password-change-confirm"
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className={INPUT_CLS}
            style={inputStyle(!!confirmPw && !passwordsMatch)}
          />
          {confirmPw && !passwordsMatch && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>
              {t('profile.passwordsDoNotMatch')}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={GHOST_BTN_CLS}>
            {t('profile.cancel')}
          </button>
        )}
        <button
          type="submit"
          data-testid="password-change-submit"
          disabled={!canSubmit || busy}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border-none px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', fontSize: 13 }}
        >
          {t('profile.changePassword')}
        </button>
      </div>
    </form>
  )
}

/* ── Disable password ──────────────────────────────────────── */

/**
 * Confirms with the current password, then calls `disablePassword`. A wrong
 * password stays in the form as an inline error (not only a toast) so the user
 * can retry without re-opening anything.
 */
export function DisablePasswordForm({
  onCancel,
  onDisabled,
}: {
  onCancel: () => void
  onDisabled: () => void
}) {
  const { t } = useTranslation()
  const disablePassword = useAuthStore((s) => s.disablePassword)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  const handleDisable = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!password || loading) return
      setLoading(true)
      setError(null)
      const result = await disablePassword(password)
      setLoading(false)
      if (result.success) {
        toast.success(t('toast.passwordDisabled'))
        onDisabled()
      } else {
        setError(result.error || t('toast.passwordDisableFailed'))
      }
    },
    [password, loading, disablePassword, onDisabled, t],
  )

  return (
    <form
      onSubmit={handleDisable}
      className="flex flex-col gap-3"
      data-testid="password-disable-form"
    >
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{t('profile.confirmDisable')}</div>
      <div className="relative">
        <input
          type={showPw ? 'text' : 'password'}
          data-testid="password-disable-input"
          aria-label={t('profile.currentPassword')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (error) setError(null)
          }}
          placeholder={t('profile.currentPassword')}
          autoFocus
          className="w-full rounded-md border py-2 pl-3 pr-10 outline-none"
          style={{
            fontSize: 13,
            borderColor: error ? 'var(--red)' : 'var(--border)',
            background: 'var(--white)',
            color: 'var(--text)',
          }}
        />
        <RevealButton shown={showPw} onToggle={() => setShowPw(!showPw)} />
      </div>
      {error && (
        <div
          id={errorId}
          role="alert"
          data-testid="password-disable-error"
          style={{ fontSize: 13, color: 'var(--red)' }}
        >
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-testid="password-disable-cancel"
          onClick={onCancel}
          disabled={loading}
          className={GHOST_BTN_CLS}
          style={{ fontSize: 13 }}
        >
          {t('profile.cancel')}
        </button>
        <button
          type="submit"
          data-testid="password-disable-submit"
          disabled={loading || !password}
          className="cursor-pointer rounded-md border-none px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--red)', fontSize: 13 }}
        >
          {t('profile.disableConfirm')}
        </button>
      </div>
    </form>
  )
}

/** Profile dialog's danger-zone card: title + description, expands into the form. */
export function DisablePasswordCard({ onDisabled }: { onDisabled: () => void }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="mt-6 rounded-lg border"
      style={{ borderColor: 'rgba(185,28,28,0.25)', background: 'rgba(185,28,28,0.04)' }}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <ShieldOff
          size={18}
          aria-hidden="true"
          style={{ color: 'var(--red)', marginTop: 2, flexShrink: 0 }}
        />
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
            data-testid="password-disable-open"
            onClick={() => setExpanded(true)}
            className="cursor-pointer rounded-md border px-3 py-1.5 font-medium transition-colors"
            style={{
              borderColor: 'rgba(185,28,28,0.4)',
              background: 'transparent',
              color: 'var(--red)',
              fontSize: 13,
            }}
          >
            {t('profile.disableButton')}
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t px-4 py-3" style={{ borderColor: 'rgba(185,28,28,0.2)' }}>
          <DisablePasswordForm onCancel={() => setExpanded(false)} onDisabled={onDisabled} />
        </div>
      )}
    </div>
  )
}
