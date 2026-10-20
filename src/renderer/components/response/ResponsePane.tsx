import { useState, useRef, useEffect } from 'react'
import { useResponseStore } from '../../stores/response.store'
import { Loader2, Send, Globe, History as HistoryIcon, Code2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import ResponseBody from './ResponseBody'
import CookieTab from './CookieTab'
import HeadersTab from './HeadersTab'
import TestResultsTab from './TestResultsTab'
import EventsTab from './EventsTab'
import WsseResponsePanel from './WsseResponsePanel'
import SavedResponsesTab from './SavedResponsesTab'
import SaveResponseButton from './SaveResponseButton'
import { useSavedResponseStore, savedResponseOwnerForTab } from '../../stores/saved-response.store'
import { useTabsStore } from '../../stores/tabs.store'
import EmptyState from '../shared/EmptyState'
import StatusBadge from '../shared/StatusBadge'
import { useUIStore } from '../../stores/ui.store'
import NetworkInfoPopover from './NetworkInfoPopover'

type ResTabKey = 'body' | 'events' | 'cookies' | 'headers' | 'testResults' | 'wsse' | 'saved'

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
  // Saved response examples for the request this tab is backed by (issue #125).
  const savedItems = useSavedResponseStore((s) => s.items)
  const loadSaved = useSavedResponseStore((s) => s.load)
  const savedOwner = savedResponseOwnerForTab(activeProtocolTab)
  const savedOwnerKey = savedOwner ? `${savedOwner.type}:${savedOwner.id}` : null
  useEffect(() => {
    void loadSaved(savedOwner)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOwnerKey])
  const savedCount = savedOwnerKey ? savedItems.length : 0
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
      <div
        data-testid="response-loading"
        className="flex h-full flex-col items-center justify-center bg-[var(--white)]"
      >
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        <span className="mt-2 text-[var(--muted)]">{t('response.sendingRequest')}</span>
      </div>
    )
  }

  // Empty state — a request with saved examples (issue #125) lists them here
  // so they can be reviewed without sending first.
  if (!response) {
    if (savedCount > 0) {
      return (
        <div className="flex h-full flex-col bg-[var(--white)]" data-testid="response-saved-only">
          <div
            className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3"
            style={{ height: 34 }}
          >
            <span className="font-semibold" style={{ color: 'var(--accent-text)' }}>
              {t('response.savedResponses')}
            </span>
            <span
              className="rounded-full px-[5px] font-semibold"
              style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
            >
              {savedCount}
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <SavedResponsesTab />
          </div>
        </div>
      )
    }
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
    { key: 'body', label: t('response.tab.body') },
    ...(eventCount > 0
      ? [
          {
            key: 'events' as ResTabKey,
            label: t('response.tab.events'),
            count: eventCount,
            countBg: 'var(--accent-light)',
            countColor: 'var(--accent-text)',
          },
        ]
      : []),
    {
      key: 'cookies',
      label: t('response.tab.cookies'),
      count: cookieCount,
      countBg: 'var(--accent-light)',
      countColor: 'var(--accent-text)',
    },
    // Green pill, matching the request Headers tab badge (issue #19).
    {
      key: 'headers',
      label: t('response.tab.headers'),
      count: headerCount,
      countBg: 'var(--green-bg)',
      countColor: 'var(--green)',
    },
    {
      key: 'testResults',
      label: t('response.tab.testResults'),
      count: testTotal || undefined,
      countLabel: testTotal > 0 ? `${testPassed}/${testTotal}` : undefined,
      countColor: testTotal > 0 ? (testFailed > 0 ? 'var(--red)' : 'var(--green)') : undefined,
    },
    ...(isSoapResponse ? [{ key: 'wsse' as ResTabKey, label: t('response.tab.wsSecurity') }] : []),
    // Saved response examples (issue #125) — only for tabs backed by a row.
    ...(savedOwnerKey
      ? [
          {
            key: 'saved' as ResTabKey,
            label: t('response.savedResponses'),
            count: savedCount || undefined,
            countBg: 'var(--accent-light)',
            countColor: 'var(--accent-text)',
          },
        ]
      : []),
    // NOTE: "Console" and "Actual" tabs were removed. The footer Console
    // (sağ alt) already shows the same data: script logs land as their own
    // entry via `console.store.addFromResponse`, and the per-request entry
    // pre-populates `details.requestHeaders`/`requestBody` (from
    // `result.actualRequest`) plus `responseHeaders`/`responseBody`. Two
    // labels named "Console" in different scopes was confusing users.
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* ── Top bar: tabs (left) + meta (right) — Postman style ──
          A size container (issue #213): the Turkish row (Gövde / Çerezler /
          Başlıklar / Test Sonuçları + status + ms + KB + Yanıtı kaydet + Kod
          + globe) is ~920px at the default 13px font, so a pane next to the
          Variables panel scrolled the tab strip and cut Gövde off. Below
          72em (≈936px) the Save response / Code buttons drop to icon-only
          and the meta gap tightens; below 61em (≈793px) the tab padding
          tightens too. `em` follows the Project Settings font size. The
          horizontal scroll stays only as a last resort for very narrow panes.
          `relative z-10`: a size container is a stacking context, so without
          it the Save response popover (z-50, absolutely positioned below the
          bar) would paint under the body area / Monaco that follows. */}
      <div
        data-testid="response-topbar"
        className="@container relative z-10 flex shrink-0 items-center gap-1 pl-2 pr-2"
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
          title={t('response.historyButton')}
        >
          <HistoryIcon size={14} />
        </button>

        {/* Tabs. overflow-y-hidden is load-bearing: `overflow-x-auto` alone
            promotes overflow-y from `visible` to `auto` (CSS spec), so a tab
            row whose content is even 1px taller than its 34px box sprouts a
            stray VERTICAL scrollbar (issue #34). Pin Y to hidden; X still
            scrolls when the tab labels overflow. */}
        <div className="flex flex-1 items-center gap-0 overflow-x-auto overflow-y-hidden">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={`res-tab-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className="relative shrink-0 cursor-pointer whitespace-nowrap px-3 transition-colors @max-[61em]:px-2"
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
        <div className="flex shrink-0 items-center gap-3 pl-2 @max-[72em]:gap-2">
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
          <SaveResponseButton onSaved={() => setActiveTab('saved')} />
          <button
            type="button"
            data-testid="response-code-btn"
            title={t('response.code')}
            aria-label={t('response.code')}
            onClick={() => setShowCodeGenerator(true)}
            className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
            style={{ borderColor: 'var(--border)', background: 'transparent' }}
          >
            <Code2 size={11} />
            <span data-collapsible-label className="@max-[72em]:hidden">
              {t('response.code')}
            </span>
          </button>
          <div style={{ position: 'relative' }}>
            <button
              ref={networkBtnRef}
              type="button"
              title={t('response.networkInfo')}
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
        {activeTab === 'saved' && <SavedResponsesTab />}
      </div>
    </div>
  )
}
