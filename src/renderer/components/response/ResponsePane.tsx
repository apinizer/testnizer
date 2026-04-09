import { useState } from 'react'
import { useResponseStore } from '../../stores/response.store'
import { Loader2, Send } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import ResponseMeta from './ResponseMeta'
import ResponseBody from './ResponseBody'
import CookieTab from './CookieTab'
import ConsoleTab from './ConsoleTab'
import ActualRequestTab from './ActualRequestTab'
import EmptyState from '../shared/EmptyState'

type ResTabKey = 'response' | 'cookie' | 'console' | 'actualRequest'
const RES_TAB_KEYS: ResTabKey[] = ['response', 'cookie', 'console', 'actualRequest']

const TAB_I18N_MAP: Record<ResTabKey, string> = {
  response: 'response.response',
  cookie: 'response.cookie',
  console: 'response.console',
  actualRequest: 'response.actualRequest',
}

export default function ResponsePane() {
  const response = useResponseStore((s) => s.response)
  const isLoading = useResponseStore((s) => s.isLoading)
  const [activeTab, setActiveTab] = useState<ResTabKey>('response')
  const { t } = useTranslation()

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--white)]">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        <span className="mt-2 text-sm text-[var(--muted)]">{t('response.sendingRequest')}</span>
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

  // Error state
  if (response.error && !response.status) {
    return (
      <div className="flex h-full flex-col bg-[var(--white)]">
        <ResponseMeta />
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="rounded-lg border border-[#f5b3b3] bg-[#fff0f0] p-4 text-center">
            <div className="mb-1 text-sm font-medium text-[var(--red)]">{t('response.requestFailed')}</div>
            <div className="text-sm text-[var(--muted)]">{response.error}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Meta bar */}
      <ResponseMeta />

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-[var(--border)] bg-[var(--white)]">
        {RES_TAB_KEYS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="cursor-pointer whitespace-nowrap px-2.5 py-1 text-[13px] transition-colors"
            style={{
              borderBottom:
                activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--accent-text)' : 'var(--muted)',
              fontWeight: activeTab === tab ? 500 : 400,
              background: 'transparent',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab ? 'var(--accent)' : 'transparent',
            }}
          >
            {t(TAB_I18N_MAP[tab])}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-[var(--surface)]">
        {activeTab === 'response' && <ResponseBody />}
        {activeTab === 'cookie' && <CookieTab />}
        {activeTab === 'console' && <ConsoleTab />}
        {activeTab === 'actualRequest' && <ActualRequestTab />}
      </div>
    </div>
  )
}
