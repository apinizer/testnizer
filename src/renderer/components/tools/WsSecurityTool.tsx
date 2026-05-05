import { useEffect, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import {
  applyWsSecurity,
  verifySignature,
  decryptEnvelope,
  defaultUsernameToken,
  defaultTimestamp,
  defaultSignConfig,
  defaultEncryptConfig,
  buildSingleModeConfig,
} from '../../lib/tools/wsse'
import { consumeStagedWsseToolPayload, pushPayloadToActiveSoap } from '../../lib/tools-bridge'
import type {
  WsUsernameTokenConfig,
  WsTimestampConfig,
  WsSignConfig,
  WsEncryptConfig,
  WsSignAlgorithm,
  WsEncryptAlgorithm,
  WsKeyWrapAlgorithm,
  WsKeyInfoStrategy,
  WsSignReference,
} from '../../types'
import { useTranslation } from '../../lib/i18n'

type Mode = 'sign' | 'verify' | 'encrypt' | 'decrypt' | 'timestamp' | 'username-token'

const MODES: Mode[] = ['username-token', 'timestamp', 'sign', 'verify', 'encrypt', 'decrypt']

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

const SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <tns:Echo xmlns:tns="http://testnizer.com/echo">
      <tns:Message>Hello, WSSE</tns:Message>
    </tns:Echo>
  </soap:Body>
</soap:Envelope>`

const INPUT =
  'w-full rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]'
const TEXTAREA =
  'w-full min-h-[60px] rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]'

export default function WsSecurityTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('sign')
  const [input, setInput] = useState(SAMPLE_ENVELOPE)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [statusLine, setStatusLine] = useState<string | null>(null)

  const [usernameToken, setUsernameToken] = useState<WsUsernameTokenConfig>(defaultUsernameToken())
  const [timestamp, setTimestamp] = useState<WsTimestampConfig>(defaultTimestamp())
  const [sign, setSign] = useState<WsSignConfig>(defaultSignConfig())
  const [encrypt, setEncrypt] = useState<WsEncryptConfig>(defaultEncryptConfig())
  const [verifyCert, setVerifyCert] = useState('')
  const [decryptKey, setDecryptKey] = useState('')
  const [decryptPass, setDecryptPass] = useState('')

  useEffect(() => {
    const staged = consumeStagedWsseToolPayload()
    if (staged) setInput(staged)
  }, [])

  function handleSendToSoap() {
    const payload = output || input
    if (!payload) return
    const ok = pushPayloadToActiveSoap(payload)
    setStatusLine(ok ? 'Sent to active SOAP request' : 'No active SOAP request to send to')
  }

  async function handleRun() {
    setError(null)
    setStatusLine(null)
    try {
      if (mode === 'username-token') {
        const r = await applyWsSecurity(
          input,
          buildSingleModeConfig('username-token', { usernameToken }),
        )
        setOutput(r)
      } else if (mode === 'timestamp') {
        const r = await applyWsSecurity(input, buildSingleModeConfig('timestamp', { timestamp }))
        setOutput(r)
      } else if (mode === 'sign') {
        const r = await applyWsSecurity(input, buildSingleModeConfig('sign', { sign }))
        setOutput(r)
      } else if (mode === 'encrypt') {
        const r = await applyWsSecurity(input, buildSingleModeConfig('encrypt', { encrypt }))
        setOutput(r)
      } else if (mode === 'verify') {
        const r = await verifySignature(input, verifyCert)
        setOutput(JSON.stringify(r, null, 2))
        setStatusLine(
          r.valid
            ? `Signature is valid (${r.signedReferences.length} reference${r.signedReferences.length === 1 ? '' : 's'})`
            : `Signature INVALID${r.reason ? ' — ' + r.reason : ''}`,
        )
      } else if (mode === 'decrypt') {
        const r = await decryptEnvelope(input, decryptKey, decryptPass || undefined)
        setOutput(r)
      }
    } catch (e) {
      setOutput('')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleClear() {
    setInput('')
    setOutput('')
    setError(null)
    setStatusLine(null)
  }

  function loadSample() {
    setInput(SAMPLE_ENVELOPE)
  }

  const toolbar = (
    <>
      <button
        onClick={handleRun}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {modeLabel(mode, t)}
      </button>
      <button
        onClick={handleSendToSoap}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)' }}
      >
        Send to active SOAP
      </button>
      <button
        onClick={loadSample}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.loadSample')}
      </button>
      <button
        onClick={handleClear}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.clear')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.wsse.title')}
      toolbar={toolbar}
      footer={statusLine}
      inputPane={
        <div className="flex h-full flex-col">
          <div
            className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="rounded px-2.5 py-1 text-xs font-medium"
                style={{
                  background: mode === m ? 'var(--accent-light)' : 'transparent',
                  color: mode === m ? 'var(--accent-text)' : 'var(--muted)',
                }}
              >
                {modeLabel(m, t)}
              </button>
            ))}
          </div>

          <div
            className="grid shrink-0 grid-cols-1 gap-2 border-b px-3 py-2 text-[11px]"
            style={{ borderColor: 'var(--border)' }}
          >
            {mode === 'username-token' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className={INPUT}
                    placeholder="Username"
                    value={usernameToken.username}
                    onChange={(e) =>
                      setUsernameToken({ ...usernameToken, username: e.target.value })
                    }
                  />
                  <input
                    className={INPUT}
                    type="password"
                    placeholder="Password"
                    value={usernameToken.password}
                    onChange={(e) =>
                      setUsernameToken({ ...usernameToken, password: e.target.value })
                    }
                  />
                </div>
                <div className="flex items-center gap-3">
                  <select
                    className={INPUT}
                    value={usernameToken.passwordType}
                    onChange={(e) =>
                      setUsernameToken({
                        ...usernameToken,
                        passwordType: e.target.value as 'PasswordText' | 'PasswordDigest',
                      })
                    }
                  >
                    <option value="PasswordText">PasswordText</option>
                    <option value="PasswordDigest">PasswordDigest</option>
                  </select>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={usernameToken.nonce}
                      onChange={(e) =>
                        setUsernameToken({ ...usernameToken, nonce: e.target.checked })
                      }
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-[var(--text)]">Nonce</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={usernameToken.created}
                      onChange={(e) =>
                        setUsernameToken({ ...usernameToken, created: e.target.checked })
                      }
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-[var(--text)]">Created</span>
                  </label>
                </div>
              </>
            )}

            {mode === 'timestamp' && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--muted)]">TTL (s):</span>
                <input
                  className={INPUT}
                  type="number"
                  min={1}
                  value={timestamp.ttlSeconds}
                  onChange={(e) =>
                    setTimestamp({ ttlSeconds: Math.max(1, parseInt(e.target.value, 10) || 300) })
                  }
                />
              </div>
            )}

            {mode === 'sign' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={INPUT}
                    value={sign.algorithm}
                    onChange={(e) =>
                      setSign({ ...sign, algorithm: e.target.value as WsSignAlgorithm })
                    }
                  >
                    {SIGN_ALGORITHMS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select
                    className={INPUT}
                    value={sign.keyInfoStrategy}
                    onChange={(e) =>
                      setSign({ ...sign, keyInfoStrategy: e.target.value as WsKeyInfoStrategy })
                    }
                  >
                    {KEY_INFO_STRATEGIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SIGN_REFERENCES.map((ref) => (
                    <label key={ref} className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={sign.references.includes(ref)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? Array.from(new Set([...sign.references, ref]))
                            : sign.references.filter((r) => r !== ref)
                          setSign({ ...sign, references: next.length ? next : ['Body'] })
                        }}
                        className="accent-[var(--accent)]"
                      />
                      <span className="text-[var(--text)]">{ref}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  className={TEXTAREA}
                  placeholder="-----BEGIN CERTIFICATE-----..."
                  value={sign.certPem}
                  onChange={(e) => setSign({ ...sign, certPem: e.target.value })}
                />
                <textarea
                  className={TEXTAREA}
                  placeholder="-----BEGIN PRIVATE KEY-----..."
                  value={sign.privateKeyPem}
                  onChange={(e) => setSign({ ...sign, privateKeyPem: e.target.value })}
                />
              </>
            )}

            {mode === 'verify' && (
              <textarea
                className={TEXTAREA}
                placeholder="X.509 certificate (PEM) used to verify the signature"
                value={verifyCert}
                onChange={(e) => setVerifyCert(e.target.value)}
              />
            )}

            {mode === 'encrypt' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={INPUT}
                    value={encrypt.algorithm}
                    onChange={(e) =>
                      setEncrypt({ ...encrypt, algorithm: e.target.value as WsEncryptAlgorithm })
                    }
                  >
                    {ENCRYPT_ALGORITHMS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select
                    className={INPUT}
                    value={encrypt.keyWrap}
                    onChange={(e) =>
                      setEncrypt({ ...encrypt, keyWrap: e.target.value as WsKeyWrapAlgorithm })
                    }
                  >
                    {KEY_WRAP_ALGORITHMS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className={TEXTAREA}
                  placeholder="Recipient certificate (PEM)"
                  value={encrypt.recipientCertPem}
                  onChange={(e) => setEncrypt({ ...encrypt, recipientCertPem: e.target.value })}
                />
              </>
            )}

            {mode === 'decrypt' && (
              <>
                <textarea
                  className={TEXTAREA}
                  placeholder="-----BEGIN PRIVATE KEY-----..."
                  value={decryptKey}
                  onChange={(e) => setDecryptKey(e.target.value)}
                />
                <input
                  className={INPUT}
                  type="password"
                  placeholder="Passphrase (optional)"
                  value={decryptPass}
                  onChange={(e) => setDecryptPass(e.target.value)}
                />
              </>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <MonacoWrapper value={input} onChange={setInput} language="xml" />
          </div>
        </div>
      }
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : (
          <MonacoWrapper value={output} language={mode === 'verify' ? 'json' : 'xml'} readOnly />
        )
      }
    />
  )
}

function modeLabel(m: Mode, t: (key: string) => string): string {
  switch (m) {
    case 'username-token':
      return t('tools.wsse.usernameToken')
    case 'timestamp':
      return t('tools.wsse.timestamp')
    case 'sign':
      return t('tools.wsse.sign')
    case 'verify':
      return t('tools.wsse.verify')
    case 'encrypt':
      return t('tools.wsse.encrypt')
    case 'decrypt':
      return t('tools.wsse.decrypt')
  }
}
