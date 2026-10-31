import { useCallback, useId, useState } from 'react'
import { useAuthStore } from '../../stores/auth.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { RevealButton } from './AppPasswordForms'

/**
 * Settings → App password → "Set a password…" (review #13). Inline, like the
 * Change… / Turn off… forms next to it: new password + confirm, the same
 * rules as the start screen's set-password step (8+ characters, a letter and
 * a number — main enforces them too). The session continues; the next launch
 * asks for the password. It used to sign the user out to the start screen
 * without a word.
 */
const INPUT_CLS =
  'w-full rounded-md border bg-[var(--white)] py-2 pl-3 pr-10 text-sm text-[var(--text)] outline-none'
const GHOST_BTN_CLS =
  'cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 text-sm font-medium text-[var(--text)] transition-colors hover:opacity-80 disabled:opacity-50'

export default function SetPasswordForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const enablePassword = useAuthStore((s) => s.enablePassword)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pwId = useId()
  const confirmId = useId()
  const errorId = useId()

  const valid = password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password)
  const mismatch = !!confirm && confirm !== password
  const canSubmit = valid && !!confirm && !mismatch && !busy

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      setBusy(true)
      setError(null)
      const result = await enablePassword(password)
      setBusy(false)
      if (result.success) {
        toast.success(t('toast.passwordSet'))
        onDone()
      } else {
        setError(result.error || t('toast.passwordSetFailed'))
      }
    },
    [canSubmit, enablePassword, password, onDone, t],
  )

  const message = error ?? (mismatch ? t('profile.passwordsDoNotMatch') : null)

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="password-set-form">
      <div className="text-sm text-[var(--text)]">{t('settings.appPasswordSetNote')}</div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor={pwId} className="mb-1.5 block text-sm font-medium text-[var(--text)]">
            {t('profile.newPassword')}
          </label>
          <div className="relative">
            <input
              id={pwId}
              data-testid="password-set-new"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
              placeholder={t('profile.newPasswordPlaceholder')}
              title={t('profile.newPasswordPlaceholder')}
              autoFocus
              className={`${INPUT_CLS} border-[var(--border)]`}
            />
            <RevealButton shown={show} onToggle={() => setShow(!show)} />
          </div>
        </div>
        <div className="flex-1">
          <label
            htmlFor={confirmId}
            className="mb-1.5 block text-sm font-medium text-[var(--text)]"
          >
            {t('profile.confirmPassword')}
          </label>
          <input
            id={confirmId}
            data-testid="password-set-confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t('login.confirmPlaceholder')}
            aria-invalid={mismatch || undefined}
            aria-describedby={message ? errorId : undefined}
            className={`${INPUT_CLS} ${mismatch ? 'border-[var(--red)]' : 'border-[var(--border)]'}`}
          />
        </div>
      </div>
      {message && (
        <div
          id={errorId}
          role="alert"
          data-testid="password-set-error"
          className="text-sm text-[var(--red)]"
        >
          {message}
        </div>
      )}
      <div className="text-xs text-[var(--muted)]">{t('login.recoveryNote')}</div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-testid="password-set-cancel"
          onClick={onCancel}
          disabled={busy}
          className={GHOST_BTN_CLS}
        >
          {t('profile.cancel')}
        </button>
        <button
          type="submit"
          data-testid="password-set-submit"
          disabled={!canSubmit}
          className="cursor-pointer rounded-md border-none bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('settings.appPasswordSetSubmit')}
        </button>
      </div>
    </form>
  )
}
