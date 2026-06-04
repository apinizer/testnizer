import { useState, type ReactNode } from 'react'
import { X, FileText, Loader2 } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'

interface ImportTestSuiteModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  onImported: () => void
}

// Auto-detect in `save.handler.detectTestSuiteImportFormat` covers all three —
// the format id here is only used to decorate the card. Adding a new format
// is one more entry in this array; the picker handles the file dialog the
// same way for each.
type SuiteFormatId = 'testnizer' | 'postman' | 'insomnia'

interface SuiteFormat {
  id: SuiteFormatId
  titleKey: string
  hintKey: string
  icon: ReactNode
  iconBg: string
}

const SUITE_FORMATS: readonly SuiteFormat[] = [
  {
    id: 'testnizer',
    titleKey: 'tests.importSuiteFormatTestnizer',
    hintKey: 'tests.importSuiteFormatTestnizerHint',
    icon: <FileText size={18} style={{ color: '#1565c0' }} />,
    iconBg: '#e8f4ff',
  },
  {
    id: 'postman',
    titleKey: 'tests.importSuiteFormatPostman',
    hintKey: 'tests.importSuiteFormatPostmanHint',
    icon: <span style={{ fontSize: 18 }}>{'🟠'}</span>,
    iconBg: '#fff0ec',
  },
  {
    id: 'insomnia',
    titleKey: 'tests.importSuiteFormatInsomnia',
    hintKey: 'tests.importSuiteFormatInsomniaHint',
    icon: <span style={{ fontSize: 18 }}>{'🟣'}</span>,
    iconBg: '#faf0ff',
  },
]

export default function ImportTestSuiteModal({
  open,
  onClose,
  projectId,
  onImported,
}: ImportTestSuiteModalProps) {
  const { t } = useTranslation()
  const [busyFormat, setBusyFormat] = useState<SuiteFormatId | null>(null)

  async function handlePick(format: SuiteFormatId): Promise<void> {
    if (busyFormat) return
    setBusyFormat(format)
    try {
      const result = await window.api?.save?.importTestSuite?.({ projectId })
      if (result?.success) {
        toast.success(t('tests.importSuiteSuccess'))
        onImported()
        onClose()
      } else if (result?.error && result.error !== 'Cancelled') {
        toast.error(`${t('tests.importSuiteFailed')}: ${result.error}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`${t('tests.importSuiteFailed')}: ${message}`)
    } finally {
      setBusyFormat(null)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !busyFormat) onClose()
      }}
      title={t('tests.importSuiteModalTitle')}
      preventClose={!!busyFormat}
    >
      <div
        className="w-[520px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--white)]"
        style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            {t('tests.importSuiteModalTitle')}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!busyFormat) onClose()
            }}
            disabled={!!busyFormat}
            className="cursor-pointer border-none bg-transparent p-1 text-[var(--hint)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            {t('tests.importSuiteModalDescription')}
          </p>

          <div className="flex flex-col gap-2">
            {SUITE_FORMATS.map((fmt) => {
              const busy = busyFormat === fmt.id
              return (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => handlePick(fmt.id)}
                  disabled={!!busyFormat}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3.5 py-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-light)] disabled:cursor-default disabled:opacity-60 disabled:hover:border-[var(--border)] disabled:hover:bg-[var(--white)]"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: fmt.iconBg }}
                  >
                    {fmt.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {t(fmt.titleKey)}
                    </div>
                    <div
                      className="truncate"
                      style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}
                    >
                      {t(fmt.hintKey)}
                    </div>
                  </div>
                  <span
                    className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5"
                    style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}
                  >
                    {busy ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        {t('tests.importSuiteImporting')}
                      </>
                    ) : (
                      t('tests.importSuiteChooseFile')
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
