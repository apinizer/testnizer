import { Terminal, X } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { curlWarningText } from '../../lib/curl-paste'
import type { CurlDialect, CurlWarning } from '../../../shared/curl/types'

const MAX_WARNINGS = 6

/**
 * The toast shown after a cURL command replaced the request (issue #278):
 * what happened, Undo, and what the parser could not carry over. A status
 * card, not a dialog — it never takes focus (`role="status"`).
 */
export default function CurlPasteToast({
  dialect,
  warnings,
  onUndo,
  onClose,
}: {
  dialect: CurlDialect
  warnings: CurlWarning[]
  onUndo: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="curl-paste-toast"
      data-dialect={dialect}
      className="flex w-[356px] max-w-full flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--white)] px-3.5 py-3 text-[var(--text)] shadow-[var(--shadow-drop)]"
    >
      <div className="flex items-start gap-2">
        <Terminal size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <span className="flex-1 text-sm font-medium">
          {t('curlPaste.applied').replace('{dialect}', t(`curlPaste.dialect.${dialect}`))}
        </span>
        <button
          type="button"
          data-testid="curl-paste-undo"
          onClick={onUndo}
          className="shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface)]"
        >
          {t('curlPaste.undo')}
        </button>
        <button
          type="button"
          data-testid="curl-paste-close"
          aria-label={t('curlPaste.dismiss')}
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded p-0.5 text-[var(--hint)] hover:text-[var(--text)]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {warnings.length > 0 && (
        <ul
          data-testid="curl-paste-warnings"
          aria-label={t('curlPaste.warningsLabel')}
          className="ml-[22px] list-disc space-y-0.5 pl-3 text-xs text-[var(--muted)] [overflow-wrap:anywhere]"
        >
          {warnings.slice(0, MAX_WARNINGS).map((w, i) => (
            <li key={`${w.code}-${i}`} data-testid="curl-paste-warning" data-code={w.code}>
              {curlWarningText(t, w)}
            </li>
          ))}
          {warnings.length > MAX_WARNINGS && (
            <li>
              {t('curlPaste.moreWarnings').replace(
                '{count}',
                String(warnings.length - MAX_WARNINGS),
              )}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
