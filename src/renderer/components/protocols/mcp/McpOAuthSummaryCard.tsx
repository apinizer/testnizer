import { KeyRound, Plug, Trash2 } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import type { McpOAuthSummary } from '../../../types/mcp'
import { GhostButton, PrimaryButton } from './ui'

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd data-testid={testId} className="m-0 min-w-0 break-all font-mono text-[var(--text)]">
        {value}
      </dd>
    </>
  )
}

/**
 * Result of a successful OAuth flow (issue #141): metadata only — the token
 * itself never leaves the main process. "Connect with token" points the tab
 * at this token session and (re)connects.
 */
export default function McpOAuthSummaryCard({ summary }: { summary: McpOAuthSummary }) {
  const { t } = useTranslation()
  const inUse = useMcpStore((s) => !!s.oauthFlowId && s.oauthSessionId === s.oauthFlowId)
  const connected = useMcpStore((s) => s.connectionState === 'connected')
  const connectWithOAuth = useMcpStore((s) => s.connectWithOAuth)
  const forgetOAuth = useMcpStore((s) => s.forgetOAuth)
  const expires = summary.expiresAt
    ? new Date(summary.expiresAt).toLocaleString()
    : t('mcp.oauth.summary.never')

  return (
    <div
      data-testid="mcp-oauth-summary"
      className="flex flex-col gap-2.5 rounded-lg border border-[var(--green-border)] bg-[var(--green-bg)] p-3"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
        <KeyRound size={14} className="text-[var(--green)]" />
        {t('mcp.oauth.summary.title')}
        {inUse && (
          <span className="rounded bg-[var(--white)] px-1.5 text-[10px] font-medium text-[var(--green)]">
            {t('mcp.oauth.summary.inUse')}
          </span>
        )}
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <Row label={t('mcp.oauth.summary.issuer')} value={summary.issuer} />
        <Row
          label={t('mcp.oauth.summary.clientId')}
          value={summary.clientId}
          testId="mcp-oauth-summary-client-id"
        />
        <Row label={t('mcp.oauth.summary.tokenType')} value={summary.tokenType} />
        <Row label={t('mcp.oauth.summary.expires')} value={expires} />
        <Row label={t('mcp.oauth.summary.scope')} value={summary.scope || '—'} />
        <Row
          label={t('mcp.oauth.summary.refresh')}
          value={summary.hasRefreshToken ? t('mcp.oauth.summary.yes') : t('mcp.oauth.summary.no')}
        />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton
          onClick={() => void connectWithOAuth()}
          data-testid="mcp-oauth-connect"
          className="text-[12px]"
        >
          <Plug size={13} />
          {inUse && connected ? t('mcp.oauth.reconnect') : t('mcp.oauth.connect')}
        </PrimaryButton>
        <GhostButton onClick={() => void forgetOAuth()} data-testid="mcp-oauth-forget">
          <Trash2 size={13} />
          {t('mcp.oauth.forget')}
        </GhostButton>
      </div>
    </div>
  )
}
