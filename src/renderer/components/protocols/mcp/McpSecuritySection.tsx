import { ShieldCheck, ShieldAlert, X } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import McpSecurityCategory from './McpSecurityCategory'
import McpSecuritySummary from './McpSecuritySummary'
import { categoryViews } from './security-ui'
import { CenterHint, ErrorLine, GhostButton, PrimaryButton } from './ui'

function Progress({ done, total, current }: { done: number; total: number; current: string }) {
  const { t } = useTranslation()
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div data-testid="mcp-security-progress" className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 w-full overflow-hidden rounded bg-[var(--fill-4)]"
      >
        {/* Width is the one dynamic value — inline style by necessity. */}
        <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-[var(--muted)]">
        {t('mcp.security.progress')
          .replace('{done}', String(done))
          .replace('{total}', String(total))}
        {current ? ` · ${current}` : ''}
      </span>
    </div>
  )
}

/**
 * "Security" tab of the MCP editor (issue #142): an offline A–F scan of this
 * tab's server with its current headers / OAuth token. The rate-limit probe
 * is opt-in; the scan result is per tab and never persisted.
 */
export default function McpSecuritySection() {
  const { t } = useTranslation()
  const transport = useMcpStore((s) => s.transport)
  const url = useMcpStore((s) => s.url)
  const oauthSessionId = useMcpStore((s) => s.oauthSessionId)
  const running = useMcpStore((s) => s.securityRunning)
  const scanId = useMcpStore((s) => s.securityScanId)
  const progress = useMcpStore((s) => s.securityProgress)
  const findings = useMcpStore((s) => s.securityFindings)
  const report = useMcpStore((s) => s.securityReport)
  const error = useMcpStore((s) => s.securityError)
  const rateLimitProbe = useMcpStore((s) => s.securityRateLimitProbe)
  const setRateLimitProbe = useMcpStore((s) => s.setSecurityRateLimitProbe)
  const startScan = useMcpStore((s) => s.startSecurityScan)
  const cancelScan = useMcpStore((s) => s.cancelSecurityScan)

  if (transport === 'stdio') {
    return (
      <div data-testid="mcp-security-tab" className="flex min-h-0 flex-1 flex-col">
        <CenterHint>{t('mcp.security.stdio')}</CenterHint>
      </div>
    )
  }

  const views = categoryViews(report, findings)
  const hasUrl = !!url.trim()

  return (
    <div
      data-testid="mcp-security-tab"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5"
    >
      <p className="m-0 text-[12px] text-[var(--muted)]">{t('mcp.security.intro')}</p>
      <div className="flex min-w-0 items-center gap-2 text-[12px]">
        <span className="shrink-0 text-[var(--muted)]">{t('mcp.security.target')}</span>
        <code
          data-testid="mcp-security-target"
          className="min-w-0 flex-1 truncate rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 font-mono text-[12px] text-[var(--text)]"
        >
          {url.trim() || '—'}
        </code>
        {oauthSessionId && (
          <span className="shrink-0 text-[11px] text-[var(--green)]">
            {t('mcp.security.usesOAuth')}
          </span>
        )}
      </div>
      <p
        data-testid="mcp-security-disclaimer"
        className="m-0 flex items-center gap-1.5 text-[12px] font-medium text-[var(--orange)]"
      >
        <ShieldAlert size={13} className="shrink-0" />
        {t('mcp.security.disclaimer')}
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text)]">
        <input
          type="checkbox"
          checked={rateLimitProbe}
          onChange={(e) => setRateLimitProbe(e.target.checked)}
          disabled={running}
          data-testid="mcp-security-ratelimit-optin"
        />
        {t('mcp.security.activeProbesOptIn')}
      </label>
      <div className="flex items-center gap-2">
        <PrimaryButton
          onClick={() => void startScan()}
          disabled={running || !hasUrl}
          data-testid="mcp-security-scan"
          className="text-[12px]"
        >
          <ShieldCheck size={13} />
          {running
            ? t('mcp.security.scanning')
            : report || findings.length > 0
              ? t('mcp.security.rescan')
              : t('mcp.security.scan')}
        </PrimaryButton>
        {running && (
          <GhostButton
            onClick={() => void cancelScan()}
            disabled={!scanId}
            data-testid="mcp-security-cancel"
          >
            <X size={13} />
            {t('mcp.security.cancel')}
          </GhostButton>
        )}
        {!hasUrl && (
          <span className="text-[12px] text-[var(--hint)]">{t('mcp.security.noUrl')}</span>
        )}
      </div>
      {running && progress && <Progress {...progress} />}
      {error && <ErrorLine testId="mcp-security-error">{error}</ErrorLine>}
      {report && <McpSecuritySummary report={report} />}
      {views.length > 0 ? (
        <div data-testid="mcp-security-categories" className="flex flex-col gap-2">
          {views.map((v) => (
            <McpSecurityCategory key={v.id} view={v} />
          ))}
        </div>
      ) : (
        !running &&
        !error && <p className="m-0 text-[12px] text-[var(--hint)]">{t('mcp.security.empty')}</p>
      )}
    </div>
  )
}
