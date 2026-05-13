import { useEffect, useId, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { hmacAll, HMAC_ALGORITHMS, type HmacAlgorithm } from '../../lib/tools/hash'
import { useTranslation } from '../../lib/i18n'

export default function HmacTool() {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')
  const [secret, setSecret] = useState('')
  const [hmacs, setHmacs] = useState<Partial<Record<HmacAlgorithm, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const secretId = useId()

  useEffect(() => {
    let cancelled = false
    if (message === '' || secret === '') {
      setHmacs({})
      return
    }
    setBusy(true)
    setError(null)
    hmacAll(message, secret)
      .then((h) => {
        if (!cancelled) setHmacs(h)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [message, secret])

  const toolbar = (
    <button
      onClick={() => {
        setMessage('')
        setSecret('')
      }}
      className="rounded border px-2 py-1 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--muted)', background: 'var(--white)' }}
    >
      {t('tools.common.clear')}
    </button>
  )

  return (
    <ToolShell
      title={t('tools.hmac.title')}
      toolbar={toolbar}
      inputLabel={t('tools.hmac.message')}
      outputLabel={t('tools.hmac.digests')}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={message} onChange={setMessage} language="plaintext" wordWrap />
          </div>
          <div
            className="shrink-0 border-t p-3"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <label
              htmlFor={secretId}
              className="mb-1 block text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.hmac.secret')}
            </label>
            <input
              id={secretId}
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="secret key"
              className="w-full rounded border px-2 py-1 font-mono text-xs"
              style={{
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
          </div>
        </div>
      }
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : Object.keys(hmacs).length === 0 ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.hmac.hint')}
          </div>
        ) : (
          <div className="h-full overflow-auto p-3">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <th
                    className="border-b px-3 py-1.5 text-left font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)', width: 130 }}
                  >
                    Algorithm
                  </th>
                  <th
                    className="border-b px-3 py-1.5 text-left font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Hex digest
                  </th>
                  <th
                    className="border-b px-3 py-1.5 text-left font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)', width: 60 }}
                  >
                    {t('tools.common.copy')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {HMAC_ALGORITHMS.map((alg) => {
                  const v = hmacs[alg] ?? ''
                  return (
                    <tr key={alg}>
                      <td
                        className="border-b px-3 py-1.5 align-top font-mono font-semibold"
                        style={{ borderColor: 'var(--border)', color: 'var(--accentText)' }}
                      >
                        {alg}
                      </td>
                      <td
                        className="border-b px-3 py-1.5 align-top font-mono break-all"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        {busy && !v ? '…' : v}
                      </td>
                      <td
                        className="border-b px-3 py-1.5 align-top"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <CopyButton text={v} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }
    />
  )
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={copied ? t('tools.common.copied') : t('tools.common.copy')}
      className="rounded border px-1.5 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border)',
        color: copied ? '#1a7a4a' : 'var(--muted)',
        background: 'var(--white)',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}
