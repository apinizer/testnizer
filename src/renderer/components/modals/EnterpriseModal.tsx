import { useState } from 'react'
import { Building2, Copy, Check } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import Modal from '../shared/Modal'

const ENTERPRISE_EMAIL = 'info@testnizer.com'

export default function EnterpriseModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.showEnterpriseModal)
  const setOpen = useUIStore((s) => s.setShowEnterpriseModal)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ENTERPRISE_EMAIL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore — clipboard permission denied */
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => setOpen(v)}
      title={t('enterprise.title')}
      contentStyle={{ width: 420, background: 'var(--white)', borderRadius: 12 }}
    >
      <div style={{ padding: '24px 26px' }}>
        <div className="mb-4 flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-[8px]"
            style={{
              width: 36,
              height: 36,
              background: 'var(--accent-light)',
              color: 'var(--accent-text)',
            }}
          >
            <Building2 size={18} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {t('enterprise.title')}
          </span>
        </div>

        <p
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            lineHeight: 1.55,
            marginBottom: 18,
          }}
        >
          {t('enterprise.body')}
        </p>

        <div
          className="flex items-center justify-between rounded-[8px] border px-3 py-2"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            marginBottom: 16,
          }}
        >
          <a
            href={`mailto:${ENTERPRISE_EMAIL}`}
            style={{
              color: 'var(--accent-text)',
              fontWeight: 600,
              fontSize: 13.5,
              textDecoration: 'none',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {ENTERPRISE_EMAIL}
          </a>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? t('enterprise.copied') : t('enterprise.copy')}
            className="flex cursor-pointer items-center gap-1 rounded-[6px] border-none"
            style={{
              background: 'transparent',
              color: copied ? 'var(--green)' : 'var(--muted)',
              padding: '4px 8px',
              fontSize: 12,
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t('enterprise.copied') : t('enterprise.copy')}
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cursor-pointer rounded-[6px] border px-3 py-1.5"
            style={{
              background: 'var(--white)',
              borderColor: 'var(--border2)',
              color: 'var(--text)',
              fontSize: 13,
            }}
          >
            {t('enterprise.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
