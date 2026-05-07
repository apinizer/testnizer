// src/renderer/components/eula/LegalDocModal.tsx
//
// Read-only modal that displays the EULA or Privacy Policy. Used from the
// About modal so users can review the legal documents without re-triggering
// the consent gate.

import { useEffect } from 'react'
import { X } from 'lucide-react'
import eulaText from '../../../../docs/legal/eula.md?raw'
import privacyText from '../../../../docs/legal/privacy-policy.md?raw'
import LegalMarkdown from './LegalMarkdown'
import { useTranslation } from '../../lib/i18n'

interface Props {
  open: boolean
  doc: 'eula' | 'privacy' | null
  onClose: () => void
}

export default function LegalDocModal({ open, doc, onClose }: Props) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !doc) return null

  const text = doc === 'eula' ? eulaText : privacyText
  const title = doc === 'eula' ? t('about.eula') : t('about.privacyPolicy')

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="flex w-[760px] flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
            style={{ color: 'var(--muted)' }}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <LegalMarkdown text={text} />
        </div>
      </div>
    </div>
  )
}
