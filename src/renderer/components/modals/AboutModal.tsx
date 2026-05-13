import { useCallback, useEffect, useState } from 'react'
import { X, ExternalLink, FileText, Shield, Building2 } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useEulaStore } from '../../stores/eula.store'
import { useTranslation } from '../../lib/i18n'
import LegalDocModal from '../eula/LegalDocModal'
import Modal from '../shared/Modal'
import appIcon from '../../assets/icon.png'

interface LicenseEntry {
  name: string
  version: string
  license: string
}
interface LicenseManifest {
  generatedAt: string
  count: number
  entries: LicenseEntry[]
}
interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

const HOMEPAGE_URL = 'https://apinizer.com'

export default function AboutModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.showAboutModal)
  const setOpen = useUIStore((s) => s.setShowAboutModal)

  const [version, setVersion] = useState<string>('')
  const [licenses, setLicenses] = useState<LicenseEntry[] | null>(null)
  const [licensesError, setLicensesError] = useState<string | null>(null)
  const [legalDoc, setLegalDoc] = useState<'eula' | 'privacy' | null>(null)
  const consentState = useEulaStore((s) => s.state)
  const consentValid = useEulaStore((s) => s.consentValid)

  // Load version + licenses on open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const v = (await window.api?.app?.version?.()) as IpcResult<{ version: string }> | undefined
        if (!cancelled && v?.success && v.data?.version) setVersion(v.data.version)
      } catch {
        /* noop */
      }
      try {
        const r = (await window.api?.diagnostics?.thirdPartyLicenses?.()) as
          | IpcResult<LicenseManifest>
          | undefined
        if (cancelled) return
        if (r?.success && r.data?.entries) {
          setLicenses(r.data.entries)
          setLicensesError(null)
        } else {
          setLicenses([])
          setLicensesError(r?.error ?? t('about.licensesError'))
        }
      } catch (e) {
        if (!cancelled) {
          setLicenses([])
          setLicensesError((e as Error).message)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, t])

  const openExternal = useCallback((url: string) => {
    void window.api?.app?.openExternal?.(url)
  }, [])

  if (!open) return null

  const legalBtnStyle: React.CSSProperties = {
    borderColor: 'var(--border)',
    background: 'var(--white)',
    color: 'var(--text)',
    fontSize: 13,
  }

  return (
    <Modal open={open} onOpenChange={setOpen} title={t('about.title')}>
      <div
        className="flex w-[560px] flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>
            {t('about.title')}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
            style={{ color: 'var(--muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {/* Brand */}
          <div className="flex flex-col items-center gap-2 px-5 py-6">
            <img
              src={appIcon}
              alt="Testnizer"
              style={{ width: 64, height: 64, borderRadius: 14 }}
            />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Testnizer</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {t('about.version')} {version || '—'}
            </div>
            <button
              type="button"
              onClick={() => openExternal(HOMEPAGE_URL)}
              className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent"
              style={{ color: 'var(--accent-text)', fontSize: 13 }}
            >
              <ExternalLink size={13} />
              {t('about.homepage')}
            </button>
          </div>

          {/* Legal */}
          <div
            className="flex flex-col gap-2 border-t px-5 py-3"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLegalDoc('privacy')}
                className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-1.5"
                style={legalBtnStyle}
              >
                <Shield size={13} /> {t('about.privacyPolicy')}
              </button>
              <button
                type="button"
                onClick={() => setLegalDoc('eula')}
                className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-1.5"
                style={legalBtnStyle}
              >
                <FileText size={13} /> {t('about.eula')}
              </button>
            </div>
            {consentValid && consentState.acceptedAt > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {t('about.consentAccepted')
                  .replace('{date}', new Date(consentState.acceptedAt).toLocaleDateString())
                  .replace('{version}', consentState.acceptedVersion || '—')}
              </div>
            )}
          </div>

          {/* Enterprise support */}
          <div
            className="flex flex-col gap-1.5 border-t px-5 py-3"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-center gap-1.5"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
            >
              <Building2 size={13} /> {t('about.enterpriseTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              {t('about.enterpriseBody')}
            </div>
            <button
              type="button"
              onClick={() => openExternal(`mailto:${t('about.enterpriseContact')}`)}
              className="flex cursor-pointer items-center gap-1.5 self-start rounded-md border-none bg-transparent p-0"
              style={{ color: 'var(--accent-text)', fontSize: 13 }}
            >
              <ExternalLink size={13} /> {t('about.enterpriseContact')}
            </button>
          </div>

          {/* Licenses */}
          <div className="border-t" style={{ borderColor: 'var(--border)' }}>
            <div
              className="flex items-center justify-between px-5 py-2.5"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {t('about.thirdPartyLicenses')}
              </span>
              {licenses && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t('about.licensesCount').replace('{count}', String(licenses.length))}
                </span>
              )}
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {licenses === null && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '14px 20px' }}>
                  {t('about.licensesLoading')}
                </div>
              )}
              {licenses && licenses.length === 0 && licensesError && (
                <div style={{ fontSize: 13, color: 'var(--red, #cc2200)', padding: '14px 20px' }}>
                  {licensesError}
                </div>
              )}
              {licenses && licenses.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {licenses.map((l) => (
                    <li
                      key={`${l.name}@${l.version}`}
                      className="flex items-center justify-between px-5 py-1.5"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <span
                        className="truncate"
                        style={{ fontSize: 13, color: 'var(--text)', marginRight: 12 }}
                      >
                        {l.name}
                        <span style={{ color: 'var(--muted)' }}>@{l.version}</span>
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--accent-text)',
                          flexShrink: 0,
                          fontFamily: 'var(--font-mono, monospace)',
                        }}
                      >
                        {l.license || 'UNKNOWN'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      <LegalDocModal open={legalDoc !== null} doc={legalDoc} onClose={() => setLegalDoc(null)} />
    </Modal>
  )
}
