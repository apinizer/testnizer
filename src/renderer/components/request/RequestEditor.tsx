import { useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useTranslation } from '../../lib/i18n'
import ParamsTab from './ParamsTab'
import AuthTab from './AuthTab'
import HeadersTab from './HeadersTab'
import BodyTab from './BodyTab'
import ScriptsTab from './ScriptsTab'
import SettingsTab from './SettingsTab'

type ReqTabKey = 'params' | 'headers' | 'auth' | 'body' | 'scripts' | 'settings'

const REQ_TABS: { key: ReqTabKey; label: string; i18n?: string }[] = [
  { key: 'params', label: 'Params', i18n: 'request.params' },
  { key: 'headers', label: 'Headers', i18n: 'request.headers' },
  { key: 'auth', label: 'Authorization', i18n: 'request.auth' },
  { key: 'body', label: 'Body', i18n: 'request.body' },
  { key: 'scripts', label: 'Scripts' },
  { key: 'settings', label: 'Settings' },
]

export default function RequestEditor() {
  const [activeTab, setActiveTab] = useState<ReqTabKey>('params')
  const params = useRequestStore((s) => s.params)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)
  const { t } = useTranslation()

  const enabledParamCount = params.filter((p) => p.enabled).length
  const enabledHeaderCount = headers.filter((h) => h.enabled).length
  const hasBody = body.type !== 'none'
  const hasAuth = auth.type !== 'none'

  function getBadge(tab: ReqTabKey): { count?: number; dot?: boolean; bg: string; color: string } | null {
    if (tab === 'params' && enabledParamCount > 0) {
      return { count: enabledParamCount, bg: 'var(--accent-light)', color: 'var(--accent-text)' }
    }
    if (tab === 'headers' && enabledHeaderCount > 0) {
      return { count: enabledHeaderCount, bg: 'var(--green-bg)', color: 'var(--green)' }
    }
    if (tab === 'body' && hasBody) {
      return { count: 1, bg: 'var(--accent-light)', color: 'var(--accent-text)' }
    }
    // Green dot for active auth (Postman style)
    if (tab === 'auth' && hasAuth) {
      return { dot: true, bg: 'var(--green)', color: 'var(--green)' }
    }
    return null
  }

  // Scripts and Settings tabs need full height for Monaco
  const isFullHeight = activeTab === 'scripts' || activeTab === 'body'

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* Tab bar — Postman style */}
      <div
        className="flex shrink-0 items-center overflow-x-auto"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--white)', padding: '0 4px' }}
      >
        {REQ_TABS.map((tab) => {
          const badge = getBadge(tab.key)
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="flex cursor-pointer items-center gap-1 whitespace-nowrap px-2.5 transition-colors"
              style={{
                height: 30,
                borderBottom: 'none',
                borderBottomWidth: 2,
                borderBottomStyle: 'solid',
                borderBottomColor: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--muted)',
                fontWeight: isActive ? 500 : 400,
                background: 'transparent',
                border: 'none',
              }}
            >
              {tab.i18n ? t(tab.i18n) : tab.label}
              {badge?.dot && (
                <span
                  className="inline-block h-[6px] w-[6px] rounded-full"
                  style={{ background: badge.bg }}
                />
              )}
              {badge?.count != null && (
                <span
                  className="rounded-full px-[5px]"
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
      {isFullHeight ? (
        <div className="flex-1 overflow-hidden">
          {activeTab === 'body' && <div className="h-full p-2"><BodyTab /></div>}
          {activeTab === 'scripts' && <ScriptsTab />}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2.5">
          {activeTab === 'params' && <ParamsTab />}
          {activeTab === 'headers' && <HeadersTab />}
          {activeTab === 'auth' && <AuthTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      )}
    </div>
  )
}
