import { X, Download } from 'lucide-react'
import { useUpdaterStore } from '../../stores/updater.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'

/**
 * The non-blocking "update is ready" card (bottom-right), shown once a
 * BACKGROUND download finishes — the way Cursor and Postman surface a ready
 * update. It never covers the workspace and never steals the keyboard: the
 * user keeps working and picks one of
 *
 *   Restart & install   → quit + install right now
 *   Install on quit     → keep working; electron-updater applies it on exit
 *   Skip this version   → never offer this version in the background again
 *   ✕                   → same as "Install on quit"
 *
 * The manual flow (Settings → Check for Updates) keeps its own dialog;
 * `readyPromptOpen` is only ever set by useAutoUpdater.
 */
export default function UpdateReadyPrompt() {
  const open = useUpdaterStore((s) => s.readyPromptOpen)
  const version = useUpdaterStore((s) => s.version)
  const install = useUpdaterStore((s) => s.install)
  const installOnQuit = useUpdaterStore((s) => s.installOnQuit)
  const skipVersion = useUpdaterStore((s) => s.skipVersion)
  const setReadyPromptOpen = useUpdaterStore((s) => s.setReadyPromptOpen)
  const setShowUpdateModal = useUIStore((s) => s.setShowUpdateModal)
  const { t } = useTranslation()

  if (!open) return null
  const v = version ?? ''

  const later = (): void => {
    installOnQuit()
    toast.info(t('update.installOnQuitToast'))
  }
  const skip = (): void => {
    skipVersion()
    toast.info(t('update.skippedToast').replace('{version}', v))
  }
  const details = (): void => {
    setReadyPromptOpen(false)
    setShowUpdateModal(true)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="updater-notification"
      className="fixed right-4 bottom-10 z-[900] w-[360px] max-w-[calc(100vw-2rem)] rounded-[12px] border border-[var(--border)] bg-[var(--white)] p-4 text-[13px] text-[var(--text)]"
      style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 rounded-full bg-[var(--accent)]/10 p-2 text-[var(--accent)]">
          <Download size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t('update.readyTitle').replace('{version}', v)}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
            {t('update.readyBody')}
          </div>
        </div>
        <button
          type="button"
          aria-label={t('update.installOnQuit')}
          onClick={later}
          className="shrink-0 cursor-pointer rounded p-1 text-[var(--hint)] hover:text-[var(--text)]"
          style={{ background: 'transparent', border: 'none' }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={install}
          data-testid="updater-install-now"
          className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-3 py-1.5 font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('update.installNow')}
        </button>
        <button
          type="button"
          onClick={later}
          data-testid="updater-install-on-quit"
          className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
        >
          {t('update.installOnQuit')}
        </button>
        <button
          type="button"
          onClick={skip}
          data-testid="updater-skip-version"
          className="cursor-pointer rounded-[7px] border-none bg-transparent px-2 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          {t('update.skipVersion')}
        </button>
        <button
          type="button"
          onClick={details}
          className="ml-auto cursor-pointer rounded-[7px] border-none bg-transparent px-2 py-1.5 text-[var(--accent-text)] underline"
        >
          {t('update.details')}
        </button>
      </div>
    </div>
  )
}
