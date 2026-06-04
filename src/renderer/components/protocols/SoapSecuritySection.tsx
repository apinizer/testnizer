import { useState } from 'react'
import { ChevronDown, ChevronRight, Shield } from 'lucide-react'
import { useSoapStore } from '../../stores/soap.store'
import type {
  WsSecurityMode,
  WsSignReference,
  WsSignAlgorithm,
  WsEncryptAlgorithm,
  WsKeyWrapAlgorithm,
  WsKeyInfoStrategy,
} from '../../types'

const INPUT =
  'w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]'

const TEXTAREA =
  'w-full min-h-[80px] rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

const SIGN_ALGORITHMS: WsSignAlgorithm[] = ['RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512']
const ENCRYPT_ALGORITHMS: WsEncryptAlgorithm[] = [
  'AES-128-CBC',
  'AES-256-CBC',
  'AES-128-GCM',
  'AES-256-GCM',
]
const KEY_WRAP_ALGORITHMS: WsKeyWrapAlgorithm[] = ['RSA-OAEP', 'RSA-1.5']
const KEY_INFO_STRATEGIES: WsKeyInfoStrategy[] = ['BinarySecurityToken', 'IssuerSerial']
const SIGN_REFERENCES: WsSignReference[] = ['Body', 'Timestamp', 'UsernameToken']

export default function SoapSecuritySection() {
  const [expanded, setExpanded] = useState(true)
  const wsSecurity = useSoapStore((s) => s.wsSecurity)
  const setWsSecurity = useSoapStore((s) => s.setWsSecurity)

  const modes = wsSecurity.modes ?? []

  function toggleMode(mode: WsSecurityMode, enable: boolean): void {
    const next = enable ? Array.from(new Set([...modes, mode])) : modes.filter((m) => m !== mode)
    setWsSecurity({ modes: next })
  }

  function updateUsernameToken(patch: Partial<NonNullable<typeof wsSecurity.usernameToken>>): void {
    setWsSecurity({
      usernameToken: {
        username: wsSecurity.usernameToken?.username ?? '',
        password: wsSecurity.usernameToken?.password ?? '',
        passwordType: wsSecurity.usernameToken?.passwordType ?? 'PasswordText',
        nonce: wsSecurity.usernameToken?.nonce ?? false,
        created: wsSecurity.usernameToken?.created ?? false,
        ...patch,
      },
    })
  }

  function updateTimestamp(patch: Partial<NonNullable<typeof wsSecurity.timestamp>>): void {
    setWsSecurity({
      timestamp: { ttlSeconds: wsSecurity.timestamp?.ttlSeconds ?? 300, ...patch },
    })
  }

  function updateSign(patch: Partial<NonNullable<typeof wsSecurity.sign>>): void {
    setWsSecurity({
      sign: {
        privateKeyPem: wsSecurity.sign?.privateKeyPem ?? '',
        certPem: wsSecurity.sign?.certPem ?? '',
        algorithm: wsSecurity.sign?.algorithm ?? 'RSA-SHA256',
        references: wsSecurity.sign?.references ?? ['Body'],
        keyInfoStrategy: wsSecurity.sign?.keyInfoStrategy ?? 'BinarySecurityToken',
        ...patch,
      },
    })
  }

  function updateEncrypt(patch: Partial<NonNullable<typeof wsSecurity.encrypt>>): void {
    setWsSecurity({
      encrypt: {
        recipientCertPem: wsSecurity.encrypt?.recipientCertPem ?? '',
        algorithm: wsSecurity.encrypt?.algorithm ?? 'AES-256-CBC',
        keyWrap: wsSecurity.encrypt?.keyWrap ?? 'RSA-OAEP',
        targetXpath: wsSecurity.encrypt?.targetXpath,
        ...patch,
      },
    })
  }

  function toggleSignReference(ref: WsSignReference, enable: boolean): void {
    const current = wsSecurity.sign?.references ?? ['Body']
    const next = enable ? Array.from(new Set([...current, ref])) : current.filter((r) => r !== ref)
    updateSign({ references: next.length === 0 ? ['Body'] : next })
  }

  return (
    <div className="rounded-lg border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        style={{ background: 'transparent', border: 'none' }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Shield size={14} className="text-[var(--accent)]" />
        <span>WS-Security</span>
        {wsSecurity.enabled && modes.length > 0 && (
          <span
            className="ml-auto rounded-full px-2 py-0.5"
            style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
          >
            {modes.join(' + ')}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wsSecurity.enabled}
              onChange={(e) => setWsSecurity({ enabled: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span className="text-[var(--text)]">Enable WS-Security</span>
          </label>

          {wsSecurity.enabled && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(['username-token', 'timestamp', 'sign', 'encrypt'] as WsSecurityMode[]).map(
                  (mode) => (
                    <label
                      key={mode}
                      className="flex cursor-pointer items-center gap-2 rounded border border-[var(--border)] px-2 py-1.5 hover:bg-[var(--surface)]"
                    >
                      <input
                        type="checkbox"
                        checked={modes.includes(mode)}
                        onChange={(e) => toggleMode(mode, e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                      <span className="text-[var(--text)] text-sm capitalize">
                        {mode.replace('-', ' ')}
                      </span>
                    </label>
                  ),
                )}
              </div>

              {modes.includes('username-token') && (
                <fieldset className="rounded border border-[var(--border)] p-3 space-y-2">
                  <legend className="px-1 text-xs font-medium text-[var(--accent-text)]">
                    UsernameToken
                  </legend>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Username</span>
                    <input
                      type="text"
                      value={wsSecurity.usernameToken?.username ?? ''}
                      onChange={(e) => updateUsernameToken({ username: e.target.value })}
                      className={INPUT}
                      placeholder="Enter username"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Password</span>
                    <input
                      type="password"
                      value={wsSecurity.usernameToken?.password ?? ''}
                      onChange={(e) => updateUsernameToken({ password: e.target.value })}
                      className={INPUT}
                      placeholder="Enter password"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Password Type</span>
                    <select
                      value={wsSecurity.usernameToken?.passwordType ?? 'PasswordText'}
                      onChange={(e) =>
                        updateUsernameToken({
                          passwordType: e.target.value as 'PasswordText' | 'PasswordDigest',
                        })
                      }
                      className={INPUT}
                    >
                      <option value="PasswordText">PasswordText</option>
                      <option value="PasswordDigest">PasswordDigest</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={wsSecurity.usernameToken?.nonce ?? false}
                        onChange={(e) => updateUsernameToken({ nonce: e.target.checked })}
                        className="accent-[var(--accent)]"
                      />
                      <span className="text-sm text-[var(--text)]">Include Nonce</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={wsSecurity.usernameToken?.created ?? false}
                        onChange={(e) => updateUsernameToken({ created: e.target.checked })}
                        className="accent-[var(--accent)]"
                      />
                      <span className="text-sm text-[var(--text)]">Include Created</span>
                    </label>
                  </div>
                </fieldset>
              )}

              {modes.includes('timestamp') && (
                <fieldset className="rounded border border-[var(--border)] p-3 space-y-2">
                  <legend className="px-1 text-xs font-medium text-[var(--accent-text)]">
                    Timestamp
                  </legend>
                  <div>
                    <span className="text-xs text-[var(--muted)]">TTL (seconds)</span>
                    <input
                      type="number"
                      min={1}
                      value={wsSecurity.timestamp?.ttlSeconds ?? 300}
                      onChange={(e) =>
                        updateTimestamp({
                          ttlSeconds: Math.max(1, parseInt(e.target.value, 10) || 300),
                        })
                      }
                      className={INPUT}
                    />
                  </div>
                </fieldset>
              )}

              {modes.includes('sign') && (
                <fieldset className="rounded border border-[var(--border)] p-3 space-y-2">
                  <legend className="px-1 text-xs font-medium text-[var(--accent-text)]">
                    Sign
                  </legend>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Algorithm</span>
                    <select
                      value={wsSecurity.sign?.algorithm ?? 'RSA-SHA256'}
                      onChange={(e) => updateSign({ algorithm: e.target.value as WsSignAlgorithm })}
                      className={INPUT}
                    >
                      {SIGN_ALGORITHMS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">KeyInfo Strategy</span>
                    <select
                      value={wsSecurity.sign?.keyInfoStrategy ?? 'BinarySecurityToken'}
                      onChange={(e) =>
                        updateSign({ keyInfoStrategy: e.target.value as WsKeyInfoStrategy })
                      }
                      className={INPUT}
                    >
                      {KEY_INFO_STRATEGIES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">References to sign</span>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {SIGN_REFERENCES.map((ref) => (
                        <label key={ref} className="flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            checked={(wsSecurity.sign?.references ?? ['Body']).includes(ref)}
                            onChange={(e) => toggleSignReference(ref, e.target.checked)}
                            className="accent-[var(--accent)]"
                          />
                          <span className="text-sm text-[var(--text)]">{ref}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Certificate (PEM)</span>
                    <textarea
                      value={wsSecurity.sign?.certPem ?? ''}
                      onChange={(e) => updateSign({ certPem: e.target.value })}
                      className={TEXTAREA}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                    />
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Private Key (PEM)</span>
                    <textarea
                      value={wsSecurity.sign?.privateKeyPem ?? ''}
                      onChange={(e) => updateSign({ privateKeyPem: e.target.value })}
                      className={TEXTAREA}
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
                    />
                  </div>
                </fieldset>
              )}

              {modes.includes('encrypt') && (
                <fieldset className="rounded border border-[var(--border)] p-3 space-y-2">
                  <legend className="px-1 text-xs font-medium text-[var(--accent-text)]">
                    Encrypt
                  </legend>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Algorithm</span>
                    <select
                      value={wsSecurity.encrypt?.algorithm ?? 'AES-256-CBC'}
                      onChange={(e) =>
                        updateEncrypt({ algorithm: e.target.value as WsEncryptAlgorithm })
                      }
                      className={INPUT}
                    >
                      {ENCRYPT_ALGORITHMS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Key Wrap</span>
                    <select
                      value={wsSecurity.encrypt?.keyWrap ?? 'RSA-OAEP'}
                      onChange={(e) =>
                        updateEncrypt({ keyWrap: e.target.value as WsKeyWrapAlgorithm })
                      }
                      className={INPUT}
                    >
                      {KEY_WRAP_ALGORITHMS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)]">Recipient Certificate (PEM)</span>
                    <textarea
                      value={wsSecurity.encrypt?.recipientCertPem ?? ''}
                      onChange={(e) => updateEncrypt({ recipientCertPem: e.target.value })}
                      className={TEXTAREA}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                    />
                  </div>
                </fieldset>
              )}

              {modes.includes('sign') && modes.includes('encrypt') && (
                <label className="flex cursor-pointer items-center gap-2 rounded border border-[var(--border)] px-3 py-2">
                  <input
                    type="checkbox"
                    checked={wsSecurity.signFirst !== false}
                    onChange={(e) => setWsSecurity({ signFirst: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm text-[var(--text)]">
                    Sign-then-encrypt (recommended)
                  </span>
                </label>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
