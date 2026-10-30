import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import type { McpOAuthConfirmation } from '../../../types/mcp'

function HostRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <code data-testid={testId} className="min-w-0 break-all font-mono text-[var(--text)]">
        {value}
      </code>
    </div>
  )
}

/**
 * Issue #295 — the OAuth debugger asks before a client secret the user typed
 * goes to an authorization server the MCP server advertised on another host.
 * Sibling of the AI Chat stdio trust card: orange border, the hosts in full,
 * an explicit confirm and a cancel that stops the flow. The answer is kept in
 * main memory for this server and host until the app closes.
 */
export default function McpOAuthConfirmCard({
  confirmation,
}: {
  confirmation: McpOAuthConfirmation
}) {
  const { t } = useTranslation()
  const answer = useMcpStore((s) => s.answerOAuthConfirmation)
  const [sent, setSent] = useState(false)
  const reply = (accept: boolean): void => {
    setSent(true)
    void answer(accept).finally(() => setSent(false))
  }

  return (
    <div
      role="alert"
      data-testid="mcp-oauth-confirm"
      className="flex flex-col gap-2 rounded-md border border-[var(--orange)] bg-[var(--surface)] px-3 py-2 text-[12px]"
    >
      <div className="flex items-center gap-1.5 font-medium text-[var(--orange)]">
        <ShieldAlert size={13} className="shrink-0" />
        {t('mcp.oauth.confirm.title')}
      </div>
      <p className="m-0 text-[var(--muted)]">{t('mcp.oauth.confirm.hint')}</p>
      <div className="flex flex-col gap-1 rounded bg-[var(--bg)] p-2">
        <HostRow
          label={t('mcp.oauth.confirm.mcpServer')}
          value={confirmation.mcpServer}
          testId="mcp-oauth-confirm-server"
        />
        <HostRow
          label={t('mcp.oauth.confirm.authServer')}
          value={confirmation.authorizationServer}
          testId="mcp-oauth-confirm-auth-server"
        />
        {confirmation.tokenEndpoint !== confirmation.authorizationServer && (
          <HostRow
            label={t('mcp.oauth.confirm.tokenEndpoint')}
            value={confirmation.tokenEndpoint}
            testId="mcp-oauth-confirm-token-endpoint"
          />
        )}
      </div>
      <p className="m-0 text-[var(--muted)]">{t('mcp.oauth.confirm.remembered')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reply(true)}
          disabled={sent}
          data-testid="mcp-oauth-confirm-accept"
          className="cursor-pointer rounded-md border-none bg-[var(--orange)] px-3 py-1 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('mcp.oauth.confirm.accept')}
        </button>
        <button
          type="button"
          onClick={() => reply(false)}
          disabled={sent}
          data-testid="mcp-oauth-confirm-reject"
          className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1 text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('mcp.oauth.confirm.reject')}
        </button>
      </div>
    </div>
  )
}
