import { X, Loader2, CheckCircle2, AlertCircle, Download } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useUpdaterStore } from '../../stores/updater.store'
import { useTranslation } from '../../lib/i18n'

export default function UpdateModal() {
  const show = useUIStore((s) => s.showUpdateModal)
  const setShow = useUIStore((s) => s.setShowUpdateModal)
  const { t } = useTranslation()

  const status = useUpdaterStore((s) => s.status)
  const version = useUpdaterStore((s) => s.version)
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes)
  const downloadPercent = useUpdaterStore((s) => s.downloadPercent)
  const errorMessage = useUpdaterStore((s) => s.errorMessage)
  const check = useUpdaterStore((s) => s.check)
  const download = useUpdaterStore((s) => s.download)
  const install = useUpdaterStore((s) => s.install)

  if (!show) return null

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.28)' }}
      onClick={() => setShow(false)}
    >
      <div
        className="w-[440px] max-w-[95%] rounded-[14px] bg-[var(--white)] p-7"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <span className="text-lg font-bold text-[var(--text)]">
            {t('settings.autoUpdate')}
          </span>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="cursor-pointer text-[var(--hint)] hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-center gap-4 py-4">
          <StatusContent
            status={status}
            version={version}
            releaseNotes={releaseNotes}
            downloadPercent={downloadPercent}
            errorMessage={errorMessage}
            t={t}
          />
        </div>

        {/* Actions */}
        <div className="mt-4 flex justify-center gap-2.5">
          <UpdateActions
            status={status}
            onCheck={check}
            onDownload={download}
            onInstall={install}
            onClose={() => setShow(false)}
            t={t}
          />
        </div>
      </div>
    </div>
  )
}

function StatusContent({
  status,
  version,
  releaseNotes,
  downloadPercent,
  errorMessage,
  t,
}: {
  status: string
  version: string | null
  releaseNotes: string | null
  downloadPercent: number
  errorMessage: string | null
  t: (key: string) => string
}) {
  switch (status) {
    case 'checking':
      return (
        <>
          <Loader2 size={32} className="animate-spin text-[var(--accent)]" />
          <span className="text-[var(--muted)]">{t('update.checking')}</span>
        </>
      )
    case 'available':
      return (
        <>
          <Download size={32} className="text-[var(--accent)]" />
          <span className="font-medium text-[var(--text)]">
            {t('update.available')}: v{version}
          </span>
          {releaseNotes && (
            <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-1 font-medium text-[var(--muted)]">
                {t('update.releaseNotes')}
              </div>
              <div className="max-h-24 overflow-y-auto text-[var(--text)]">
                {releaseNotes}
              </div>
            </div>
          )}
        </>
      )
    case 'downloading':
      return (
        <>
          <span className="text-[var(--muted)]">
            {t('update.downloading')} {Math.round(downloadPercent)}%
          </span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${downloadPercent}%` }}
            />
          </div>
        </>
      )
    case 'ready':
      return (
        <>
          <CheckCircle2 size={32} className="text-[var(--green)]" />
          <span className="font-medium text-[var(--text)]">
            {t('update.ready')}
          </span>
        </>
      )
    case 'error':
      return (
        <>
          <AlertCircle size={32} className="text-[#cc2200]" />
          <span className="font-medium text-[#cc2200]">
            {t('update.error')}
          </span>
          {errorMessage && (
            <span className="text-[var(--muted)]">{errorMessage}</span>
          )}
        </>
      )
    default:
      return (
        <>
          <CheckCircle2 size={32} className="text-[var(--green)]" />
          <span className="text-[var(--muted)]">{t('update.upToDate')}</span>
        </>
      )
  }
}

function UpdateActions({
  status,
  onCheck,
  onDownload,
  onInstall,
  onClose,
  t,
}: {
  status: string
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
  onClose: () => void
  t: (key: string) => string
}) {
  switch (status) {
    case 'checking':
    case 'downloading':
      return null
    case 'available':
      return (
        <button
          type="button"
          onClick={onDownload}
          className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-colors hover:opacity-90"
        >
          {t('update.download')}
        </button>
      )
    case 'ready':
      return (
        <>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[#555] transition-colors hover:bg-[var(--bg)]"
          >
            {t('update.later')}
          </button>
          <button
            type="button"
            onClick={onInstall}
            className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-colors hover:opacity-90"
          >
            {t('update.restartNow')}
          </button>
        </>
      )
    case 'error':
      return (
        <button
          type="button"
          onClick={onCheck}
          className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-colors hover:opacity-90"
        >
          {t('update.retry')}
        </button>
      )
    default:
      return (
        <button
          type="button"
          onClick={onCheck}
          className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-colors hover:opacity-90"
        >
          {t('settings.checkForUpdates')}
        </button>
      )
  }
}
