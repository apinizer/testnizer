import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import SoapSecuritySection from '../protocols/SoapSecuritySection'
import type { AuthType } from '../../types'

const AUTH_OPTIONS: { value: AuthType; label: string; soapOnly?: boolean }[] = [
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'api-key', label: 'API Key' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'digest', label: 'Digest Auth' },
  { value: 'ntlm', label: 'NTLM' },
  { value: 'wsse', label: 'WS-Security', soapOnly: true },
]

/* Shared field styles */
const LABEL = 'mb-1.5 font-medium'
const INPUT =
  'w-full rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 outline-none'
const CARD = 'rounded-lg border border-[var(--border)] bg-[var(--white)] p-4'

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
        style={{ color: 'var(--text)', paddingRight: 36 }}
        placeholder={placeholder || 'Password'}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
        style={{ background: 'transparent', border: 'none', color: 'var(--muted)', padding: 2 }}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

export default function AuthTab() {
  const auth = useRequestStore((s) => s.auth)
  const setAuth = useRequestStore((s) => s.setAuth)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const isSoap = activeTab?.protocol === 'soap'

  // SOAP WS-Security sync (panel rendered via SoapSecuritySection below)
  const setWsSecurity = useSoapStore((s) => s.setWsSecurity)

  const visibleOptions = AUTH_OPTIONS.filter((opt) => !opt.soapOnly || isSoap)

  return (
    <div>
      {/* Type selector — pill strip */}
      <div
        className="mb-4 flex items-center gap-1 flex-wrap"
        style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}
      >
        {visibleOptions.map((opt) => {
          const isActive = auth.type === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setAuth({ ...auth, type: opt.value })
                if (opt.value === 'wsse') setWsSecurity({ enabled: true })
                else if (auth.type === 'wsse') setWsSecurity({ enabled: false })
              }}
              className="cursor-pointer rounded-full font-medium transition-all"
              style={{
                padding: '4px 12px',
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--muted)',
                border: 'none',
              }}
              onMouseOver={(e) => {
                if (!isActive) {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--fill-4)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
                }
              }}
              onMouseOut={(e) => {
                if (!isActive) {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--muted)'
                }
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* ── No Auth ── */}
      {auth.type === 'none' && (
        <div className="py-8 text-center" style={{ color: 'var(--hint)' }}>
          This request does not use any authorization.
        </div>
      )}

      {/* ── Bearer Token ── */}
      {auth.type === 'bearer' && (
        <div className={CARD}>
          <div className={LABEL} style={{ color: 'var(--text)' }}>
            Token
          </div>
          <div className="flex gap-2">
            <input
              value={auth.bearer?.token || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  bearer: { ...auth.bearer, token: e.target.value, prefix: auth.bearer?.prefix },
                })
              }
              className={`flex-1 font-mono ${INPUT}`}
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
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            Sent as:{' '}
            <code
              className="rounded px-1.5 py-0.5"
              style={{ background: 'var(--fill-4)', color: 'var(--text)' }}
            >
              Authorization: Bearer &lt;token&gt;
            </code>
          </div>
        </div>
      )}

      {/* ── Basic Auth ── */}
      {auth.type === 'basic' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Username
            </div>
            <input
              value={auth.basic?.username || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  basic: { username: e.target.value, password: auth.basic?.password || '' },
                })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="Username"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Password
            </div>
            <PasswordInput
              value={auth.basic?.password || ''}
              onChange={(v) =>
                setAuth({ ...auth, basic: { username: auth.basic?.username || '', password: v } })
              }
            />
          </div>
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            The authorization header will be auto-generated from the username and password.
          </div>
        </div>
      )}

      {/* ── API Key ── */}
      {auth.type === 'api-key' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Key
            </div>
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
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="X-API-Key"
            />
          </div>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Value
            </div>
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
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="api-key-value"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Add to
            </div>
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
                    className="cursor-pointer rounded-full font-medium"
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

      {/* ── OAuth 2.0 ── */}
      {auth.type === 'oauth2' && (
        <div className={CARD}>
          <div className="mb-4">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Grant Type
            </div>
            <select
              value={auth.oauth2?.grantType || 'authorization_code'}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  oauth2: {
                    ...auth.oauth2!,
                    grantType: e.target.value as
                      | 'authorization_code'
                      | 'client_credentials'
                      | 'password'
                      | 'implicit',
                    tokenUrl: auth.oauth2?.tokenUrl || '',
                    clientId: auth.oauth2?.clientId || '',
                  },
                })
              }
              className={`${INPUT} cursor-pointer`}
              style={{ color: 'var(--text)' }}
            >
              <option value="authorization_code">Authorization Code</option>
              <option value="client_credentials">Client Credentials</option>
              <option value="password">Password Credentials</option>
              <option value="implicit">Implicit</option>
            </select>
          </div>

          {/* Auth URL — shown for authorization_code & implicit */}
          {(auth.oauth2?.grantType === 'authorization_code' ||
            auth.oauth2?.grantType === 'implicit') && (
            <div className="mb-3">
              <div className={LABEL} style={{ color: 'var(--text)' }}>
                Auth URL
              </div>
              <input
                value={auth.oauth2?.authUrl || ''}
                onChange={(e) =>
                  setAuth({ ...auth, oauth2: { ...auth.oauth2!, authUrl: e.target.value } })
                }
                className={INPUT}
                style={{ color: 'var(--text)' }}
                placeholder="https://example.com/oauth/authorize"
              />
            </div>
          )}

          {/* Token URL — not shown for implicit */}
          {auth.oauth2?.grantType !== 'implicit' && (
            <div className="mb-3">
              <div className={LABEL} style={{ color: 'var(--text)' }}>
                Access Token URL
              </div>
              <input
                value={auth.oauth2?.tokenUrl || ''}
                onChange={(e) =>
                  setAuth({ ...auth, oauth2: { ...auth.oauth2!, tokenUrl: e.target.value } })
                }
                className={INPUT}
                style={{ color: 'var(--text)' }}
                placeholder="https://example.com/oauth/token"
              />
            </div>
          )}

          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Client ID
            </div>
            <input
              value={auth.oauth2?.clientId || ''}
              onChange={(e) =>
                setAuth({ ...auth, oauth2: { ...auth.oauth2!, clientId: e.target.value } })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="your-client-id"
            />
          </div>

          {/* Client Secret — not needed for implicit */}
          {auth.oauth2?.grantType !== 'implicit' && (
            <div className="mb-3">
              <div className={LABEL} style={{ color: 'var(--text)' }}>
                Client Secret
              </div>
              <PasswordInput
                value={auth.oauth2?.clientSecret || ''}
                onChange={(v) => setAuth({ ...auth, oauth2: { ...auth.oauth2!, clientSecret: v } })}
                placeholder="your-client-secret"
              />
            </div>
          )}

          {/* Username & Password — only for password grant */}
          {auth.oauth2?.grantType === 'password' && (
            <>
              <div className="mb-3">
                <div className={LABEL} style={{ color: 'var(--text)' }}>
                  Username
                </div>
                <input
                  value={auth.oauth2?.username || ''}
                  onChange={(e) =>
                    setAuth({
                      ...auth,
                      oauth2: { ...auth.oauth2!, username: e.target.value },
                    })
                  }
                  className={INPUT}
                  style={{ color: 'var(--text)' }}
                  placeholder="Resource owner username"
                />
              </div>
              <div className="mb-3">
                <div className={LABEL} style={{ color: 'var(--text)' }}>
                  Password
                </div>
                <PasswordInput
                  value={auth.oauth2?.password || ''}
                  onChange={(v) =>
                    setAuth({
                      ...auth,
                      oauth2: { ...auth.oauth2!, password: v },
                    })
                  }
                  placeholder="Resource owner password"
                />
              </div>
            </>
          )}

          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Scope
            </div>
            <input
              value={auth.oauth2?.scope || ''}
              onChange={(e) =>
                setAuth({ ...auth, oauth2: { ...auth.oauth2!, scope: e.target.value } })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="read write (space separated)"
            />
          </div>

          {/* Current Token */}
          <div
            className="mt-4 rounded-lg p-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div
              className="mb-2 font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              Current Token
            </div>
            <input
              value={auth.oauth2?.token || ''}
              onChange={(e) =>
                setAuth({ ...auth, oauth2: { ...auth.oauth2!, token: e.target.value } })
              }
              className={`font-mono ${INPUT}`}
              style={{ color: 'var(--text)' }}
              placeholder="Paste token here or use Get New Access Token"
            />
            <button
              type="button"
              className="mt-2 cursor-pointer rounded-[7px] px-3 py-1.5 font-medium text-white"
              style={{ background: 'var(--accent)', border: 'none' }}
            >
              Get New Access Token
            </button>
          </div>
        </div>
      )}

      {/* ── Digest Auth ── */}
      {auth.type === 'digest' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Username
            </div>
            <input
              value={auth.digest?.username || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  digest: { username: e.target.value, password: auth.digest?.password || '' },
                })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="Username"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Password
            </div>
            <PasswordInput
              value={auth.digest?.password || ''}
              onChange={(v) =>
                setAuth({ ...auth, digest: { username: auth.digest?.username || '', password: v } })
              }
            />
          </div>
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            Digest authentication uses a challenge-response mechanism. The client sends the request,
            the server responds with a nonce, and the client resends with the digest.
          </div>
        </div>
      )}

      {/* ── NTLM ── */}
      {auth.type === 'ntlm' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Username
            </div>
            <input
              value={auth.ntlm?.username || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  ntlm: {
                    ...auth.ntlm,
                    username: e.target.value,
                    password: auth.ntlm?.password || '',
                  },
                })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="Username"
            />
          </div>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Password
            </div>
            <PasswordInput
              value={auth.ntlm?.password || ''}
              onChange={(v) =>
                setAuth({
                  ...auth,
                  ntlm: { ...auth.ntlm, username: auth.ntlm?.username || '', password: v },
                })
              }
            />
          </div>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Domain
            </div>
            <input
              value={auth.ntlm?.domain || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  ntlm: {
                    username: auth.ntlm?.username || '',
                    password: auth.ntlm?.password || '',
                    domain: e.target.value,
                    workstation: auth.ntlm?.workstation,
                  },
                })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="DOMAIN (optional)"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              Workstation
            </div>
            <input
              value={auth.ntlm?.workstation || ''}
              onChange={(e) =>
                setAuth({
                  ...auth,
                  ntlm: {
                    username: auth.ntlm?.username || '',
                    password: auth.ntlm?.password || '',
                    domain: auth.ntlm?.domain,
                    workstation: e.target.value,
                  },
                })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder="Workstation (optional)"
            />
          </div>
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            NTLM authentication is used primarily in Windows environments. Domain and workstation
            are optional.
          </div>
        </div>
      )}

      {/* ── WS-Security (SOAP only) ── */}
      {auth.type === 'wsse' && (
        <div className={CARD}>
          <SoapSecuritySection />
        </div>
      )}
    </div>
  )
}
