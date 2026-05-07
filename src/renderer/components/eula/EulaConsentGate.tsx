// src/renderer/components/eula/EulaConsentGate.tsx
//
// Blocking consent screen shown on first launch (and after the legal
// docs change — re-consent on hash mismatch).
//
//   - Refuses to render the app until `eula.state` reports
//     `consentValid === true`.
//   - "Accept and Continue" is disabled until the checkbox is ticked.
//   - "Decline and Quit" prompts for confirmation, then asks the main
//     process to `app.quit()`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, FileText, Shield, Check, X } from 'lucide-react'
import eulaText from '../../../../docs/legal/eula.md?raw'
import privacyText from '../../../../docs/legal/privacy-policy.md?raw'
import { useEulaStore } from '../../stores/eula.store'
import { useTranslation } from '../../lib/i18n'
import LegalMarkdown from './LegalMarkdown'
import appIcon from '../../assets/icon.png'

type DocTab = 'eula' | 'privacy'

interface Props {
  children: React.ReactNode
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--muted)' }}
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <div style={{ fontSize: 13 }}>{label}</div>
      </div>
    </div>
  )
}

export default function EulaConsentGate({ children }: Props) {
  const { t } = useTranslation()
  const loaded = useEulaStore((s) => s.loaded)
  const consentValid = useEulaStore((s) => s.consentValid)
  const refresh = useEulaStore((s) => s.refresh)
  const accept = useEulaStore((s) => s.accept)
  const decline = useEulaStore((s) => s.decline)

  const [agreed, setAgreed] = useState(false)
  const [tab, setTab] = useState<DocTab>('eula')
  const [submitting, setSubmitting] = useState(false)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const docText = useMemo(() => (tab === 'eula' ? eulaText : privacyText), [tab])

  const onAccept = useCallback(async () => {
    if (!agreed || submitting) return
    setSubmitting(true)
    setError(null)
    const res = await accept()
    setSubmitting(false)
    if (!res.success) setError(res.error ?? 'Failed to record consent')
  }, [agreed, submitting, accept])

  const onDeclineConfirmed = useCallback(async () => {
    setConfirmDecline(false)
    await decline()
  }, [decline])

  // While we're waiting for the very first IPC reply, show a bare loader —
  // never the app itself, to avoid flashing the workbench before the gate.
  if (!loaded) return <FullScreenLoader label="Loading…" />

  if (consentValid) return <>{children}</>

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--text)', padding: 24 }}
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{
          background: 'var(--white)',
          borderColor: 'var(--border)',
          maxWidth: 880,
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center gap-3 border-b px-6 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <img src={appIcon} alt="Testnizer" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <div className="flex flex-col">
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('eula.welcome')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('eula.intro')}</div>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0 gap-1 border-b px-4 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          {(
            [
              { key: 'eula', label: t('eula.tabEula'), icon: FileText },
              { key: 'privacy', label: t('eula.tabPrivacy'), icon: Shield },
            ] as { key: DocTab; label: string; icon: typeof FileText }[]
          ).map(({ key, label, icon: Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border-none px-3 py-1.5"
                style={{
                  background: active ? 'var(--accent-light)' : 'transparent',
                  color: active ? 'var(--accent-text)' : 'var(--text)',
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            )
          })}
        </div>

        {/* Body — scrollable markdown */}
        <div
          className="flex-1 overflow-auto px-6 py-4"
          style={{ background: 'var(--white)', minHeight: 280 }}
        >
          <LegalMarkdown text={docText} />
        </div>

        {/* Checkbox + actions */}
        <div
          className="flex shrink-0 flex-col gap-3 border-t px-6 py-4"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <label
            className="flex cursor-pointer items-start gap-2"
            style={{ fontSize: 13, color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{
                width: 16,
                height: 16,
                marginTop: 2,
                accentColor: 'var(--accent)',
                cursor: 'pointer',
              }}
              aria-label={t('eula.checkbox')}
            />
            <span>{t('eula.checkbox')}</span>
          </label>

          {error && <div style={{ fontSize: 12, color: 'var(--red, #cc2200)' }}>{error}</div>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDecline(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border px-4 py-2"
              style={{
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
                fontSize: 13,
              }}
              disabled={submitting}
            >
              <X size={14} />
              {t('eula.decline')}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={!agreed || submitting}
              className="flex items-center gap-1.5 rounded-md border-none px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                color: 'white',
                fontSize: 13,
                fontWeight: 600,
                cursor: !agreed || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {t('eula.accept')}
            </button>
          </div>
        </div>
      </div>

      {confirmDecline && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setConfirmDecline(false)}
        >
          <div
            className="flex w-[400px] flex-col gap-3 rounded-xl border p-5 shadow-xl"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t('eula.decline')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('eula.declineConfirm')}</div>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDecline(false)}
                className="cursor-pointer rounded-md border px-3 py-1.5"
                style={{
                  background: 'var(--white)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                  fontSize: 13,
                }}
              >
                {t('eula.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void onDeclineConfirmed()}
                className="cursor-pointer rounded-md border-none px-3 py-1.5"
                style={{
                  background: 'var(--red, #cc2200)',
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {t('eula.declineQuit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
