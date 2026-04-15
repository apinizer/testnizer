import { useState, useCallback, useEffect } from 'react'
import { X, User, Lock, LogOut, Trash2, Check, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useAuthStore } from '../../stores/auth.store'
import DeleteConfirmDialog from './DeleteConfirmDialog'

type Tab = 'profile' | 'password'

export default function ProfileModal() {
  const open = useUIStore((s) => s.showProfileModal)
  const setOpen = useUIStore((s) => s.setShowProfileModal)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const updateProfile = useAuthStore((s) => s.updateProfile)
  const changePassword = useAuthStore((s) => s.changePassword)
  const deleteAccount = useAuthStore((s) => s.deleteAccount)

  const [tab, setTab] = useState<Tab>('profile')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
                background: user.avatarUrl ? 'transparent' : 'var(--accent)',
                fontSize: 15,
              }}
            >
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                getInitials(user.displayName || user.username)
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>
                {user.displayName || user.username}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{user.email}</div>
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

        {/* Tabs */}
        <div className="flex shrink-0 gap-0 border-b px-5" style={{ borderColor: 'var(--border)' }}>
          {[
            { key: 'profile' as const, label: 'Profile', icon: User },
            { key: 'password' as const, label: 'Password', icon: Lock },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-3 py-2.5 transition-colors"
              style={{
                borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
                color: tab === key ? 'var(--accent-text)' : 'var(--muted)',
                fontWeight: tab === key ? 600 : 400,
                marginBottom: -1,
                fontSize: 13,
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-5">
          {tab === 'profile' && <ProfileTab user={user} updateProfile={updateProfile} />}
          {tab === 'password' && <PasswordTab user={user} changePassword={changePassword} />}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-2 py-1 transition-colors hover:opacity-80"
            style={{ color: 'var(--red)', fontSize: 13 }}
          >
            <Trash2 size={13} />
            Delete Account
          </button>

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
            Sign Out
          </button>
        </div>
      </div>

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        itemName={user.displayName || user.username}
        itemType="account"
        description="This will permanently delete your account and all data. This action cannot be undone."
        requireTyping
        onConfirm={async () => {
          const ok = await deleteAccount()
          if (ok) {
            setShowDeleteConfirm(false)
            setOpen(false)
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

/* ── Profile Tab ───────────────────────────────────────────── */

function ProfileTab({
  user,
  updateProfile,
}: {
  user: { displayName: string | null; email: string; username: string; authProvider: string }
  updateProfile: (data: { displayName?: string; email?: string; username?: string }) => Promise<boolean>
}) {
  const [displayName, setDisplayName] = useState(user.displayName || '')
  const [email, setEmail] = useState(user.email)
  const [username, setUsername] = useState(user.username)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDisplayName(user.displayName || '')
    setEmail(user.email)
    setUsername(user.username)
  }, [user])

  const hasChanges = displayName !== (user.displayName || '') || email !== user.email || username !== user.username

  const handleSave = useCallback(async () => {
    setError('')
    const ok = await updateProfile({
      displayName: displayName !== (user.displayName || '') ? displayName : undefined,
      email: email !== user.email ? email : undefined,
      username: username !== user.username ? username : undefined,
    })
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(useAuthStore.getState().error || 'Update failed')
    }
  }, [displayName, email, username, user, updateProfile])

  const isLocal = user.authProvider === 'local'

  return (
    <div className="flex flex-col gap-4">
      {/* Provider badge */}
      <div className="flex items-center gap-2">
        <span
          className="rounded-md px-2.5 py-1"
          style={{
            fontSize: 13,
            fontWeight: 500,
            background: isLocal ? 'var(--accent-light)' : 'var(--green-bg)',
            color: isLocal ? 'var(--accent-text)' : 'var(--green)',
          }}
        >
          {isLocal ? 'Local Account' : `${user.authProvider.charAt(0).toUpperCase() + user.authProvider.slice(1)} Account`}
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(185,28,28,0.08)' }}>
          <AlertCircle size={14} style={{ color: 'var(--red)' }} />
          <span style={{ fontSize: 13, color: 'var(--red)' }}>{error}</span>
        </div>
      )}

      <InputField label="Display Name" value={displayName} onChange={setDisplayName} />
      <InputField label="Email" value={email} onChange={setEmail} type="email" disabled={!isLocal} />
      <InputField label="Username" value={username} onChange={setUsername} disabled={!isLocal} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border-none px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: saved ? 'var(--green)' : 'var(--accent)', fontSize: 13 }}
        >
          {saved && <Check size={14} />}
          {saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

/* ── Password Tab ──────────────────────────────────────────── */

function PasswordTab({
  user,
  changePassword,
}: {
  user: { authProvider: string }
  changePassword: (current: string, newPw: string) => Promise<{ success: boolean; error?: string }>
}) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  if (user.authProvider !== 'local') {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10" style={{ color: 'var(--hint)' }}>
        <Lock size={28} />
        <div style={{ fontSize: 13 }}>Password management is not available for social login accounts.</div>
      </div>
    )
  }

  const passwordsMatch = newPw === confirmPw
  const canSubmit = currentPw && newPw && confirmPw && passwordsMatch && newPw.length >= 6

  const handleSubmit = async (e: React.FormEvent) => {
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
  }

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
          <span style={{ fontSize: 13, color: 'var(--green)' }}>Password changed successfully</span>
        </div>
      )}

      <div>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
          Current Password
        </label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
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

      <div className="flex gap-3">
        <div className="flex-1">
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            New Password
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Min 6 characters"
            className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors"
            style={{ fontSize: 13, borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--text)' }}
            onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
            onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
          />
        </div>
        <div className="flex-1">
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            Confirm Password
          </label>
          <input
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
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

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border-none px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', fontSize: 13 }}
        >
          Change Password
        </button>
      </div>
    </form>
  )
}

/* ── Helpers ───────────────────────────────────────────────── */

function InputField({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  disabled?: boolean
}) {
  return (
    <div>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
        {label}
        {disabled && <span style={{ color: 'var(--hint)', fontWeight: 400, marginLeft: 6 }}>(read-only)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border px-3.5 py-2.5 outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        style={{ fontSize: 13, borderColor: 'var(--border)', background: disabled ? 'var(--surface)' : 'var(--input-bg)', color: 'var(--text)' }}
        onFocus={(e) => { if (!disabled) (e.target as HTMLElement).style.borderColor = 'var(--accent)' }}
        onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border)' }}
      />
    </div>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.substring(0, 2).toUpperCase()
}
