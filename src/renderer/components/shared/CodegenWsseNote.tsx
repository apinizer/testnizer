import { ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/**
 * Generate Code on a SOAP tab with WS-Security on (issue #298 follow-up):
 * Send adds the `wsse:Security` header to the envelope in main, per send —
 * fresh nonce / timestamp / signature — so a static snippet cannot carry it.
 * The snippet is the envelope Send hands to main; this note says what is
 * missing. Shared by the Generate Code modal and the right panel's Code pane.
 */
export default function CodegenWsseNote() {
  const { t } = useTranslation()
  return (
    <div
      role="note"
      data-testid="codegen-wsse-note"
      className="flex shrink-0 items-start gap-1.5 border-b border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)]"
    >
      <ShieldCheck size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{t('codeGen.wsseNote')}</span>
    </div>
  )
}
