import type { InputHTMLAttributes } from 'react'
import { KeyRound, ShieldAlert, X } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import McpOAuthHttpOptIn from './McpOAuthHttpOptIn'
import McpOAuthStepRow from './McpOAuthStepRow'
import McpOAuthSummaryCard from './McpOAuthSummaryCard'
import { stepRows } from './oauth-steps'
import { CenterHint, ErrorLine, GhostButton, PrimaryButton, SectionLabel } from './ui'

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--muted)]">
      {label}
      <input
        spellCheck={false}
        {...input}
        className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2.5 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] disabled:opacity-60"
      />
    </label>
  )
}

/**
 * OAuth 2.1 debugger of the MCP editor (issue #141) — Postman's OAuth
 * debugger: runs the MCP authorization handshake in main step by step and
 * shows each request / response, so the user sees exactly where it breaks.
 * The client secret is write-only (never persisted); tokens never reach the
 * renderer. Rendered inline by the Authorization panel when its type is
 * OAuth 2.1 (`embedded`: no own padding / scroll — the panel scrolls).
 */
export default function McpOAuthSection({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  const transport = useMcpStore((s) => s.transport)
  const url = useMcpStore((s) => s.url)
  const unauthorized = useMcpStore((s) => s.unauthorized)
  const clientId = useMcpStore((s) => s.oauthClientId)
  const clientSecret = useMcpStore((s) => s.oauthClientSecret)
  const scope = useMcpStore((s) => s.oauthScope)
  const setClientId = useMcpStore((s) => s.setOAuthClientId)
  const setClientSecret = useMcpStore((s) => s.setOAuthClientSecret)
  const setScope = useMcpStore((s) => s.setOAuthScope)
  const steps = useMcpStore((s) => s.oauthSteps)
  const summary = useMcpStore((s) => s.oauthSummary)
  const running = useMcpStore((s) => s.oauthRunning)
  const error = useMcpStore((s) => s.oauthError)
  const noAuth = useMcpStore((s) => s.oauthNoAuthRequired)
  const flowId = useMcpStore((s) => s.oauthFlowId)
  const startOAuth = useMcpStore((s) => s.startOAuth)
  const cancelOAuth = useMcpStore((s) => s.cancelOAuth)

  const frame = embedded
    ? 'flex min-w-0 flex-col gap-3'
    : 'flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5'

  if (transport === 'stdio') {
    return (
      <div data-testid="mcp-oauth-tab" className="flex min-h-0 flex-1 flex-col">
        <CenterHint>{t('mcp.oauth.stdio')}</CenterHint>
      </div>
    )
  }

  const started = running || steps.length > 0

  return (
    <div data-testid="mcp-oauth-tab" className={frame}>
      <p className="m-0 text-[12px] text-[var(--muted)]">{t('mcp.oauth.intro')}</p>
      {unauthorized && (
        <div
          data-testid="mcp-oauth-unauthorized"
          className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px] text-[var(--text)]"
        >
          <ShieldAlert size={14} className="mt-px shrink-0 text-[var(--orange)]" />
          {t('mcp.oauth.unauthorized')}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field
          label={t('mcp.oauth.clientId')}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={t('mcp.oauth.clientIdPlaceholder')}
          disabled={running}
          data-testid="mcp-oauth-client-id"
        />
        <Field
          label={t('mcp.oauth.clientSecret')}
          type="password"
          autoComplete="new-password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={t('mcp.oauth.clientSecretPlaceholder')}
          disabled={running}
          data-testid="mcp-oauth-client-secret"
        />
        <Field
          label={t('mcp.oauth.scope')}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder={t('mcp.oauth.scopePlaceholder')}
          disabled={running}
          data-testid="mcp-oauth-scope"
        />
      </div>
      <McpOAuthHttpOptIn disabled={running} />
      <div className="flex items-center gap-2">
        <PrimaryButton
          onClick={() => void startOAuth()}
          disabled={running || !url.trim()}
          data-testid="mcp-oauth-start"
          className="text-[12px]"
        >
          <KeyRound size={13} />
          {running
            ? t('mcp.oauth.running')
            : started
              ? t('mcp.oauth.restart')
              : t('mcp.oauth.start')}
        </PrimaryButton>
        {running && (
          <GhostButton
            onClick={() => void cancelOAuth()}
            disabled={!flowId}
            data-testid="mcp-oauth-cancel"
          >
            <X size={13} />
            {t('mcp.oauth.cancel')}
          </GhostButton>
        )}
        {!url.trim() && (
          <span className="text-[12px] text-[var(--hint)]">{t('mcp.oauth.noUrl')}</span>
        )}
      </div>
      {started && (
        <div>
          <SectionLabel>{t('mcp.oauth.steps')}</SectionLabel>
          <ol data-testid="mcp-oauth-steps" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {stepRows(steps).map((step) => (
              <McpOAuthStepRow key={step.id} step={step} />
            ))}
          </ol>
        </div>
      )}
      {error && <ErrorLine testId="mcp-oauth-error">{error}</ErrorLine>}
      {noAuth && (
        <p data-testid="mcp-oauth-no-auth" className="m-0 text-[12px] text-[var(--green)]">
          {t('mcp.oauth.noAuth')}
        </p>
      )}
      {summary && <McpOAuthSummaryCard summary={summary} />}
    </div>
  )
}
