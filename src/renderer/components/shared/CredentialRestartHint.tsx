import { useTranslation } from '../../lib/i18n'

/**
 * Issue #244: literal credentials are never written to the tab snapshot in
 * localStorage — a saved request reloads them from its row after a restart,
 * an unsaved draft loses them. One short line under the auth fields, styled
 * like the Socket.IO token hint (issue #243). `id` lets the secret inputs
 * point at it with `aria-describedby`.
 */
export default function CredentialRestartHint({ id, testId }: { id: string; testId: string }) {
  const { t } = useTranslation()
  return (
    <p id={id} data-testid={testId} className="m-0 mt-3 text-[11px] text-[var(--muted)]">
      {t('credentials.restartHint')}
    </p>
  )
}
