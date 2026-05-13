import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'

function CopyVarButton({ varKey }: { varKey: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        if (!varKey) return
        try {
          await navigator.clipboard.writeText(`{{${varKey}}}`)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={`Copy {{${varKey}}}`}
      className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 2,
        color: copied ? 'var(--accent)' : 'var(--muted)',
      }}
      onMouseEnter={(e) => {
        if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--accent)'
      }}
      onMouseLeave={(e) => {
        if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--muted)'
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  )
}

interface RunnerVariablesProps {
  environmentId?: string
  fillParent?: boolean
}

export default function RunnerVariables({ environmentId, fillParent }: RunnerVariablesProps) {
  const { t } = useTranslation()
  const environments = useEnvironmentStore((s) => s.environments)
  const globalVariables = useEnvironmentStore((s) => s.globalVariables)
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeEnvironmentId)

  const resolvedEnvId = environmentId || activeEnvironmentId

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === resolvedEnvId),
    [environments, resolvedEnvId],
  )

  const envVars = useMemo(() => {
    if (!activeEnv) return []
    return activeEnv.variables.filter((v) => v.enabled)
  }, [activeEnv])

  const enabledGlobals = useMemo(
    () => (globalVariables || []).filter((v) => v.enabled),
    [globalVariables],
  )

  return (
    <div
      className={
        fillParent
          ? 'flex w-full flex-col overflow-hidden bg-[var(--white)]'
          : 'flex w-[240px] shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--white)]'
      }
      style={{ fontSize: 13 }}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5">
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-text)', margin: 0 }}>
          {t('runnerVars.title')}
        </h3>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Environment section */}
        {activeEnv ? (
          <div className="border-b border-[var(--border)] px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="flex items-center justify-center rounded font-bold text-white"
                style={{ width: 18, height: 18, fontSize: 13, background: '#e86826' }}
              >
                E
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                {activeEnv.name}
              </span>
            </div>

            {envVars.length > 0 ? (
              <table className="w-full">
                <tbody>
                  {envVars.map((v) => (
                    <tr
                      key={v.id}
                      className="group border-b border-[var(--border)] last:border-b-0"
                    >
                      <td className="py-1.5 pr-3" style={{ fontWeight: 500, color: 'var(--text)' }}>
                        {v.key}
                      </td>
                      <td className="py-1.5" style={{ color: 'var(--muted)' }}>
                        {v.value || v.initialValue || (
                          <span className="italic" style={{ color: 'var(--hint)' }}>
                            {t('runnerVars.enterValue')}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2" style={{ width: 18 }}>
                        <CopyVarButton varKey={v.key} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ color: 'var(--hint)' }}>{t('runnerVars.noVariables')}</div>
            )}
          </div>
        ) : (
          <div
            className="border-b border-[var(--border)] px-4 py-3"
            style={{ color: 'var(--hint)' }}
          >
            {t('runnerVars.selectEnv')}
          </div>
        )}

        {/* Globals section */}
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="flex items-center justify-center rounded font-bold text-white"
              style={{ width: 18, height: 18, fontSize: 13, background: '#1a7a4a' }}
            >
              G
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {t('runnerVars.globals')}
            </span>
          </div>

          {enabledGlobals.length > 0 ? (
            <table className="w-full">
              <tbody>
                {enabledGlobals.map((v) => (
                  <tr key={v.id} className="group border-b border-[var(--border)] last:border-b-0">
                    <td className="py-1.5 pr-3" style={{ fontWeight: 500, color: 'var(--text)' }}>
                      {v.key}
                    </td>
                    <td className="py-1.5" style={{ color: 'var(--muted)' }}>
                      {v.value || v.initialValue || (
                        <span className="italic" style={{ color: 'var(--hint)' }}>
                          Enter value
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2" style={{ width: 18 }}>
                      <CopyVarButton varKey={v.key} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: 'var(--hint)' }}>
              {t('runnerVars.noGlobals')}{' '}
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent hover:underline"
                style={{ color: 'var(--accent)', fontSize: 13 }}
                onClick={() => useUIStore.getState().setShowEnvironmentModal(true)}
              >
                {t('runnerVars.add')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
