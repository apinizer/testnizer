import { useState, useCallback, useEffect, useId } from 'react'
import { useAuthStore } from '../../stores/auth.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { Eye, EyeOff, Loader2, Lock, Shield, Check, X, Zap, KeyRound } from 'lucide-react'
import appIcon from '../../assets/icon.png'

// ─── Password strength validation ────────────────────────────
function validatePassword(pw: string): {
  valid: boolean
  hasLength: boolean
  hasLetter: boolean
  hasNumber: boolean
} {
  const hasLength = pw.length >= 8
  const hasLetter = /[a-zA-Z]/.test(pw)
  const hasNumber = /[0-9]/.test(pw)
  return { valid: hasLength && hasLetter && hasNumber, hasLength, hasLetter, hasNumber }
}

function PasswordRules({ password }: { password: string }) {
  const { hasLength, hasLetter, hasNumber } = validatePassword(password)
  if (!password) return null

  const rules = [
    { label: 'At least 8 characters', met: hasLength },
    { label: 'At least one letter', met: hasLetter },
    { label: 'At least one number', met: hasNumber },
  ]

  return (
    <div className="flex flex-col gap-1" style={{ marginTop: 6 }}>
      {rules.map((r) => (
        <div
          key={r.label}
          className="flex items-center gap-1.5"
          style={{ fontSize: 13, color: r.met ? 'var(--green)' : 'var(--muted)' }}
        >
          {r.met ? <Check size={12} /> : <X size={12} />}
          {r.label}
        </div>
      ))}
    </div>
  )
}

// ─── Security features for the branding panel ─────────────────
const SECURITY_FEATURES = [
  { icon: 'shield', label: '100% Offline', desc: 'No internet connection required' },
  { icon: 'lock', label: 'Local Storage Only', desc: 'All data stays on your machine' },
  { icon: 'db', label: 'Internal Git & Local DB', desc: 'Version control without cloud' },
  { icon: 'eye', label: 'Zero Data Leakage', desc: 'Nothing is ever sent externally' },
]

function SecurityIcon({ type }: { type: string }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'rgba(255,255,255,0.9)',
    strokeWidth: '1.8',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (type === 'shield')
    return (
      <svg {...props}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    )
  if (type === 'lock')
    return (
      <svg {...props}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    )
  if (type === 'db')
    return (
      <svg {...props}>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    )
  // eye-off
  return (
    <svg {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// ─── Main LoginScreen ─────────────────────────────────────────

export default function LoginScreen() {
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)
  const hasPasswordSet = useAuthStore((s) => s.hasPasswordSet)
  const checkHasPassword = useAuthStore((s) => s.checkHasPassword)
  const isLoading = useAuthStore((s) => s.isLoading)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    checkHasPassword()
  }, [checkHasPassword])

  // Show the build version on the first screen (user-reported: it was missing).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const v = (await window.api?.app?.version?.()) as
        | { success: boolean; data?: { version: string } }
        | undefined
      if (!cancelled && v?.success && v.data?.version) setAppVersion(v.data.version)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    clearError()
  }, [hasPasswordSet, clearError])

  // Surface auth errors as global toasts so the focused login form stays
  // clean. We immediately clear the store so a re-render doesn't re-fire.
  useEffect(() => {
    if (!error) return
    toast.error(error)
    clearError()
  }, [error, clearError])

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="flex w-[900px] overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
      >
        {/* Left - Branding */}
        <div
          className="flex w-[380px] shrink-0 flex-col items-center justify-center gap-5 p-10"
          style={{
            background: 'linear-gradient(145deg, #1e3a6e 0%, #2D5FA0 50%, #4a89cc 100%)',
          }}
        >
          {/* App icon */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 20,
              background: '#fff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={appIcon}
              alt="Testnizer"
              style={{ width: 58, height: 58, borderRadius: 14 }}
            />
          </div>

          <span style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>
            Testnizer
          </span>

          {appVersion && (
            <span
              data-testid="login-app-version"
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.6)',
                marginTop: -12,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              v{appVersion}
            </span>
          )}

          <div
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              textAlign: 'center',
              lineHeight: 1.6,
              fontWeight: 500,
            }}
          >
            Secure, Offline API Testing Platform
          </div>

          {/* Security-first messaging */}
          <div
            style={{
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '14px 16px',
              width: '100%',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div className="flex flex-col gap-3">
              {SECURITY_FEATURES.map((feat) => (
                <div key={feat.label} className="flex items-start gap-3">
                  <div
                    className="flex shrink-0 items-center justify-center rounded-md"
                    style={{
                      width: 28,
                      height: 28,
                      background: 'rgba(255,255,255,0.12)',
                      marginTop: 1,
                    }}
                  >
                    <SecurityIcon type={feat.icon} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.95)' }}>
                      {feat.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
                      {feat.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              lineHeight: 1.5,
              maxWidth: 280,
              marginTop: 4,
            }}
          >
            Your data never leaves your machine. All API requests, collections, and credentials are
            stored locally in an encrypted database.
          </div>
        </div>

        {/* Right - Form */}
        <div className="flex flex-1 flex-col justify-center p-8" style={{ minHeight: 520 }}>
          {/* Auth errors surface as toasts (see effect above) */}
          {isLoading && hasPasswordSet === null ? (
            <div className="flex items-center justify-center py-10">
              <Loader2
                size={24}
                style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }}
              />
            </div>
          ) : hasPasswordSet ? (
            <PasswordLoginForm />
          ) : (
            <FirstTimeScreen />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Password Login Form (when password is already set) ───── */

function PasswordLoginForm() {
  const { t } = useTranslation()
  const login = useAuthStore((s) => s.login)
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest)
  const isLoading = useAuthStore((s) => s.isLoading)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showRecover, setShowRecover] = useState(false)
  const passwordId = useId()

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await login(password)
    },
    [password, login],
  )

  if (showRecover) {
    return <RecoverPasswordForm onBack={() => setShowRecover(false)} />
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 pb-2">
        <div
          className="flex items-center justify-center rounded-full"
          style={{ width: 52, height: 52, background: 'var(--accent-light)' }}
        >
          <Lock size={24} style={{ color: 'var(--accent-text)' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
          {t('login.welcomeBack')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
          {t('login.enterPassword')}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor={passwordId}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            {t('login.password')}
          </label>
          <div className="relative">
            <input
              id={passwordId}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.password')}
              autoFocus
              className="w-full rounded-lg border py-2.5 pl-3.5 pr-10 outline-none transition-colors"
              style={{
                fontSize: 14,
                borderColor: 'var(--border)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
              }}
              onFocus={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--border)'
              }}
            />
            <button
              type="button"
              aria-label={showPw ? t('a11y.hidePassword') : t('a11y.showPassword')}
              aria-pressed={showPw}
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
              style={{ color: 'var(--hint)' }}
            >
              {showPw ? (
                <EyeOff size={15} aria-hidden="true" />
              ) : (
                <Eye size={15} aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="flex justify-end" style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setShowRecover(true)}
              className="cursor-pointer border-none bg-transparent p-0"
              style={{ fontSize: 13, color: 'var(--accent-text)' }}
            >
              {t('login.forgotPassword')}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || !password}
          className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', fontSize: 14 }}
        >
          {isLoading && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
          {t('login.unlock')}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 13, color: 'var(--hint)' }}>or</span>
        <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
      </div>

      {/* Quick Test — anonymous entry */}
      <button
        type="button"
        onClick={continueAsGuest}
        className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border py-2.5 transition-colors"
        style={{
          borderColor: 'var(--border)',
          background: 'transparent',
          color: 'var(--text)',
          fontSize: 14,
          fontWeight: 500,
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        }}
      >
        <Zap size={16} style={{ color: 'var(--accent)' }} />
        {t('login.quickTest')}
      </button>
      <div style={{ fontSize: 13, color: 'var(--hint)', textAlign: 'center', marginTop: -4 }}>
        {t('login.quickTestDesc')}
      </div>
    </div>
  )
}

/* ── Recover Password Form ────────────────────────────────── */

function RecoverPasswordForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const recoverPassword = useAuthStore((s) => s.recoverPassword)
  const [osPassword, setOsPassword] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showOs, setShowOs] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)
  const osPasswordId = useId()
  const newPasswordId = useId()
  const confirmPasswordId = useId()

  const pwCheck = validatePassword(newPw)
  const pwMatch = newPw === confirmPw
  const canSubmit = !!osPassword && pwCheck.valid && !!confirmPw && pwMatch && !loading

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      setLoading(true)
      const result = await recoverPassword(osPassword, newPw)
      setLoading(false)
      // On success the store flips isAuthenticated and the login screen unmounts.
      if (!result.success) toast.error(result.error || t('toast.recoveryFailed'))
    },
    [osPassword, newPw, canSubmit, recoverPassword, t],
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
          style={{ color: 'var(--muted)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            {t('login.recoverTitle')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('login.recoverDesc')}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* OS (system) password */}
        <div>
          <label
            htmlFor={osPasswordId}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            {t('login.osPassword')}
          </label>
          <div className="relative">
            <input
              id={osPasswordId}
              type={showOs ? 'text' : 'password'}
              value={osPassword}
              onChange={(e) => setOsPassword(e.target.value)}
              placeholder={t('login.osPasswordPlaceholder')}
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border py-2.5 pl-10 pr-10 outline-none transition-colors"
              style={{
                fontSize: 14,
                borderColor: 'var(--border)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
              }}
              onFocus={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--border)'
              }}
            />
            <KeyRound
              size={15}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--hint)',
              }}
            />
            <button
              type="button"
              aria-label={showOs ? t('a11y.hidePassword') : t('a11y.showPassword')}
              aria-pressed={showOs}
              onClick={() => setShowOs(!showOs)}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
              style={{ color: 'var(--hint)' }}
            >
              {showOs ? (
                <EyeOff size={15} aria-hidden="true" />
              ) : (
                <Eye size={15} aria-hidden="true" />
              )}
            </button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--hint)', marginTop: 4 }}>
            {t('login.osPasswordHint')}
          </div>
        </div>

        {/* New app password */}
        <div>
          <label
            htmlFor={newPasswordId}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            {t('login.newPassword')}
          </label>
          <div className="relative">
            <input
              id={newPasswordId}
              type={showNew ? 'text' : 'password'}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Min 8 characters, letter + number"
              autoComplete="new-password"
              className="w-full rounded-lg border py-2.5 pl-3.5 pr-10 outline-none transition-colors"
              style={{
                fontSize: 14,
                borderColor: 'var(--border)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
              }}
              onFocus={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--border)'
              }}
            />
            <button
              type="button"
              aria-label={showNew ? t('a11y.hidePassword') : t('a11y.showPassword')}
              aria-pressed={showNew}
              onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
              style={{ color: 'var(--hint)' }}
            >
              {showNew ? (
                <EyeOff size={15} aria-hidden="true" />
              ) : (
                <Eye size={15} aria-hidden="true" />
              )}
            </button>
          </div>
          <PasswordRules password={newPw} />
        </div>

        {/* Confirm new password */}
        <div>
          <label
            htmlFor={confirmPasswordId}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            {t('profile.confirmPassword')}
          </label>
          <input
            id={confirmPasswordId}
            type={showNew ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Re-enter new password"
            autoComplete="new-password"
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{
              fontSize: 14,
              borderColor: confirmPw && !pwMatch ? 'var(--red)' : 'var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
            }}
            onFocus={(e) => {
              if (!confirmPw || pwMatch)
                (e.target as HTMLElement).style.borderColor = 'var(--accent)'
            }}
            onBlur={(e) => {
              ;(e.target as HTMLElement).style.borderColor =
                confirmPw && !pwMatch ? 'var(--red)' : 'var(--border)'
            }}
          />
          {confirmPw && !pwMatch && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>
              {t('profile.passwordsDoNotMatch')}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', fontSize: 14 }}
        >
          {loading && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
          {t('login.recoverSubmit')}
        </button>
      </form>
    </div>
  )
}

/* ── First Time Screen (no password set yet) ──────────────── */

function FirstTimeScreen() {
  const [showSetPassword, setShowSetPassword] = useState(false)

  if (showSetPassword) {
    return <SetPasswordForm onBack={() => setShowSetPassword(false)} />
  }

  return <WelcomeOptions onSetPassword={() => setShowSetPassword(true)} />
}

/* ── Welcome Options ──────────────────────────────────────── */

function WelcomeOptions({ onSetPassword }: { onSetPassword: () => void }) {
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 pb-2">
        <div
          className="flex items-center justify-center rounded-full"
          style={{ width: 52, height: 52, background: 'var(--accent-light)' }}
        >
          <Shield size={24} style={{ color: 'var(--accent-text)' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
          Welcome to Testnizer
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 320 }}>
          You can set a password to protect your data, or start using the app right away.
        </div>
      </div>

      {/* Set Password Option */}
      <button
        type="button"
        onClick={onSetPassword}
        className="flex w-full cursor-pointer items-center gap-4 rounded-xl border px-5 py-4 text-left transition-all"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
          ;(e.currentTarget as HTMLElement).style.background = 'var(--accent-light)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
          ;(e.currentTarget as HTMLElement).style.background = 'var(--white)'
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center rounded-lg"
          style={{ width: 40, height: 40, background: 'var(--accent-light)' }}
        >
          <Lock size={18} style={{ color: 'var(--accent-text)' }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Set a Password</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            Protect your projects and data with a password
          </div>
        </div>
      </button>

      {/* Anonymous Option */}
      <button
        type="button"
        data-testid="login-continue-anonymous"
        onClick={continueAsGuest}
        className="flex w-full cursor-pointer items-center gap-4 rounded-xl border px-5 py-4 text-left transition-all"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'
          ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
          ;(e.currentTarget as HTMLElement).style.background = 'var(--white)'
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center rounded-lg"
          style={{ width: 40, height: 40, background: 'var(--surface)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            Continue Anonymous
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            Start with a blank project, no password required
          </div>
        </div>
      </button>

      <div style={{ fontSize: 13, color: 'var(--hint)', textAlign: 'center', marginTop: 4 }}>
        You can set a password later from settings
      </div>
    </div>
  )
}

/* ── Set Password Form ────────────────────────────────────── */

function SetPasswordForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const setPasswordAction = useAuthStore((s) => s.setPassword)
  const isLoading = useAuthStore((s) => s.isLoading)
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const setPasswordId = useId()
  const setConfirmId = useId()

  const pwCheck = validatePassword(password)
  const passwordsMatch = password === confirmPw
  const canSubmit = pwCheck.valid && confirmPw && passwordsMatch && !isLoading

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!pwCheck.valid || !passwordsMatch) return
      await setPasswordAction(password)
    },
    [password, pwCheck.valid, passwordsMatch, setPasswordAction],
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
          style={{ color: 'var(--muted)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            {t('login.setPasswordTitle')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('login.setPasswordDesc')}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor={setPasswordId}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            {t('login.password')}
          </label>
          <div className="relative">
            <input
              id={setPasswordId}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters, letter + number"
              autoFocus
              className="w-full rounded-lg border py-2.5 pl-3.5 pr-10 outline-none transition-colors"
              style={{
                fontSize: 14,
                borderColor: 'var(--border)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
              }}
              onFocus={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--accent)'
              }}
              onBlur={(e) => {
                ;(e.target as HTMLElement).style.borderColor = 'var(--border)'
              }}
            />
            <button
              type="button"
              aria-label={showPw ? t('a11y.hidePassword') : t('a11y.showPassword')}
              aria-pressed={showPw}
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-0"
              style={{ color: 'var(--hint)' }}
            >
              {showPw ? (
                <EyeOff size={15} aria-hidden="true" />
              ) : (
                <Eye size={15} aria-hidden="true" />
              )}
            </button>
          </div>
          <PasswordRules password={password} />
        </div>

        <div>
          <label
            htmlFor={setConfirmId}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              display: 'block',
              marginBottom: 6,
            }}
          >
            {t('profile.confirmPassword')}
          </label>
          <input
            id={setConfirmId}
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Re-enter password"
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{
              fontSize: 14,
              borderColor: confirmPw && !passwordsMatch ? 'var(--red)' : 'var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
            }}
            onFocus={(e) => {
              if (!confirmPw || passwordsMatch)
                (e.target as HTMLElement).style.borderColor = 'var(--accent)'
            }}
            onBlur={(e) => {
              ;(e.target as HTMLElement).style.borderColor =
                confirmPw && !passwordsMatch ? 'var(--red)' : 'var(--border)'
            }}
          />
          {confirmPw && !passwordsMatch && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>
              {t('profile.passwordsDoNotMatch')}
            </div>
          )}
        </div>

        <div
          className="flex items-start gap-2 rounded-lg px-3.5 py-2.5"
          style={{ background: 'var(--accent-light)', border: '1px solid rgba(124,115,230,0.25)' }}
        >
          <Shield size={15} style={{ color: 'var(--accent-text)', marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--accent-text)' }}>
            {t('login.recoveryNote')}
          </span>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', fontSize: 14 }}
        >
          {isLoading && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
          {t('login.setPasswordButton')}
        </button>
      </form>
    </div>
  )
}
