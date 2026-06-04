// src/renderer/components/eula/LegalDocModal.tsx
//
// Read-only modal that displays the EULA or Privacy Policy. Used from the
// About modal so users can review the legal documents without re-triggering
// the consent gate.

import { X } from 'lucide-react'
import eulaText from '../../../../docs/legal/eula.md?raw'
import privacyText from '../../../../docs/legal/privacy-policy.md?raw'
import LegalMarkdown from './LegalMarkdown'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'

interface Props {
  open: boolean
  doc: 'eula' | 'privacy' | null
  onClose: () => void
}

export default function LegalDocModal({ open, doc, onClose }: Props) {
  const { t } = useTranslation()

  if (!open || !doc) return null

  const text = doc === 'eula' ? eulaText : privacyText
  const title = doc === 'eula' ? t('about.eula') : t('about.privacyPolicy')

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <div
        className="flex w-[760px] flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', maxHeight: '85vh' }}
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
    </Modal>
  )
}
