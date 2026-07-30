import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useInvalidateOn } from '../../lib/use-stale-guard'
import type { TlsCertificateInfo, TlsInspectResult } from '../../types'
import ToolShell from './ToolShell'
import CertificateDetailDialog from './keystore/CertificateDetailDialog'
import RequestForm from './tls/RequestForm'
import ResultPane from './tls/ResultPane'
import AddTrustedDialog from './tls/AddTrustedDialog'
import {
  buildInspectRequest,
  emptyFormState,
  hasLegacySelection,
  toCertDetail,
  type TlsInspectFormState,
} from '../../lib/tools/tls-inspect'

export default function TlsInspectorTool() {
  const { t } = useTranslation()
  const [form, setForm] = useState<TlsInspectFormState>(emptyFormState)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TlsInspectResult | null>(null)
  const [lastHost, setLastHost] = useState('')
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [trustCert, setTrustCert] = useState<TlsCertificateInfo | null>(null)

  const patch = (p: Partial<TlsInspectFormState>): void => setForm((f) => ({ ...f, ...p }))
  const legacy = hasLegacySelection(form.minVersion, form.maxVersion)

  /*
   * Inspect a host, get its chain plus a green "Trusted", then type a different
   * host: the previous host's certificate and verdict used to stay on screen.
   * The footer showed the real host, so the screen contradicted itself — and for
   * a tool whose entire output is "should you trust this endpoint", showing the
   * answer for a DIFFERENT endpoint is the worst possible stale value.
   *
   * The form is user-only input (`inspect` writes `result`/`lastHost`), so the
   * effect cannot fight the tool's own writes.
   */
  useInvalidateOn([form], () => {
    setResult(null)
    setError(null)
    setDetailIndex(null)
    setTrustCert(null)
  })

  async function inspect(): Promise<void> {
    const built = buildInspectRequest(form)
    if (!built.ok) {
      setError(built.error)
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.tls.inspect(built.request)
      if (!r.success || !r.data) {
        setError(r.error ?? t('tools.tlsInspect.failed'))
        setResult(null)
      } else {
        setResult(r.data)
        setLastHost(built.request.host)
        setError(r.data.ok ? null : (r.data.error ?? null))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function pickFile(field: 'certPath' | 'keyPath' | 'pfxPath'): Promise<void> {
    const r = await window.api.dialog.openFile({
      title: t('tools.tlsInspect.fromFile'),
      filters: [
        { name: 'Certificates', extensions: ['crt', 'pem', 'cer', 'key', 'pfx', 'p12'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!r.success || !r.data) return
    const picked = Array.isArray(r.data) ? r.data[0] : r.data
    if (picked) patch({ clientCert: { ...form.clientCert, [field]: picked.filePath } })
  }

  const toolbar = (
    <>
      {result || error ? (
        <button
          onClick={() => {
            setResult(null)
            setError(null)
          }}
          className="rounded border px-2.5 py-1 text-[11px]"
          style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
        >
          {t('tools.common.clear')}
        </button>
      ) : null}
      <button
        onClick={() => void inspect()}
        disabled={loading}
        className="rounded px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {loading ? t('tools.tlsInspect.inspecting') : t('tools.tlsInspect.inspect')}
      </button>
    </>
  )

  return (
    <>
      <ToolShell
        title={t('tools.tlsInspect.title')}
        toolbar={toolbar}
        inputLabel={t('tools.tlsInspect.connection')}
        outputLabel={t('tools.tlsInspect.result')}
        inputPane={
          <RequestForm
            form={form}
            patch={patch}
            legacy={legacy}
            onPickFile={(f) => void pickFile(f)}
          />
        }
        outputPane={
          <ResultPane
            result={result}
            error={error}
            onOpenCert={(i) => setDetailIndex(i)}
            onAddTrusted={(c) => setTrustCert(c)}
          />
        }
      />

      {result && detailIndex !== null && (
        <CertificateDetailDialog
          detail={toCertDetail(result, lastHost)}
          initialIndex={detailIndex}
          onClose={() => setDetailIndex(null)}
        />
      )}

      {trustCert && (
        <AddTrustedDialog cert={trustCert} host={lastHost} onClose={() => setTrustCert(null)} />
      )}
    </>
  )
}

// ── request form (left pane) ─────────────────────────────────────────────────
