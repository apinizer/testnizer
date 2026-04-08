import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'

export default function EnvironmentModal() {
  const show = useUIStore((s) => s.showEnvironmentModal)
  const setShow = useUIStore((s) => s.setShowEnvironmentModal)
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const setActiveEnv = useEnvironmentStore((s) => s.setActiveEnvironment)
  const updateEnvironment = useEnvironmentStore((s) => s.updateEnvironment)
  const deleteEnvironment = useEnvironmentStore((s) => s.deleteEnvironment)

  const [selectedEnvId, setSelectedEnvId] = useState(activeEnvId || environments[0]?.id || '')

  if (!show) return null

  const selectedEnv = environments.find((e) => e.id === selectedEnvId)

  const handleVarChange = (varId: string, field: 'key' | 'value', newValue: string) => {
    if (!selectedEnv) return
    const updatedVars = selectedEnv.variables.map((v) =>
      v.id === varId ? { ...v, [field]: newValue } : v
    )
    updateEnvironment(selectedEnv.id, { variables: updatedVars })
  }

  const handleAddVar = () => {
    if (!selectedEnv) return
    const newVar = {
      id: Math.random().toString(36).substring(2, 10),
      key: '',
      value: '',
      enabled: true,
      secret: false,
    }
    updateEnvironment(selectedEnv.id, {
      variables: [...selectedEnv.variables, newVar],
    })
  }

  const handleRemoveVar = (varId: string) => {
    if (!selectedEnv) return
    updateEnvironment(selectedEnv.id, {
      variables: selectedEnv.variables.filter((v) => v.id !== varId),
    })
  }

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.28)' }}
      onClick={() => setShow(false)}
    >
      <div
        className="flex h-[500px] w-[700px] max-w-[95%] overflow-hidden rounded-[14px] bg-[var(--white)]"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: environment list */}
        <div className="flex w-[200px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <span className="text-sm font-bold">Environments</span>
            <button
              type="button"
              className="cursor-pointer rounded bg-[var(--accent)] p-1 text-white"
              style={{ border: 'none' }}
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {environments.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => setSelectedEnvId(env.id)}
                className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm transition-colors"
                style={{
                  background: selectedEnvId === env.id ? 'var(--accent-light)' : 'transparent',
                  color: selectedEnvId === env.id ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: selectedEnvId === env.id ? 500 : 400,
                  border: 'none',
                }}
              >
                <span>{env.name}</span>
                {env.id === activeEnvId && (
                  <span className="rounded-full bg-[var(--green-bg)] px-1.5 py-0.5 text-[0.643rem] text-[var(--green)]">
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: variable editor */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">{selectedEnv?.name || 'Select'}</span>
              {selectedEnv && selectedEnv.id !== activeEnvId && (
                <button
                  type="button"
                  onClick={() => setActiveEnv(selectedEnv.id)}
                  className="cursor-pointer rounded bg-[var(--accent)] px-2 py-0.5 text-[0.875rem] text-white"
                  style={{ border: 'none' }}
                >
                  Set Active
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedEnv && (
                <button
                  type="button"
                  onClick={() => {
                    deleteEnvironment(selectedEnv.id)
                    setSelectedEnvId(environments[0]?.id || '')
                  }}
                  className="cursor-pointer text-[var(--hint)] hover:text-[var(--red)]"
                  style={{ background: 'transparent', border: 'none' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShow(false)}
                className="cursor-pointer text-[var(--hint)] hover:text-[var(--text)]"
                style={{ background: 'transparent', border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Variables table */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedEnv && (
              <>
                <div className="mb-2 grid grid-cols-[1fr_1fr_28px] gap-2 text-[0.875rem] font-medium text-[var(--muted)]">
                  <span>Variable</span>
                  <span>Value</span>
                  <span />
                </div>
                {selectedEnv.variables.map((v) => (
                  <div key={v.id} className="mb-1.5 grid grid-cols-[1fr_1fr_28px] gap-2">
                    <input
                      value={v.key}
                      onChange={(e) => handleVarChange(v.id, 'key', e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      placeholder="Variable name"
                    />
                    <input
                      value={v.value}
                      onChange={(e) => handleVarChange(v.id, 'value', e.target.value)}
                      type={v.secret ? 'password' : 'text'}
                      className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-sm text-[var(--orange)] outline-none focus:border-[var(--accent)]"
                      placeholder="Value"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveVar(v.id)}
                      className="flex cursor-pointer items-center justify-center text-[var(--hint)] hover:text-[var(--red)]"
                      style={{ background: 'transparent', border: 'none' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddVar}
                  className="mt-2 w-full cursor-pointer rounded-[7px] border border-dashed border-[var(--border2)] bg-transparent py-1.5 text-sm text-[var(--hint)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  + Add Variable
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
