import { useState } from 'react'
import { useResponseStore } from '../../stores/response.store'
import { Loader2, Send, Globe, MoreHorizontal, History as HistoryIcon } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import ResponseBody from './ResponseBody'
import CookieTab from './CookieTab'
import ConsoleTab from './ConsoleTab'
import HeadersTab from './HeadersTab'
import TestResultsTab from './TestResultsTab'
import ActualRequestTab from './ActualRequestTab'
import EmptyState from '../shared/EmptyState'
import StatusBadge from '../shared/StatusBadge'
import { useUIStore } from '../../stores/ui.store'

type ResTabKey = 'body' | 'cookies' | 'headers' | 'testResults' | 'console' | 'actualRequest'

/**
 * Response panel — Postman-style layout:
 * [ Body | Cookies(n) | Headers(n) | Test Results | Console ]   [200 OK • 142ms • 2.1 KB • ⋯]
 */
export default function ResponsePane() {
  const response = useResponseStore((s) => s.response)
  const isLoading = useResponseStore((s) => s.isLoading)
  const setShowCodeGenerator = useUIStore((s) => s.setShowCodeGenerator)
  const setActiveSidebarPage = useUIStore((s) => s.setActiveSidebarPage)
  const [activeTab, setActiveTab] = useState<ResTabKey>('body')
  const { t } = useTranslation()

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
      <div className="flex h-full bg-[var(--white)]">
        <EmptyState
          icon={<Send size={32} />}
          message={t('empty.clickSend')}
          description={t('empty.enterUrl')}
        />
      </div>
    )
  }

  // Error state (no status code at all)
  if (response.error && !response.status) {
    return (
      <div className="flex h-full flex-col bg-[var(--white)]">
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

  const TABS: Array<{ key: ResTabKey; label: string; count?: number; countLabel?: string; countColor?: string }> = [
    { key: 'body', label: 'Body' },
    { key: 'cookies', label: 'Cookies', count: cookieCount },
    { key: 'headers', label: 'Headers', count: headerCount },
    {
      key: 'testResults',
      label: 'Test Results',
      count: testTotal || undefined,
      countLabel: testTotal > 0 ? `${testPassed}/${testTotal}` : undefined,
      countColor: testTotal > 0 ? (testFailed > 0 ? 'var(--red)' : 'var(--green)') : undefined,
    },
    { key: 'console', label: 'Console' },
    { key: 'actualRequest', label: 'Actual' },
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
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)' }}
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
                {tab.count != null && tab.count > 0 && (
                  <span
                    className="ml-1 font-semibold"
                    style={{ color: tab.countColor || (isActive ? 'var(--accent-text)' : 'var(--hint)') }}
                  >
                    {tab.countLabel || tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Right: meta info (status • time • size • globe • more) */}
        <div className="flex shrink-0 items-center gap-3 pl-2">
          {response.status != null && (
            <StatusBadge status={response.status} statusText={response.statusText} pill />
          )}
          {response.timing?.total != null && (
            <span style={{ color: 'var(--muted)' }}>
              <span className="font-semibold" style={{ color: 'var(--green)' }}>{humanTime(response.timing.total)}</span>
            </span>
          )}
          <span style={{ color: 'var(--muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>{sizeKB} KB</span>
          </span>
          <button
            type="button"
            title="Network"
            className="flex cursor-pointer items-center justify-center rounded p-1"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          >
            <Globe size={14} />
          </button>
          <button
            type="button"
            title="More"
            onClick={() => setShowCodeGenerator(true)}
            className="flex cursor-pointer items-center justify-center rounded p-1"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-[var(--white)]">
        {activeTab === 'body' && <ResponseBody />}
        {activeTab === 'cookies' && <CookieTab />}
        {activeTab === 'headers' && <HeadersTab />}
        {activeTab === 'testResults' && <TestResultsTab />}
        {activeTab === 'console' && <ConsoleTab />}
        {activeTab === 'actualRequest' && <ActualRequestTab />}
      </div>
    </div>
  )
}
