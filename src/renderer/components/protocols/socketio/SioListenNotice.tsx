import { Radio } from 'lucide-react'
import { useSocketIOStore } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'

/**
 * Above the timeline while nothing is listened to (issue #283): a new request
 * follows Postman — only listened events are received — so an empty Events
 * tab would show no server event at all. Says so, with the one-click way back
 * to "every event" (the pre-#283 default). `role="status"`, never steals focus.
 */
export default function SioListenNotice() {
  const { t } = useTranslation()
  const listenAll = useSocketIOStore((s) => s.listenAll)
  const listened = useSocketIOStore((s) => s.listeners.some((l) => l.listen && l.name.trim()))
  const setListenAll = useSocketIOStore((s) => s.setListenAll)
  if (listenAll || listened) return null
  return (
    <div
      role="status"
      data-testid="socketio-listen-notice"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--muted)]"
    >
      <Radio size={13} aria-hidden className="shrink-0 text-[var(--orange)]" />
      <span className="min-w-0 flex-1">{t('socketio.notListening')}</span>
      <button
        type="button"
        onClick={() => setListenAll(true)}
        data-testid="socketio-listen-all-inline"
        className="shrink-0 cursor-pointer rounded border border-[var(--border)] bg-[var(--white)] px-2 py-0.5 text-[11px] text-[var(--text)] hover:bg-[var(--bg)]"
      >
        {t('socketio.listenAll')}
      </button>
    </div>
  )
}
