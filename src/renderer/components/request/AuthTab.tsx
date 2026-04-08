import { Lock } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import type { AuthType } from '../../types'

const AUTH_OPTIONS: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'api-key', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'digest', label: 'Digest' },
  { value: 'ntlm', label: 'NTLM' },
]

export default function AuthTab() {
  const auth = useRequestStore((s) => s.auth)
  const setAuth = useRequestStore((s) => s.setAuth)

  return (
    <div>
      {/* Type selector — Apidog-style pill strip */}
      <div
        className="mb-4 flex items-center gap-1"
        style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}
      >
        {AUTH_OPTIONS.map((opt) => {
          const isActive = auth.type === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAuth({ ...auth, type: opt.value })}
              className="cursor-pointer rounded-full text-[0.8125rem] font-medium transition-all"
              style={{
                padding: '4px 12px',
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--muted)',
                border: 'none',
              }}
              onMouseOver={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--fill-4)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
                }
              }}
              onMouseOut={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--muted)'
                }
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Bearer Token */}
      {auth.type === 'bearer' && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] p-4">
          <div className="mb-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>Token</div>
          <div className="flex gap-2">
            <input
              value={auth.bearer?.token || ''}
              onChange={(e) =>
                setAuth({ ...auth, bearer: { ...auth.bearer, token: e.target.value, prefix: auth.bearer?.prefix } })
              }
              className="flex-1 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-sm outline-none"
              style={{ color: 'var(--text)' }}
              placeholder="{{token}}"
            />
            <button
              type="button"
              className="rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2"
              style={{ color: 'var(--muted)' }}
            >
              <Lock size={14} />
            </button>
          </div>
          <div className="mt-3 text-[0.8125rem]" style={{ color: 'var(--hint)' }}>
            Sent as:{' '}
            <code
              className="rounded px-1.5 py-0.5 text-[0.8125rem]"
              style={{ background: 'var(--fill-4)', color: 'var(--text)' }}
            >
              Authorization: Bearer &lt;token&gt;
            </code>
          </div>
        </div>
      )}

      {/* Basic Auth */}
      {auth.type === 'basic' && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] p-4">
          <div className="mb-3">
            <div className="mb-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>Username</div>
            <input
              value={auth.basic?.username || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  basic: { username: e.target.value, password: auth.basic?.password || '' },
                })
              }
              className="w-full rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-sm outline-none"
              style={{ color: 'var(--text)' }}
              placeholder="Username"
            />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>Password</div>
            <input
              type="password"
              value={auth.basic?.password || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  basic: { username: auth.basic?.username || '', password: e.target.value },
                })
              }
              className="w-full rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-sm outline-none"
              style={{ color: 'var(--text)' }}
              placeholder="Password"
            />
          </div>
        </div>
      )}

      {/* API Key */}
      {auth.type === 'api-key' && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] p-4">
          <div className="mb-3">
            <div className="mb-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>Key</div>
            <input
              value={auth.apiKey?.key || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  apiKey: {
                    key: e.target.value,
                    value: auth.apiKey?.value || '',
                    in: auth.apiKey?.in || 'header',
                  },
                })
              }
              className="w-full rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-sm outline-none"
              style={{ color: 'var(--text)' }}
              placeholder="X-API-Key"
            />
          </div>
          <div className="mb-3">
            <div className="mb-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>Value</div>
            <input
              value={auth.apiKey?.value || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  apiKey: {
                    key: auth.apiKey?.key || '',
                    value: e.target.value,
                    in: auth.apiKey?.in || 'header',
                  },
                })
              }
              className="w-full rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-sm outline-none"
              style={{ color: 'var(--text)' }}
              placeholder="api-key-value"
            />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8125rem] font-medium" style={{ color: 'var(--text)' }}>Add to</div>
            <div className="flex gap-2">
              {(['header', 'query'] as const).map((loc) => {
                const isActive = (auth.apiKey?.in || 'header') === loc
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() =>
                      setAuth({
                        ...auth,
                        apiKey: {
                          key: auth.apiKey?.key || '',
                          value: auth.apiKey?.value || '',
                          in: loc,
                        },
                      })
                    }
                    className="cursor-pointer rounded-full text-[0.8125rem] font-medium"
                    style={{
                      padding: '4px 14px',
                      background: isActive ? 'var(--accent)' : 'var(--fill-4)',
                      color: isActive ? '#ffffff' : 'var(--muted)',
                      border: 'none',
                    }}
                  >
                    {loc === 'header' ? 'Header' : 'Query Params'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* No Auth */}
      {auth.type === 'none' && (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--hint)' }}>
          No authentication configured for this request.
        </div>
      )}
    </div>
  )
}
