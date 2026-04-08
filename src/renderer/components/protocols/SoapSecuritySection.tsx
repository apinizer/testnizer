import { useState } from 'react'
import { ChevronDown, ChevronRight, Shield } from 'lucide-react'
import { useSoapStore } from '../../stores/soap.store'

export default function SoapSecuritySection() {
  const [expanded, setExpanded] = useState(false)
  const wsSecurity = useSoapStore((s) => s.wsSecurity)
  const setWsSecurity = useSoapStore((s) => s.setWsSecurity)

  return (
    <div className="rounded-lg border border-[var(--border)]">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        style={{ background: 'transparent', border: 'none' }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Shield size={14} className="text-[var(--accent)]" />
        <span>WS-Security</span>
        {wsSecurity.enabled && (
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-[0.875rem]"
            style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
          >
            Enabled
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
          {/* Enable toggle */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wsSecurity.enabled}
              onChange={(e) => setWsSecurity({ enabled: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text)]">Enable WS-Security</span>
          </label>

          {wsSecurity.enabled && (
            <>
              {/* Type */}
              <div className="space-y-1">
                <span className="text-[0.875rem] text-[var(--muted)]">Security Type</span>
                <select
                  value={wsSecurity.type}
                  onChange={(e) =>
                    setWsSecurity({ type: e.target.value as 'username-token' | 'timestamp' })
                  }
                  className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="username-token">Username Token</option>
                  <option value="timestamp">Timestamp</option>
                </select>
              </div>

              {wsSecurity.type === 'username-token' && (
                <>
                  {/* Username */}
                  <div className="space-y-1">
                    <span className="text-[0.875rem] text-[var(--muted)]">Username</span>
                    <input
                      type="text"
                      value={wsSecurity.username || ''}
                      onChange={(e) => setWsSecurity({ username: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      placeholder="Enter username"
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1">
                    <span className="text-[0.875rem] text-[var(--muted)]">Password</span>
                    <input
                      type="password"
                      value={wsSecurity.password || ''}
                      onChange={(e) => setWsSecurity({ password: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      placeholder="Enter password"
                    />
                  </div>

                  {/* Password Type */}
                  <div className="space-y-1">
                    <span className="text-[0.875rem] text-[var(--muted)]">Password Type</span>
                    <select
                      value={wsSecurity.passwordType || 'PasswordText'}
                      onChange={(e) =>
                        setWsSecurity({
                          passwordType: e.target.value as 'PasswordText' | 'PasswordDigest',
                        })
                      }
                      className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    >
                      <option value="PasswordText">PasswordText</option>
                      <option value="PasswordDigest">PasswordDigest</option>
                    </select>
                  </div>
                </>
              )}

              {/* Add Timestamp */}
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={wsSecurity.addTimestamp || false}
                  onChange={(e) => setWsSecurity({ addTimestamp: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <span className="text-sm text-[var(--text)]">Add Timestamp</span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}
