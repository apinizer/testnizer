import { ShieldAlert } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { allowsHttpAuthServer } from '../../../stores/mcp-auth.slice'
import { useTranslation } from '../../../lib/i18n'

/**
 * Intranet opt-in of the OAuth 2.1 debugger (issue #170): lets token exchange
 * and refresh use a plain-HTTP token endpoint on the discovered authorization
 * server's host. Off by default; saved with the request (`auth.oauth2`), so
 * Ctrl+S keeps it. While on, a red warning says what crosses the wire in clear.
 */
export default function McpOAuthHttpOptIn({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const allow = useMcpStore((s) => allowsHttpAuthServer(s.auth))
  const setAllow = useMcpStore((s) => s.setOAuthAllowHttpAuthServer)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text)]">
        <button
          type="button"
          role="switch"
          aria-checked={allow}
          disabled={disabled}
          onClick={() => setAllow(!allow)}
          data-testid="mcp-oauth-allow-http"
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
            allow
              ? 'border-[var(--red)] bg-[var(--red)]'
              : 'border-[var(--border)] bg-[var(--input-bg)]'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full shadow transition-transform ${
              allow ? 'translate-x-[13px] bg-white' : 'translate-x-[1px] bg-[var(--muted)]'
            }`}
          />
        </button>
        {t('mcp.oauth.allowHttp')}
      </label>
      {allow && (
        <div
          role="alert"
          data-testid="mcp-oauth-allow-http-warning"
          className="flex items-start gap-2 rounded-md border border-[var(--red)] p-2.5 text-[12px] text-[var(--red)]"
        >
          <ShieldAlert size={14} className="mt-px shrink-0" />
          {t('mcp.oauth.allowHttpWarning')}
        </div>
      )}
    </div>
  )
}
