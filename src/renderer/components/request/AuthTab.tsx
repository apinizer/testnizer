import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { resolveVariables } from '../../lib/variable-resolver'
import { toast } from '../../lib/toast'
import SoapSecuritySection from '../protocols/SoapSecuritySection'
import { useTranslation } from '../../lib/i18n'
import type { AuthType } from '../../types'

const AUTH_TYPE_TEST_IDS: Partial<Record<AuthType, string>> = {
  none: 'noAuth',
  bearer: 'bearer',
  basic: 'basic',
  'api-key': 'apiKey',
  oauth2: 'oauth2',
  digest: 'digest',
  ntlm: 'ntlm',
  wsse: 'wsse',
}

// `labelKey` → i18n (issue #193). The project auth pane already owns most of
// these strings, so the request tab reuses its keys where the English matches.
const AUTH_OPTIONS: { value: AuthType; labelKey: string; soapOnly?: boolean }[] = [
  { value: 'inherit', labelKey: 'authPane.inherit' },
  { value: 'none', labelKey: 'auth.noAuth' },
  { value: 'bearer', labelKey: 'auth.bearerToken' },
  { value: 'basic', labelKey: 'auth.basicAuth' },
  { value: 'api-key', labelKey: 'auth.apiKey' },
  { value: 'oauth2', labelKey: 'auth.oauth2' },
  { value: 'digest', labelKey: 'authTab.digestAuth' },
  { value: 'ntlm', labelKey: 'auth.ntlm' },
  { value: 'wsse', labelKey: 'authTab.wsSecurity', soapOnly: true },
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
  dataTestId,
  toggleTestId,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  dataTestId?: string
  toggleTestId?: string
}) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
        style={{ color: 'var(--text)', paddingRight: 36 }}
        placeholder={placeholder || t('authPane.password')}
        data-testid={dataTestId}
      />
      <button
        type="button"
        data-testid={toggleTestId}
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
  const { t } = useTranslation()
  const auth = useRequestStore((s) => s.auth)
  const setAuth = useRequestStore((s) => s.setAuth)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const isSoap = activeTab?.protocol === 'soap'
  const [fetchingToken, setFetchingToken] = useState(false)

  // "Get New Access Token" — resolve {{vars}} in the OAuth2 config against the
  // active environment, run the grant in the main process, and store the
  // returned token. (The same grant also runs automatically at request time;
  // this lets the user fetch + inspect a token up front.)
  async function getNewToken(): Promise<void> {
    const o = auth.oauth2
    if (!o) return
    setFetchingToken(true)
    try {
      const vars = useEnvironmentStore.getState().getActiveVariables()
      const rv = (s: string | undefined): string | undefined =>
        s === undefined ? undefined : resolveVariables(s, vars)
      const res = (await window.api?.oauth2?.getToken({
        grantType: o.grantType,
        tokenUrl: rv(o.tokenUrl),
        clientId: rv(o.clientId),
        clientSecret: rv(o.clientSecret),
        scope: rv(o.scope),
        username: rv(o.username),
        password: rv(o.password),
        clientAuth: o.clientAuth,
      })) as { success: boolean; data?: { accessToken: string }; error?: string } | undefined
      if (res?.success && res.data?.accessToken) {
        setAuth({ ...auth, oauth2: { ...auth.oauth2!, token: res.data.accessToken } })
        toast.success(t('authTab.tokenFetched'))
      } else {
        toast.error(res?.error || t('authTab.tokenFailed'))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setFetchingToken(false)
    }
  }

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
              data-testid={`auth-type-${AUTH_TYPE_TEST_IDS[opt.value] ?? opt.value}`}
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
              {t(opt.labelKey)}
            </button>
          )
        })}
      </div>

      {/* ── No Auth ── */}
      {auth.type === 'none' && (
        <div className="py-8 text-center" style={{ color: 'var(--hint)' }}>
          {t('authTab.noAuthHelp')}
        </div>
      )}

      {/* ── Inherit from parent ── */}
      {auth.type === 'inherit' && (
        <div className="py-8 text-center" style={{ color: 'var(--hint)' }}>
          {t('authTab.inheritHelp')}
        </div>
      )}

      {/* ── Bearer Token ── */}
      {auth.type === 'bearer' && (
        <div className={CARD}>
          <div className={LABEL} style={{ color: 'var(--text)' }}>
            {t('authPane.token')}
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
              data-testid="auth-bearer-token"
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
            {t('authTab.sentAs')}{' '}
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
              {t('authPane.username')}
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
              placeholder={t('authPane.username')}
              data-testid="auth-basic-user"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.password')}
            </div>
            <PasswordInput
              value={auth.basic?.password || ''}
              onChange={(v) =>
                setAuth({ ...auth, basic: { username: auth.basic?.username || '', password: v } })
              }
              dataTestId="auth-basic-pass"
              toggleTestId="auth-password-toggle"
            />
          </div>
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            {t('authTab.basicHelp')}
          </div>
        </div>
      )}

      {/* ── API Key ── */}
      {auth.type === 'api-key' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.key')}
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
              data-testid="auth-apikey-key"
            />
          </div>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.value')}
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
              data-testid="auth-apikey-value"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.addTo')}
            </div>
            <div className="flex gap-2">
              {(['header', 'query'] as const).map((loc) => {
                const isActive = (auth.apiKey?.in || 'header') === loc
                return (
                  <button
                    key={loc}
                    type="button"
                    data-testid={
                      loc === 'header' ? 'auth-apikey-in-header' : 'auth-apikey-in-query'
                    }
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
                    {loc === 'header' ? t('authTab.inHeader') : t('authTab.inQuery')}
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
              {t('authTab.grantType')}
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
              data-testid="auth-oauth2-grant"
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
                {t('authTab.authUrl')}
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
                {t('authTab.tokenUrl')}
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
              {t('authTab.clientId')}
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
                {t('authTab.clientSecret')}
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
                  {t('authPane.username')}
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
                  placeholder={t('authTab.ownerUsername')}
                />
              </div>
              <div className="mb-3">
                <div className={LABEL} style={{ color: 'var(--text)' }}>
                  {t('authPane.password')}
                </div>
                <PasswordInput
                  value={auth.oauth2?.password || ''}
                  onChange={(v) =>
                    setAuth({
                      ...auth,
                      oauth2: { ...auth.oauth2!, password: v },
                    })
                  }
                  placeholder={t('authTab.ownerPassword')}
                />
              </div>
            </>
          )}

          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authTab.scope')}
            </div>
            <input
              value={auth.oauth2?.scope || ''}
              onChange={(e) =>
                setAuth({ ...auth, oauth2: { ...auth.oauth2!, scope: e.target.value } })
              }
              className={INPUT}
              style={{ color: 'var(--text)' }}
              placeholder={t('authTab.scopePlaceholder')}
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
              {t('authTab.currentToken')}
            </div>
            <input
              value={auth.oauth2?.token || ''}
              onChange={(e) =>
                setAuth({ ...auth, oauth2: { ...auth.oauth2!, token: e.target.value } })
              }
              className={`font-mono ${INPUT}`}
              style={{ color: 'var(--text)' }}
              placeholder={t('authTab.tokenPlaceholder')}
            />
            <button
              type="button"
              onClick={getNewToken}
              disabled={fetchingToken || !auth.oauth2?.tokenUrl}
              data-testid="auth-oauth2-get-token"
              className="mt-2 cursor-pointer rounded-[7px] px-3 py-1.5 font-medium text-white"
              style={{
                background: 'var(--accent)',
                border: 'none',
                opacity: fetchingToken || !auth.oauth2?.tokenUrl ? 0.6 : 1,
              }}
            >
              {fetchingToken ? t('authTab.fetching') : t('authTab.getNewToken')}
            </button>
            {(auth.oauth2?.grantType === 'authorization_code' ||
              auth.oauth2?.grantType === 'implicit') && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--hint)' }}>
                {t('authTab.browserGrantHelp')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Digest Auth ── */}
      {auth.type === 'digest' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.username')}
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
              placeholder={t('authPane.username')}
              data-testid="auth-digest-user"
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.password')}
            </div>
            <PasswordInput
              value={auth.digest?.password || ''}
              onChange={(v) =>
                setAuth({ ...auth, digest: { username: auth.digest?.username || '', password: v } })
              }
              dataTestId="auth-digest-pass"
            />
          </div>
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            {t('authTab.digestHelp')}
          </div>
        </div>
      )}

      {/* ── NTLM ── */}
      {auth.type === 'ntlm' && (
        <div className={CARD}>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.username')}
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
              placeholder={t('authPane.username')}
            />
          </div>
          <div className="mb-3">
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authPane.password')}
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
              {t('authTab.domain')}
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
              placeholder={t('authTab.domainPlaceholder')}
            />
          </div>
          <div>
            <div className={LABEL} style={{ color: 'var(--text)' }}>
              {t('authTab.workstation')}
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
              placeholder={t('authTab.workstationPlaceholder')}
            />
          </div>
          <div className="mt-3" style={{ color: 'var(--hint)' }}>
            {t('authTab.ntlmHelp')}
          </div>
        </div>
      )}

      {/* ── WS-Security (SOAP only) ── */}
      {auth.type === 'wsse' && (
        <div className={CARD} data-testid="auth-wsse-section">
          <SoapSecuritySection />
        </div>
      )}
    </div>
  )
}
