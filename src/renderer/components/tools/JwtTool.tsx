import { useEffect, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import {
  decodeJwt,
  verifyJwt,
  isExpired,
  isNotYetValid,
  humanReadableClaims,
  JWT_ALGORITHMS,
  type JwtAlgorithm,
} from '../../lib/tools/jwt'
import { useTranslation } from '../../lib/i18n'

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjk5OTk5OTk5OTl9.qBObpSiVYeQ-cvB7g2SCiyGgIIw6dF7K_lZJK7nF8nM'

type Verification =
  | { state: 'idle' }
  | { state: 'verifying' }
  | { state: 'valid' }
  | { state: 'invalid'; reason: string }
  | { state: 'error'; message: string }

export default function JwtTool() {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const [secret, setSecret] = useState('')
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256')
  const [verifyEnabled, setVerifyEnabled] = useState(false)
  const [verification, setVerification] = useState<Verification>({ state: 'idle' })

  const decoded = token.trim() === '' ? null : decodeJwt(token)
  const decodeError = decoded && !decoded.ok ? decoded.error : null
  const jwt = decoded && decoded.ok ? decoded.jwt : null
  const claims = jwt ? humanReadableClaims(jwt.payload) : null
  const expired = jwt ? isExpired(jwt.payload) : false
  const notYet = jwt ? isNotYetValid(jwt.payload) : false

  useEffect(() => {
    if (!verifyEnabled || !jwt) {
      setVerification({ state: 'idle' })
      return
    }
    let cancelled = false
    setVerification({ state: 'verifying' })
    verifyJwt(token, secret, algorithm).then((r) => {
      if (cancelled) return
      if (!r.ok) {
        setVerification({ state: 'error', message: r.error })
      } else if (r.valid) {
        setVerification({ state: 'valid' })
      } else {
        setVerification({ state: 'invalid', reason: r.reason })
      }
    })
    return () => {
      cancelled = true
    }
  }, [token, secret, algorithm, verifyEnabled, jwt])

  const toolbar = (
    <>
      <button
        onClick={() => setToken(SAMPLE_JWT)}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.loadSample')}
      </button>
      <button
        onClick={() => {
          setToken('')
          setSecret('')
          setVerifyEnabled(false)
        }}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.clear')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.jwt.title')}
      toolbar={toolbar}
      inputLabel={t('tools.jwt.tokenInput')}
      outputLabel={t('tools.common.output')}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={token} onChange={setToken} language="plaintext" wordWrap />
          </div>
          <div
            className="shrink-0 border-t p-3 text-sm space-y-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={verifyEnabled}
                onChange={(e) => setVerifyEnabled(e.target.checked)}
              />
              <span style={{ color: 'var(--text)' }}>{t('tools.jwt.verify')}</span>
            </label>
            {verifyEnabled ? (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-xs" style={{ color: 'var(--muted)', minWidth: 80 }}>
                    {t('tools.jwt.algorithm')}
                  </label>
                  <select
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value as JwtAlgorithm)}
                    className="rounded border px-2 py-1 text-xs"
                    style={{
                      background: 'var(--white)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    {JWT_ALGORITHMS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>
                    {t('tools.jwt.secret')}
                  </label>
                  <textarea
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    rows={3}
                    placeholder={
                      algorithm.startsWith('HS')
                        ? 'shared secret'
                        : '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'
                    }
                    className="w-full rounded border px-2 py-1 font-mono text-xs"
                    style={{
                      background: 'var(--white)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      }
      outputPane={
        decodeError ? (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {decodeError}
          </div>
        ) : !jwt ? (
          <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
            Paste a JWT to decode.
          </div>
        ) : (
          <div className="h-full overflow-auto p-3 text-xs">
            <Section
              title={t('tools.jwt.headerLabel')}
              value={JSON.stringify(jwt.header, null, 2)}
              lang="json"
            />
            <Section
              title={t('tools.jwt.payloadLabel')}
              value={JSON.stringify(claims, null, 2)}
              lang="json"
            />
            <Section
              title={t('tools.jwt.signatureLabel')}
              value={jwt.signature || '(empty — alg=none)'}
              lang="plaintext"
            />
            <div className="mt-3 space-y-1">
              {expired ? <Badge color="#cc2200">{t('tools.jwt.expired')}</Badge> : null}
              {notYet ? <Badge color="#b35a00">{t('tools.jwt.notYetValid')}</Badge> : null}
              {verification.state === 'valid' ? (
                <Badge color="#1a7a4a">{t('tools.jwt.valid')}</Badge>
              ) : null}
              {verification.state === 'invalid' ? (
                <Badge color="#cc2200">
                  {t('tools.jwt.invalid')}: {verification.reason}
                </Badge>
              ) : null}
              {verification.state === 'error' ? (
                <Badge color="#cc2200">
                  {t('tools.common.error')}: {verification.message}
                </Badge>
              ) : null}
            </div>
          </div>
        )
      }
    />
  )
}

function Section({ title, value, lang }: { title: string; value: string; lang: string }) {
  return (
    <div className="mb-3">
      <div
        className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {title}
      </div>
      <pre
        className="m-0 rounded border p-2 font-mono text-xs whitespace-pre-wrap break-all"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {value}
      </pre>
      {void lang}
    </div>
  )
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div
      className="inline-block rounded px-2 py-0.5 text-[11px] font-medium mr-1.5"
      style={{ background: color + '15', color, border: `1px solid ${color}40` }}
    >
      {children}
    </div>
  )
}
