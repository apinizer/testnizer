/**
 * "Critical request" switch (issue #304): a Run stops when this request does
 * not pass, whatever the run-level "Stop on error" says. One component for
 * every editor of a protocol the Runner runs — HTTP's Settings tab, SOAP's
 * Settings detail tab, GraphQL's Settings section and MCP's Settings panel —
 * all bound to the request store's per-tab `critical`, which Ctrl+S writes as
 * the row's top-level `critical` (`requestSettingsFor`).
 *
 * Same card + switch anatomy as the Follow redirects / SSL rows above it.
 */
import { useRequestStore } from '../../stores/request.store'
import { useTranslation } from '../../lib/i18n'

export default function CriticalRequestToggle() {
  const { t } = useTranslation()
  const critical = useRequestStore((s) => s.critical)
  const setCritical = useRequestStore((s) => s.setCritical)

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--white)] px-4 py-3">
      <div>
        <div className="font-medium text-[var(--text)]">{t('settingsTab.critical')}</div>
        <div className="text-[var(--muted)]">{t('settingsTab.criticalHelp')}</div>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={critical}
          onChange={(e) => setCritical(e.target.checked)}
          data-testid="settings-critical"
          aria-label={t('settingsTab.critical')}
          className="peer sr-only"
        />
        <div className="peer h-5 w-9 rounded-full bg-[var(--border2)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full" />
      </label>
    </div>
  )
}
