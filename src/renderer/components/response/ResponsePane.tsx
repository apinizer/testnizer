import { useState, useRef, useEffect, useLayoutEffect, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { useResponseStore } from '../../stores/response.store'
import { Loader2, Send, Globe, History as HistoryIcon, Code2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import ResponseBody from './ResponseBody'
import CookieTab from './CookieTab'
import HeadersTab from './HeadersTab'
import TestResultsTab from './TestResultsTab'
import EventsTab from './EventsTab'
import WsseResponsePanel from './WsseResponsePanel'
import { useTabsStore } from '../../stores/tabs.store'
import EmptyState from '../shared/EmptyState'
import StatusBadge from '../shared/StatusBadge'
import { useUIStore } from '../../stores/ui.store'
import type { ApiResponse } from '../../types'

type ResTabKey = 'body' | 'events' | 'cookies' | 'headers' | 'testResults' | 'wsse'

/** Extract hostname from URL safely */
function extractHost(url?: string): string {
  if (!url) return '—'
  try {
    const u = new URL(url)
    return u.host || '—'
  } catch {
    return '—'
  }
}

/** Extract protocol (http/https) from URL */
function extractProtocol(url?: string): string {
  if (!url) return '—'
  try {
    const u = new URL(url)
    return u.protocol.replace(':', '').toUpperCase()
  } catch {
    return '—'
  }
}

/** Human format milliseconds for the timing table */
function fmtMs(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1 ms'
  return `${Math.round(ms)} ms`
}

/**
 * Network info popover — rendered when the globe icon is clicked.
 *
 * Portaled to `document.body` and positioned with `fixed` so the overlay
 * can escape the response pane's `overflow-hidden` clipping rectangle and
 * the workbench's bottom Console panel. The previous absolute-positioned
 * version was clipped at the workbench bottom edge whenever the response
 * pane sat low in the layout (typical 50/50 split), hiding the Timings
 * rows from view.
 */
const NetworkInfoPopover = forwardRef<
  HTMLDivElement,
  { response: ApiResponse; anchor: HTMLElement | null }
>(function NetworkInfoPopover({ response, anchor }, ref) {
  const POPOVER_W = 320
  const VIEWPORT_MARGIN = 8

  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  // Recompute position on mount + when the viewport changes. The button is
  // anchored at fixed coords from the workbench layout, so we read its
  // rect on demand rather than tracking it continuously.
  useLayoutEffect(() => {
    if (!anchor) return
    const measure = (): void => {
      const rect = anchor.getBoundingClientRect()
      const vh = window.innerHeight
      const vw = window.innerWidth
      const spaceBelow = vh - rect.bottom
      const spaceAbove = rect.top
      // Pick the side with more room. Threshold: 200px below — anything
      // less and we flip upward. The popover renders both Network and
      // Timings sections (~400px when fully populated).
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
      const maxHeight = Math.max(180, (openUp ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN)
      const top = openUp
        ? Math.max(VIEWPORT_MARGIN, rect.top - maxHeight - 4)
        : Math.min(rect.bottom + 4, vh - maxHeight - VIEWPORT_MARGIN)
      // Right-align with the button; clamp inside the viewport so the
      // popover never spills off the left edge on a narrow window.
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.right - POPOVER_W, vw - POPOVER_W - VIEWPORT_MARGIN),
      )
      setPos({ top, left, maxHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor])

  if (!pos) return null

  const url = response.actualRequest?.url
  const host = extractHost(url)
  const proto = extractProtocol(url)
  const contentType =
    response.headers?.['content-type'] || response.headers?.['Content-Type'] || '—'
  const server = response.headers?.['server'] || response.headers?.['Server'] || '—'
  const t = response.timing || { total: 0 }

  const rows: Array<[string, string]> = [
    ['Host', host],
    ['Protocol', proto],
    ['Method', response.actualRequest?.method || '—'],
    [
      'Status',
      response.status != null ? `${response.status} ${response.statusText || ''}`.trim() : '—',
    ],
    ['Server', server],
    ['Content-Type', contentType],
  ]

  const timings: Array<[string, string]> = [
    ['DNS lookup', fmtMs(t.dns)],
    ['TCP handshake', fmtMs(t.tcp)],
    ['TLS handshake', fmtMs(t.tls)],
    ['Time to first byte', fmtMs(t.ttfb)],
    ['Download', fmtMs(t.download)],
    ['Total', fmtMs(t.total)],
  ]

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1000] overflow-auto rounded-md border border-[var(--border)] bg-[var(--white)] shadow-lg"
      style={{
        top: pos.top,
        left: pos.left,
        width: POPOVER_W,
        maxHeight: pos.maxHeight,
        boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
        fontSize: 13,
      }}
    >
      <div
        className="px-3 py-2 font-semibold text-[var(--text)]"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        Network
      </div>
      <div className="px-3 py-2">
        <table className="w-full" style={{ fontSize: 13 }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="py-1 pr-3 text-[var(--muted)]" style={{ width: 110 }}>
                  {k}
                </td>
                <td
                  className="py-1 font-mono text-[var(--text)]"
                  style={{ wordBreak: 'break-all' }}
                >
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="px-3 py-2 font-semibold text-[var(--text)]"
        style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
      >
        Timings
      </div>
      <div className="px-3 py-2">
        <table className="w-full" style={{ fontSize: 13 }}>
          <tbody>
            {timings.map(([k, v]) => (
              <tr key={k}>
                <td className="py-1 pr-3 text-[var(--muted)]" style={{ width: 160 }}>
                  {k}
                </td>
                <td className="py-1 font-mono text-[var(--text)]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>,
    document.body,
  )
})

/**
 * Response panel — Postman-style layout:
 * [ Body | Cookies(n) | Headers(n) | Test Results | Console ]   [200 OK • 142ms • 2.1 KB • ⋯]
 */
export default function ResponsePane() {
  const response = useResponseStore((s) => s.response)
  const isLoading = useResponseStore((s) => s.isLoading)
  const setActiveSidebarPage = useUIStore((s) => s.setActiveSidebarPage)
  const setShowCodeGenerator = useUIStore((s) => s.setShowCodeGenerator)
  const activeProtocolTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [activeTab, setActiveTab] = useState<ResTabKey>('body')
  const [showNetworkInfo, setShowNetworkInfo] = useState(false)
  const networkBtnRef = useRef<HTMLButtonElement>(null)
  const networkPopRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  // When a new response arrives that contains parsed SSE events, jump to
  // the Events tab so users notice the stream immediately. Keyed on
  // requestId so re-renders of the same response don't override navigation.
  const responseRequestId = response?.requestId
  const sseEventCount = response?.sseEvents?.length ?? 0
  useEffect(() => {
    if (sseEventCount > 0) {
      setActiveTab('events')
    }
  }, [responseRequestId, sseEventCount])

  // Close network popover on outside click
  useEffect(() => {
    if (!showNetworkInfo) return
    const handler = (e: MouseEvent) => {
      if (
        networkPopRef.current &&
        !networkPopRef.current.contains(e.target as Node) &&
        networkBtnRef.current &&
        !networkBtnRef.current.contains(e.target as Node)
      ) {
        setShowNetworkInfo(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showNetworkInfo])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--white)]">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        <span className="mt-2 text-[var(--muted)]">{t('response.sendingRequest')}</span>
      </div>
    )
  }

  // Empty state
  if (!response) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--white)]">
        <EmptyState
          icon={<Send size={32} />}
          title={t('empty.clickSend')}
          description={t('empty.enterUrl')}
        />
      </div>
    )
  }

  // Error state (no status code at all)
  if (response.error && !response.status) {
    return (
      <div className="flex h-full flex-col bg-[var(--white)]" data-testid="response-error">
        <div className="flex flex-1 items-center justify-center p-4">
          <div
            className="rounded-lg p-4 text-center"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.35)',
            }}
          >
            <div className="mb-1 font-medium" style={{ color: 'var(--red)' }}>
              {t('response.requestFailed')}
            </div>
            <div style={{ color: 'var(--muted)' }}>{response.error}</div>
          </div>
        </div>
      </div>
    )
  }

  const cookieCount = response.cookies?.length ?? 0
  const headerCount = response.headers ? Object.keys(response.headers).length : 0
  const testTotal = response.testResults?.length ?? 0
  const testPassed = response.testResults?.filter((r) => r.passed).length ?? 0
  const testFailed = testTotal - testPassed

  const sizeKB = response.bodySize
    ? (response.bodySize / 1024).toFixed(2)
    : response.body
      ? (new Blob([response.body]).size / 1024).toFixed(2)
      : '0'

  const humanTime = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
    return `${ms} ms`
  }

  const isSoapResponse = activeProtocolTab?.protocol === 'soap' || response.protocol === 'soap'
  const eventCount = response.sseEvents?.length ?? 0

  const TABS: Array<{
    key: ResTabKey
    label: string
    count?: number
    countLabel?: string
    countColor?: string
    countBg?: string
  }> = [
    { key: 'body', label: 'Body' },
    ...(eventCount > 0
      ? [
          {
            key: 'events' as ResTabKey,
            label: 'Events',
            count: eventCount,
            countBg: 'var(--accent-light)',
            countColor: 'var(--accent-text)',
          },
        ]
      : []),
    {
      key: 'cookies',
      label: 'Cookies',
      count: cookieCount,
      countBg: 'var(--accent-light)',
      countColor: 'var(--accent-text)',
    },
    // Green pill, matching the request Headers tab badge (issue #19).
    {
      key: 'headers',
      label: 'Headers',
      count: headerCount,
      countBg: 'var(--green-bg)',
      countColor: 'var(--green)',
    },
    {
      key: 'testResults',
      label: 'Test Results',
      count: testTotal || undefined,
      countLabel: testTotal > 0 ? `${testPassed}/${testTotal}` : undefined,
      countColor: testTotal > 0 ? (testFailed > 0 ? 'var(--red)' : 'var(--green)') : undefined,
    },
    ...(isSoapResponse ? [{ key: 'wsse' as ResTabKey, label: 'WS-Security' }] : []),
    // NOTE: "Console" and "Actual" tabs were removed. The footer Console
    // (sağ alt) already shows the same data: script logs land as their own
    // entry via `console.store.addFromResponse`, and the per-request entry
    // pre-populates `details.requestHeaders`/`requestBody` (from
    // `result.actualRequest`) plus `responseHeaders`/`responseBody`. Two
    // labels named "Console" in different scopes was confusing users.
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* ── Top bar: tabs (left) + meta (right) — Postman style ── */}
      <div
        className="flex shrink-0 items-center gap-1 pl-2 pr-2"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--white)',
          height: 34,
        }}
      >
        {/* History icon — Postman shows a small clock button before status */}
        <button
          type="button"
          onClick={() => setActiveSidebarPage('history')}
          className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.color = 'var(--muted)'
          }}
          title="Response history"
        >
          <HistoryIcon size={14} />
        </button>

        {/* Tabs */}
        <div className="flex flex-1 items-center gap-0 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={`res-tab-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className="relative shrink-0 cursor-pointer whitespace-nowrap px-3 transition-colors"
                style={{
                  height: 33,
                  background: 'transparent',
                  border: 'none',
                  color: isActive ? 'var(--accent-text)' : 'var(--muted)',
                  fontWeight: isActive ? 600 : 400,
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {tab.label}
                {tab.count != null &&
                  tab.count > 0 &&
                  (tab.countBg ? (
                    // Rounded count pill — same shape as the request-pane badges.
                    <span
                      className="ml-1 rounded-full px-[5px] font-semibold"
                      style={{
                        background: tab.countBg,
                        color: tab.countColor || 'var(--accent-text)',
                      }}
                    >
                      {tab.countLabel || tab.count}
                    </span>
                  ) : (
                    <span
                      className="ml-1 font-semibold"
                      style={{
                        color: tab.countColor || (isActive ? 'var(--accent-text)' : 'var(--hint)'),
                      }}
                    >
                      {tab.countLabel || tab.count}
                    </span>
                  ))}
              </button>
            )
          })}
        </div>

        {/* Right: meta info (status • time • size • globe • more) */}
        <div className="flex shrink-0 items-center gap-3 pl-2">
          {response.status != null && (
            <span data-testid="response-status">
              <StatusBadge status={response.status} statusText={response.statusText} pill />
            </span>
          )}
          {response.timing?.total != null && (
            <span style={{ color: 'var(--muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--green)' }}>
                {humanTime(response.timing.total)}
              </span>
            </span>
          )}
          <span style={{ color: 'var(--muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>
              {sizeKB} KB
            </span>
          </span>
          <button
            type="button"
            data-testid="response-code-btn"
            title={t('response.code')}
            onClick={() => setShowCodeGenerator(true)}
            className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
            style={{ borderColor: 'var(--border)', background: 'transparent' }}
          >
            <Code2 size={11} />
            {t('response.code')}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              ref={networkBtnRef}
              type="button"
              title="Network info"
              onClick={() => setShowNetworkInfo((v) => !v)}
              className="flex cursor-pointer items-center justify-center rounded p-1"
              style={{
                background: showNetworkInfo ? 'var(--accent-light)' : 'transparent',
                border: 'none',
                color: showNetworkInfo ? 'var(--accent-text)' : 'var(--muted)',
              }}
            >
              <Globe size={14} />
            </button>
            {showNetworkInfo && (
              <NetworkInfoPopover
                ref={networkPopRef}
                response={response}
                anchor={networkBtnRef.current}
              />
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-[var(--white)]">
        {activeTab === 'body' && <ResponseBody />}
        {activeTab === 'events' && <EventsTab />}
        {activeTab === 'cookies' && <CookieTab />}
        {activeTab === 'headers' && <HeadersTab />}
        {activeTab === 'testResults' && <TestResultsTab />}
        {activeTab === 'wsse' && <WsseResponsePanel body={response.body ?? ''} />}
      </div>
    </div>
  )
}
