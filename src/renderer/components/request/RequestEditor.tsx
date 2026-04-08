import { useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useTranslation } from '../../lib/i18n'
import ParamsTab from './ParamsTab'
import AuthTab from './AuthTab'
import HeadersTab from './HeadersTab'
import BodyTab from './BodyTab'
import PreRequestTab from './PreRequestTab'
import TestsTab from './TestsTab'

type ReqTabKey = 'params' | 'body' | 'headers' | 'auth' | 'preRequest' | 'tests'

const REQ_TAB_KEYS: ReqTabKey[] = ['params', 'body', 'headers', 'auth', 'preRequest', 'tests']

const TAB_I18N_MAP: Record<ReqTabKey, string> = {
  params: 'request.params',
  body: 'request.body',
  headers: 'request.headers',
  auth: 'request.auth',
  preRequest: 'request.preRequest',
  tests: 'request.tests',
}

export default function RequestEditor() {
  const [activeTab, setActiveTab] = useState<ReqTabKey>('params')
  const params = useRequestStore((s) => s.params)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const { t } = useTranslation()

  const enabledParamCount = params.filter((p) => p.enabled).length
  const enabledHeaderCount = headers.filter((h) => h.enabled).length
  const hasBody = body.type !== 'none'

  function getTabBadge(tab: ReqTabKey): { count: number; bg: string; color: string } | null {
    if (tab === 'params' && enabledParamCount > 0) {
      return { count: enabledParamCount, bg: 'var(--accent-light)', color: 'var(--accent-text)' }
    }
    if (tab === 'headers' && enabledHeaderCount > 0) {
      return { count: enabledHeaderCount, bg: 'var(--green-bg)', color: 'var(--green)' }
    }
    if (tab === 'body' && hasBody) {
      return { count: 1, bg: 'var(--accent-light)', color: 'var(--accent-text)' }
    }
    return null
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* Tab bar — Apidog style: text tabs with underline */}
      <div
        className="flex shrink-0 items-center overflow-x-auto"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--white)', padding: '0 4px' }}
      >
        {REQ_TAB_KEYS.map((tab) => {
          const badge = getTabBadge(tab)
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 text-[0.8125rem] transition-colors"
              style={{
                height: 36,
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                color: isActive ? 'var(--text)' : 'var(--muted)',
                fontWeight: isActive ? 500 : 400,
                background: 'transparent',
                border: 'none',
                borderBottomWidth: 2,
                borderBottomStyle: 'solid',
                borderBottomColor: isActive ? 'var(--accent)' : 'transparent',
              }}
            >
              {t(TAB_I18N_MAP[tab])}
              {badge && (
                <span
                  className="rounded-full px-[5px] text-[0.75rem]"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  {badge.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {activeTab === 'params' && <ParamsTab />}
        {activeTab === 'auth' && <AuthTab />}
        {activeTab === 'headers' && <HeadersTab />}
        {activeTab === 'body' && <BodyTab />}
        {activeTab === 'preRequest' && <PreRequestTab />}
        {activeTab === 'tests' && <TestsTab />}
      </div>
    </div>
  )
}
