import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { resolveVariables } from '../../lib/variable-resolver'
import { useTranslation } from '../../lib/i18n'
import { useAppVersion, useEffectiveAuth } from '../../lib/use-auto-headers-inputs'
import {
  computeAutoHeaders,
  countSentAutoHeaders,
  SEND_TIME_TOKEN,
  type AutoHeaderRow,
  type AutoHeaderSource,
} from '../../../shared/http-auto-headers'

/**
 * Read-only "auto-generated headers" section under the HTTP Headers table
 * (issue #204, Postman's hidden-headers toggle). Rows come from the shared
 * `computeAutoHeaders` — the same module the engine takes its defaults from —
 * so the preview cannot drift from the request. Credential values arrive
 * already masked from that module; nothing here un-masks them.
 */

// Toggle survives tab switches / remounts for the session (in memory only).
let expandedForSession = false

const SOURCE_KEY: Record<AutoHeaderSource, string> = {
  auth: 'autoHeaders.source.auth',
  engine: 'autoHeaders.source.engine',
  cookie: 'autoHeaders.source.cookie',
}

function displayValue(row: AutoHeaderRow, t: (k: string) => string): string {
  if (row.source === 'cookie') return t('autoHeaders.cookieJar')
  return row.value.split(SEND_TIME_TOKEN).join(t('autoHeaders.calculatedAtSend'))
}

export default function AutoHeadersSection() {
  const { t } = useTranslation()
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)
  const getActiveVariables = useEnvironmentStore((s) => s.getActiveVariables)
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const globalVariables = useEnvironmentStore((s) => s.globalVariables)
  const appVersion = useAppVersion()
  const effectiveAuth = useEffectiveAuth(auth)
  const [expanded, setExpanded] = useState(expandedForSession)

  // The URL is resolved only to derive Host — the same resolution the URL
  // Preview strip already shows under the URL bar.
  const resolvedUrl = useMemo(
    () => (url ? resolveVariables(url, getActiveVariables()) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, environments, activeEnvironmentId, globalVariables],
  )

  const rows = useMemo(
    () =>
      computeAutoHeaders({
        method,
        url: resolvedUrl,
        headers,
        body,
        auth: effectiveAuth,
        appVersion,
      }),
    [method, resolvedUrl, headers, body, effectiveAuth, appVersion],
  )
  const count = countSentAutoHeaders(rows)

  const toggle = (): void => {
    expandedForSession = !expanded
    setExpanded(!expanded)
  }

  return (
    <div data-testid="auto-headers" className="mt-2 border-t border-[var(--border)]">
      <button
        type="button"
        data-testid="auto-headers-toggle"
        aria-expanded={expanded}
        onClick={toggle}
        className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-2.5 py-1.5 text-left text-[var(--muted)] hover:text-[var(--accent)]"
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{t('autoHeaders.title')}</span>
        <span data-testid="auto-headers-count" className="text-[var(--hint)]">
          {t('autoHeaders.hiddenCount').replace('{n}', String(count))}
        </span>
      </button>
      {expanded && (
        <div data-testid="auto-headers-rows" className="border-t border-[var(--border)]">
          {rows.map((row, i) => (
            <div
              key={`${row.name}-${i}`}
              data-testid="auto-header-row"
              data-source={row.source}
              data-overridden={row.overriddenByUser ? 'true' : 'false'}
              title={row.overriddenByUser ? t('autoHeaders.overriddenHint') : undefined}
              className={`grid grid-cols-[minmax(120px,30%)_1fr_auto] items-center gap-2 border-b border-[var(--border)] px-2.5 py-[5px] ${
                row.overriddenByUser ? 'opacity-60' : ''
              }`}
            >
              <span
                className={`truncate font-mono text-[var(--text)] ${
                  row.overriddenByUser ? 'line-through' : ''
                }`}
              >
                {row.name}
              </span>
              <span
                data-testid="auto-header-value"
                className={`truncate font-mono ${
                  row.sendTime || row.source === 'cookie'
                    ? 'text-[var(--hint)] italic'
                    : 'text-[var(--muted)]'
                } ${row.overriddenByUser ? 'line-through' : ''}`}
              >
                {displayValue(row, t)}
              </span>
              <span className="flex items-center gap-1">
                {row.overriddenByUser && (
                  <span className="rounded border border-[var(--border)] px-1.5 text-[11px] text-[var(--hint)]">
                    {t('autoHeaders.overridden')}
                  </span>
                )}
                <span
                  data-testid="auto-header-source"
                  className="rounded bg-[var(--surface)] px-1.5 text-[11px] text-[var(--muted)]"
                >
                  {t(SOURCE_KEY[row.source])}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
