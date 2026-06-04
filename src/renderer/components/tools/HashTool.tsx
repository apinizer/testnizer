import { useEffect, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { hashAll, HASH_ALGORITHMS, type HashAlgorithm } from '../../lib/tools/hash'
import { useTranslation } from '../../lib/i18n'

export default function HashTool() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [hashes, setHashes] = useState<Partial<Record<HashAlgorithm, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recompute on input changes — debounced via microtask.
  useEffect(() => {
    let cancelled = false
    if (text === '') {
      setHashes({})
      return
    }
    setBusy(true)
    setError(null)
    hashAll(text)
      .then((h) => {
        if (!cancelled) setHashes(h)
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
  }, [text])

  const toolbar = (
    <button
      onClick={() => setText('')}
      className="rounded border px-2 py-1 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--muted)', background: 'var(--white)' }}
    >
      {t('tools.common.clear')}
    </button>
  )

  return (
    <ToolShell
      title={t('tools.hash.title')}
      toolbar={toolbar}
      inputLabel={t('tools.hash.message')}
      outputLabel={t('tools.hash.digests')}
      inputPane={<MonacoWrapper value={text} onChange={setText} language="plaintext" wordWrap />}
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : Object.keys(hashes).length === 0 ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.hash.hint')}
          </div>
        ) : (
          <div className="h-full overflow-auto p-3">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <th
                    className="border-b px-3 py-1.5 text-left font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)', width: 110 }}
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
                {HASH_ALGORITHMS.map((alg) => {
                  const v = hashes[alg] ?? ''
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
      footer={
        text ? (
          <span>
            {new Blob([text]).size} {t('tools.common.bytes')}
          </span>
        ) : null
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
