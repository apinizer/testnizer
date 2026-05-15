import { useState, useMemo } from 'react'
import { Code2, Variable, ChevronRight, Copy, Check } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useRequestStore } from '../../stores/request.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import RunnerVariables from '../runner/RunnerVariables'
import MonacoWrapper from '../shared/MonacoWrapper'
import { generateCode, CODE_LANGUAGES } from '../../lib/code-generator'
import type { CodeLanguage } from '../../types'

/** Generate Code pane — displayed inside the right panel as a tab */
function GenerateCodePane() {
  const [activeLang, setActiveLang] = useState<CodeLanguage>('curl')
  const [copied, setCopied] = useState(false)

  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const params = useRequestStore((s) => s.params)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)
  const getActiveVariables = useEnvironmentStore((s) => s.getActiveVariables)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const envVarsRev = useEnvironmentStore((s) => s.environments)

  const code = useMemo(
    () =>
      generateCode(
        activeLang,
        { method, url, params, headers, body, auth },
        { envVars: getActiveVariables() },
      ),
    [
      activeLang,
      method,
      url,
      params,
      headers,
      body,
      auth,
      getActiveVariables,
      activeEnvId,
      envVarsRev,
    ],
  )

  const monacoLang = CODE_LANGUAGES.find((l) => l.id === activeLang)?.monacoLang ?? 'plaintext'

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Language selector + copy */}
      <div
        className="flex shrink-0 items-center gap-2 px-2.5 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <select
          value={activeLang}
          onChange={(e) => setActiveLang(e.target.value as CodeLanguage)}
          className="flex-1 cursor-pointer rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none"
          style={{ fontSize: 13 }}
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleCopy}
          title="Copy"
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
          style={{ fontSize: 13 }}
        >
          {copied ? <Check size={12} className="text-[var(--green)]" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Code preview */}
      <div className="flex-1 overflow-hidden">
        <MonacoWrapper
          value={code}
          language={monacoLang}
          readOnly
          height="100%"
          lineNumbers="off"
        />
      </div>
    </div>
  )
}

interface RightPanelTabIcon {
  id: 'variables' | 'code'
  icon: React.ReactNode
  label: string
}

const TABS: RightPanelTabIcon[] = [
  { id: 'variables', icon: <Variable size={14} />, label: 'Variables' },
  { id: 'code', icon: <Code2 size={14} />, label: 'Code' },
]

/**
 * Right-side panel that hosts tabs like Postman:
 * [Variables | Code | ...]
 * Collapsible via a thin icon rail. Used inside the Workbench.
 */
export default function RightPanel() {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const activeTab = useUIStore((s) => s.rightPanelTab)
  const setTab = useUIStore((s) => s.setRightPanelTab)
  const toggleCollapsed = useUIStore((s) => s.toggleRightPanel)

  // Collapsed — show thin icon rail (64px wide) that expands panel when clicked
  if (collapsed) {
    return (
      <div
        className="flex shrink-0 flex-col items-center gap-1 border-l border-[var(--border)] bg-[var(--bg)] py-2"
        style={{ width: 40 }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setTab(tab.id)
            }}
            title={tab.label}
            className="flex cursor-pointer items-center justify-center rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--accent)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {tab.icon}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--white)]"
      style={{ width: 300 }}
    >
      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-0 px-1"
        style={{ borderBottom: '1px solid var(--border)', height: 34, background: 'var(--white)' }}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              title={tab.label}
              className="flex cursor-pointer items-center gap-1.5 px-2.5 transition-colors"
              style={{
                height: 33,
                background: 'transparent',
                border: 'none',
                color: isActive ? 'var(--accent-text)' : 'var(--muted)',
                fontWeight: isActive ? 600 : 400,
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                fontSize: 13,
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          )
        })}

        <div className="flex-1" />

        {/* Collapse button */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Collapse panel"
          className="flex cursor-pointer items-center justify-center rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          style={{ background: 'transparent', border: 'none' }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'variables' && <RunnerVariables fillParent />}
        {activeTab === 'code' && <GenerateCodePane />}
      </div>
    </div>
  )
}

/** Tiny helper export so other parts that want to open a specific tab can */
export function openRightPanelTab(tab: 'variables' | 'code') {
  useUIStore.getState().setRightPanelTab(tab)
}
