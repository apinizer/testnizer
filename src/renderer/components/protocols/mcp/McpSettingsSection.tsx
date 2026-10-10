import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { MCP_DEFAULT_TIMEOUT_MS } from '../../../../shared/request-settings'

/**
 * Settings panel of the MCP config tab strip (issue #185): the call timeout,
 * with the HTTP Settings tab's semantics — empty = the shared default
 * (`MCP_DEFAULT_TIMEOUT_MS`, the same one Run uses), `0` = no limit, `>0` =
 * explicit ms. Editing marks the tab dirty; Ctrl+S saves it as the row's
 * top-level `timeout`.
 */
export default function McpSettingsSection() {
  const { t } = useTranslation()
  const requestTimeout = useMcpStore((s) => s.requestTimeout)
  const setRequestTimeout = useMcpStore((s) => s.setRequestTimeout)
  const seconds = String(MCP_DEFAULT_TIMEOUT_MS / 1000)

  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <label htmlFor="mcp-settings-timeout" className="font-medium text-[var(--text)]">
        {t('mcp.settings.timeout')}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="mcp-settings-timeout"
          type="number"
          min={0}
          value={requestTimeout ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim()
            setRequestTimeout(raw === '' ? null : Number(raw))
          }}
          placeholder={t('mcp.settings.timeoutPlaceholder')}
          data-testid="mcp-settings-timeout"
          className="w-28 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 text-[var(--text)] outline-none"
        />
        <span className="text-[var(--muted)]">
          {t('mcp.settings.timeoutUnit').replace('{seconds}', seconds)}
        </span>
      </div>
      <p className="m-0 text-[11px] text-[var(--muted)]">{t('mcp.settings.timeoutHint')}</p>
    </div>
  )
}
