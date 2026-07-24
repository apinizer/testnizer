import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { KeystoreAliasDetail, KeystoreCertificateInfo } from '../../../types'

export default function CertificateDetailDialog({
  detail,
  onClose,
}: {
  detail: KeystoreAliasDetail
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const cert: KeystoreCertificateInfo | undefined = detail.chain[index]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-xl"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
            {t('tools.keystore.detailTitle')} · {detail.alias}
          </h3>
          <button
            onClick={onClose}
            className="text-sm"
            style={{ color: 'var(--muted)' }}
            title={t('tools.keystore.close')}
          >
            ✕
          </button>
        </div>

        {detail.chain.length > 1 && (
          <div
            className="flex shrink-0 gap-1 border-b px-4 py-2"
            style={{ borderColor: 'var(--border)' }}
          >
            {detail.chain.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className="rounded px-2 py-0.5 text-[11px]"
                style={{
                  background: i === index ? 'var(--accentLight)' : 'var(--white)',
                  border: '1px solid',
                  borderColor: i === index ? 'var(--accentText)' : 'var(--border)',
                  color: 'var(--text)',
                }}
              >
                {i === 0 ? t('tools.keystore.leaf') : `${t('tools.keystore.chain')} ${i}`}
              </button>
            ))}
          </div>
        )}

        {cert && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {cert.subjectDN === cert.issuerDN && (
              <span
                className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: '#e8f9f1', color: '#1a7a4a' }}
              >
                {t('tools.keystore.selfSigned')}
              </span>
            )}
            <Field label={t('tools.keystore.subject')} value={cert.subjectDN} />
            <Field label={t('tools.keystore.issuer')} value={cert.issuerDN} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('tools.keystore.serial')} value={cert.serialNumber} mono />
              <Field label={t('tools.keystore.version')} value={`v${cert.version}`} />
              <Field label={t('tools.keystore.sigAlg')} value={cert.sigAlgName} />
              <Field label={t('tools.keystore.publicKeyAlg')} value={cert.publicKeyAlgorithm} />
              <Field
                label={t('tools.keystore.keySize')}
                value={`${cert.keySize} ${t('tools.keystore.bits')}`}
              />
              <Field label={t('tools.keystore.validFrom')} value={fmt(cert.notBefore)} />
              <Field label={t('tools.keystore.validTo')} value={fmt(cert.notAfter)} />
            </div>
            <Field label={t('tools.keystore.sha1')} value={cert.sha1Fingerprint} mono />
            <Field label={t('tools.keystore.sha256')} value={cert.sha256Fingerprint} mono />
            {cert.subjectAlternativeNames.length > 0 && (
              <Field
                label={t('tools.keystore.san')}
                value={cert.subjectAlternativeNames.join(', ')}
              />
            )}
            <PemBlock pem={cert.pem} />
          </div>
        )}
      </div>
    </div>
  )
}

function fmt(iso: string): string {
  const ts = Date.parse(iso)
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString()
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
      <div
        className={`break-all text-xs ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  )
}

function PemBlock({ pem }: { pem: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <span
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {t('tools.keystore.pem')}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(pem).then(
              () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              },
              () => {},
            )
          }}
          className="rounded border px-2 py-0.5 text-[11px]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--white)',
            color: 'var(--accentText)',
          }}
        >
          {copied ? t('tools.keystore.copied') : t('tools.keystore.copy')}
        </button>
      </div>
      <pre
        className="max-h-48 overflow-auto rounded p-2 font-mono text-[11px]"
        style={{ background: 'var(--surface)', color: 'var(--text)' }}
      >
        {pem}
      </pre>
    </div>
  )
}
