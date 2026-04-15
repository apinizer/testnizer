import { useState, useCallback } from 'react'
import { useAuthStore } from '../../stores/auth.store'
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'

type Tab = 'login' | 'register'

export default function LoginScreen() {
  const [tab, setTab] = useState<Tab>('login')
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)

  const switchTab = useCallback((t: Tab) => {
    clearError()
    setTab(t)
  }, [clearError])

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex w-[860px] overflow-hidden rounded-2xl shadow-2xl" style={{ background: 'var(--white)', border: '1px solid var(--border)' }}>
        {/* Left - Branding */}
        <div
          className="flex w-[360px] shrink-0 flex-col items-center justify-center gap-6 p-10"
          style={{
            background: 'linear-gradient(145deg, #5b6af0 0%, #7c73e6 50%, #9b8afb 100%)',
          }}
        >
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>
              Apinizer
            </span>
          </div>

          <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.9)', textAlign: 'center', lineHeight: 1.6 }}>
            Professional API Testing Platform
          </div>

          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.5, maxWidth: 260 }}>
            Test REST, SOAP, GraphQL, gRPC, WebSocket, and SSE endpoints with a powerful desktop application.
          </div>

          {/* Feature dots */}
          <div className="flex flex-col gap-2.5" style={{ marginTop: 8 }}>
            {['Multi-protocol support', 'Environment variables', 'Collection runner', 'Local & offline'].map((feat) => (
              <div key={feat} className="flex items-center gap-2.5" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.6)', flexShrink: 0 }} />
                {feat}
              </div>
            ))}
          </div>
        </div>

        {/* Right - Form */}
        <div className="flex flex-1 flex-col p-8" style={{ minHeight: 520 }}>
          {/* Tabs */}
          <div className="flex gap-0 border-b" style={{ borderColor: 'var(--border)' }}>
            {(['login', 'register'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                className="cursor-pointer border-none bg-transparent px-5 pb-3 pt-1 font-semibold transition-colors"
                style={{
                  borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
                  color: tab === t ? 'var(--accent-text)' : 'var(--muted)',
                  fontSize: 14,
                }}
              >
                {t === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* Error message */}
          {error && (
            <div
              className="mt-4 flex items-center gap-2 rounded-lg px-3.5 py-2.5"
              style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.15)' }}
            >
              <AlertCircle size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
            </div>
          )}

          {/* Form content */}
          <div className="mt-5 flex-1">
            {tab === 'login' ? <LoginForm /> : <RegisterForm />}
          </div>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 13, color: 'var(--hint)' }}>or continue with</span>
            <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
          </div>

          {/* OAuth buttons */}
          <OAuthButtons />
        </div>
      </div>
    </div>
  )
}

/* ── Login Form ────────────────────────────────────────────── */

function LoginForm() {
  const login = useAuthStore((s) => s.login)
  const isLoading = useAuthStore((s) => s.isLoading)
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    await login(emailOrUsername, password)
  }, [emailOrUsername, password, login])

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
          Email or Username
        </label>
        <input
          type="text"
          value={emailOrUsername}
          onChange={(e) => setEmailOrUsername(e.target.value)}
          placeholder="Enter your email or username"
          autoFocus
          className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
          style={{
            fontSize: 13,
            borderColor: 'var(--border)',
            background: 'var(--input-bg)',
            color: 'var(--text)',
          }}
          onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
          onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
        />
      </div>

      <div>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
          Password
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="w-full rounded-lg border py-2.5 pl-3.5 pr-10 outline-none transition-colors"
            style={{
              fontSize: 13,
              borderColor: 'var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
            }}
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

      <button
        type="submit"
        disabled={isLoading || !emailOrUsername || !password}
        className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'var(--accent)', fontSize: 14 }}
      >
        {isLoading && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
        Sign In
      </button>
    </form>
  )
}

/* ── Register Form ─────────────────────────────────────────── */

function RegisterForm() {
  const register = useAuthStore((s) => s.register)
  const isLoading = useAuthStore((s) => s.isLoading)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)

  const passwordsMatch = password === confirmPw
  const canSubmit = email && username && password && confirmPw && passwordsMatch && !isLoading

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordsMatch) return
    await register(email, username, password, displayName || undefined)
  }, [email, username, password, displayName, passwordsMatch, register])

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <div className="flex gap-3">
        <div className="flex-1">
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{ fontSize: 13, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
            onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
            onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
          />
        </div>
        <div className="flex-1">
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="johndoe"
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{ fontSize: 13, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
            onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
            onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
          />
        </div>
      </div>

      <div>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
          Display Name <span style={{ color: 'var(--hint)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="John Doe"
          className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
          style={{ fontSize: 13, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
          onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
          onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            Password
          </label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="w-full rounded-lg border py-2.5 pl-3.5 pr-10 outline-none transition-colors"
              style={{ fontSize: 13, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
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
        <div className="flex-1">
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            Confirm Password
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Re-enter password"
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{
              fontSize: 13,
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
            <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>Passwords do not match</div>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-none py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'var(--accent)', fontSize: 14 }}
      >
        {isLoading && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
        Create Account
      </button>
    </form>
  )
}

/* ── OAuth Buttons ─────────────────────────────────────────── */

function OAuthButtons() {
  const oauthLogin = useAuthStore((s) => s.oauthLogin)
  const isLoading = useAuthStore((s) => s.isLoading)

  return (
    <div className="flex gap-3">
      <button
        type="button"
        disabled={isLoading}
        onClick={() => oauthLogin('google')}
        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border py-2.5 transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)', fontSize: 13 }}
      >
        {/* Google icon */}
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Google
      </button>

      <button
        type="button"
        disabled={isLoading}
        onClick={() => oauthLogin('github')}
        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border py-2.5 transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)', fontSize: 13 }}
      >
        {/* GitHub icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
        GitHub
      </button>

      <button
        type="button"
        disabled={isLoading}
        onClick={() => oauthLogin('gitlab')}
        className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border py-2.5 transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)', fontSize: 13 }}
      >
        {/* GitLab icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51a.42.42 0 0 1 .82 0l2.44 7.51h8.06l2.44-7.51a.42.42 0 0 1 .82 0l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.94z" fill="#E24329" />
          <path d="M12 22.13L16.03 9.67H7.97L12 22.13z" fill="#FC6D26" />
          <path d="M12 22.13L7.97 9.67H1.69L12 22.13z" fill="#FCA326" />
          <path d="M1.69 9.67l-1.22 3.78a.84.84 0 0 0 .3.94L12 22.13 1.69 9.67z" fill="#E24329" />
          <path d="M1.69 9.67h6.28L5.53 2.16a.42.42 0 0 0-.82 0L1.69 9.67z" fill="#FC6D26" />
          <path d="M12 22.13l4.03-12.46h6.28L12 22.13z" fill="#FCA326" />
          <path d="M22.31 9.67l1.22 3.78a.84.84 0 0 1-.3.94L12 22.13l10.31-12.46z" fill="#E24329" />
          <path d="M22.31 9.67h-6.28l2.44-7.51a.42.42 0 0 1 .82 0l3.02 7.51z" fill="#FC6D26" />
        </svg>
        GitLab
      </button>
    </div>
  )
}
