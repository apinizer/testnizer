import { useState, useMemo } from 'react'
import { X, Plus, Trash2, Eye, EyeOff, Globe, Layers, Check, Copy } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import type { Environment, EnvironmentVariable, GlobalVariable } from '../../types'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import Modal from '../shared/Modal'
import EmptyState from '../shared/EmptyState'

type Pane = { kind: 'globals' } | { kind: 'env'; id: string }

/**
 * Postman-style Environment Manager.
 *
 * Layout:
 *   ┌──────────────┬───────────────────────────────────────────┐
 *   │ Globals      │  Globals                                  │
 *   │ ─────        │                                           │
 *   │ Environments │  Variable   │ Type │ Initial │ Current    │
 *   │  Production  │             ...                           │
 *   │  Staging [✓] │                                           │
 *   └──────────────┴───────────────────────────────────────────┘
 *
 * Scoped to the **currently active project** — environments and globals are
 * loaded from `environment.store` (which calls listByProject).
 */
export default function EnvironmentModal() {
  const show = useUIStore((s) => s.showEnvironmentModal)
  const setShow = useUIStore((s) => s.setShowEnvironmentModal)

  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const setActiveEnv = useEnvironmentStore((s) => s.setActiveEnvironment)
  const updateEnvironment = useEnvironmentStore((s) => s.updateEnvironment)
  const deleteEnvironment = useEnvironmentStore((s) => s.deleteEnvironment)
  const createEnvironment = useEnvironmentStore((s) => s.createEnvironment)

  const globalVariables = useEnvironmentStore((s) => s.globalVariables)
  const addGlobalVariable = useEnvironmentStore((s) => s.addGlobalVariable)
  const updateGlobalVariable = useEnvironmentStore((s) => s.updateGlobalVariable)
  const deleteGlobalVariable = useEnvironmentStore((s) => s.deleteGlobalVariable)

  const [pane, setPane] = useState<Pane>({ kind: 'globals' })
  const [creatingEnv, setCreatingEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [deleteEnvTarget, setDeleteEnvTarget] = useState<Environment | null>(null)

  const selectedEnv: Environment | null = useMemo(() => {
    if (pane.kind !== 'env') return null
    return environments.find((e) => e.id === pane.id) || null
  }, [pane, environments])

  if (!show) return null

  async function handleCreateEnv() {
    const name = newEnvName.trim()
    if (!name) return
    // Snapshot existing ids so we can identify the freshly-created env.
    const before = new Set(useEnvironmentStore.getState().environments.map((e) => e.id))
    await createEnvironment(name)
    const after = useEnvironmentStore.getState().environments
    const created = after.find((e) => !before.has(e.id))
    setNewEnvName('')
    setCreatingEnv(false)
    if (created) {
      // Auto-switch the right pane to the new env so the user can start
      // adding variables immediately (matches Postman UX).
      setPane({ kind: 'env', id: created.id })
    }
  }

  function handleVarChange(
    varId: string,
    field: 'key' | 'initialValue' | 'value' | 'enabled' | 'secret',
    newValue: string | boolean,
  ) {
    if (!selectedEnv) return
    const updatedVars = selectedEnv.variables.map((v) =>
      v.id === varId ? { ...v, [field]: newValue } : v,
    )
    updateEnvironment(selectedEnv.id, { variables: updatedVars })
  }

  function handleAddVar() {
    if (!selectedEnv) return
    const newVar: EnvironmentVariable = {
      id: Math.random().toString(36).slice(2, 10),
      key: '',
      value: '',
      initialValue: '',
      enabled: true,
      secret: false,
    }
    updateEnvironment(selectedEnv.id, {
      variables: [...selectedEnv.variables, newVar],
    })
  }

  function handleRemoveVar(varId: string) {
    if (!selectedEnv) return
    updateEnvironment(selectedEnv.id, {
      variables: selectedEnv.variables.filter((v) => v.id !== varId),
    })
  }

  return (
    <Modal open={show} onOpenChange={setShow} title="Environments" zIndex={9000}>
      <div
        className="flex overflow-hidden rounded-[12px]"
        style={{
          width: 960,
          height: 600,
          maxWidth: '96%',
          maxHeight: '92%',
          background: 'var(--white)',
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Left: navigation */}
        <div
          className="flex w-[230px] shrink-0 flex-col"
          style={{
            background: 'var(--surface)',
            borderRight: '1px solid var(--border)',
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--text)' }}>
              Environments
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShow(false)}
              className="cursor-pointer"
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Globals link */}
          <button
            type="button"
            onClick={() => setPane({ kind: 'globals' })}
            className="flex cursor-pointer items-center gap-2 px-4 py-2 text-left"
            style={{
              background: pane.kind === 'globals' ? 'var(--accent-light)' : 'transparent',
              border: 'none',
              color: pane.kind === 'globals' ? 'var(--accent-text)' : 'var(--text)',
              fontWeight: pane.kind === 'globals' ? 600 : 400,
            }}
          >
            <Globe size={13} />
            Globals
          </button>

          {/* Separator */}
          <div className="px-4 pt-3 pb-1 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Environments
          </div>

          <div className="flex-1 overflow-y-auto">
            {environments.length === 0 && !creatingEnv && (
              <EmptyState icon={Layers} title="No environments yet." variant="compact" size="sm" />
            )}
            {environments.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => setPane({ kind: 'env', id: env.id })}
                className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left"
                style={{
                  background:
                    pane.kind === 'env' && pane.id === env.id
                      ? 'var(--accent-light)'
                      : 'transparent',
                  border: 'none',
                  color:
                    pane.kind === 'env' && pane.id === env.id
                      ? 'var(--accent-text)'
                      : 'var(--text)',
                  fontWeight: pane.kind === 'env' && pane.id === env.id ? 600 : 400,
                }}
              >
                <Layers size={13} style={{ color: 'var(--muted)' }} />
                <span className="flex-1 truncate">{env.name}</span>
                {env.id === activeEnvId && <Check size={12} style={{ color: 'var(--green)' }} />}
              </button>
            ))}

            {creatingEnv && (
              <div className="flex items-center gap-1 px-3 py-1.5">
                <input
                  autoFocus
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateEnv()
                    if (e.key === 'Escape') {
                      setCreatingEnv(false)
                      setNewEnvName('')
                    }
                  }}
                  placeholder="Environment name"
                  className="flex-1 rounded border px-2 py-1 outline-none"
                  style={{
                    borderColor: 'var(--accent)',
                    background: 'var(--white)',
                    color: 'var(--text)',
                  }}
                />
              </div>
            )}
          </div>

          <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setCreatingEnv(true)}
              className="flex w-full cursor-pointer items-center justify-center gap-1 rounded-[6px] py-1.5"
              style={{
                background: 'var(--accent)',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              <Plus size={12} />
              New Environment
            </button>
          </div>
        </div>

        {/* Right: pane */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {pane.kind === 'globals' ? (
            <GlobalsPane
              globals={globalVariables}
              onAdd={addGlobalVariable}
              onUpdate={updateGlobalVariable}
              onDelete={deleteGlobalVariable}
            />
          ) : selectedEnv ? (
            <EnvPane
              env={selectedEnv}
              isActive={selectedEnv.id === activeEnvId}
              onSetActive={() => setActiveEnv(selectedEnv.id)}
              onDelete={() => setDeleteEnvTarget(selectedEnv)}
              onVarChange={handleVarChange}
              onAddVar={handleAddVar}
              onRemoveVar={handleRemoveVar}
            />
          ) : (
            <div
              className="flex h-full items-center justify-center"
              style={{ color: 'var(--hint)' }}
            >
              Select an environment from the sidebar.
            </div>
          )}
        </div>
      </div>

      <DeleteConfirmDialog
        open={!!deleteEnvTarget}
        itemName={deleteEnvTarget?.name || ''}
        itemType="environment"
        onConfirm={() => {
          if (deleteEnvTarget) {
            deleteEnvironment(deleteEnvTarget.id)
            setPane({ kind: 'globals' })
          }
          setDeleteEnvTarget(null)
        }}
        onCancel={() => setDeleteEnvTarget(null)}
      />
    </Modal>
  )
}

// ────────────────────────────────────────────────────────────────
// Globals pane
// ────────────────────────────────────────────────────────────────

function GlobalsPane({
  globals,
  onAdd,
  onUpdate,
  onDelete,
}: {
  globals: GlobalVariable[]
  onAdd: (v: Partial<GlobalVariable>) => void
  onUpdate: (id: string, updates: Partial<GlobalVariable>) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
            Globals
          </div>
          <div style={{ color: 'var(--muted)' }}>
            A global variable can be accessed anywhere inside this project.
          </div>
        </div>
      </div>

      <VarTable
        variables={globals}
        onUpdate={(id, updates) => onUpdate(id, updates as Partial<GlobalVariable>)}
        onRemove={onDelete}
        onAdd={() => onAdd({ key: '', value: '', initialValue: '', enabled: true, secret: false })}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Env pane
// ────────────────────────────────────────────────────────────────

function EnvPane({
  env,
  isActive,
  onSetActive,
  onDelete,
  onVarChange,
  onAddVar,
  onRemoveVar,
}: {
  env: Environment
  isActive: boolean
  onSetActive: () => void
  onDelete: () => void
  onVarChange: (
    id: string,
    field: 'key' | 'initialValue' | 'value' | 'enabled' | 'secret',
    val: string | boolean,
  ) => void
  onAddVar: () => void
  onRemoveVar: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
              {env.name}
            </div>
            {isActive && (
              <span
                className="rounded-full px-2 py-[1px] font-medium"
                style={{
                  background: 'var(--green-bg)',
                  color: 'var(--green)',
                  border: '1px solid var(--green-border)',
                }}
              >
                Active
              </span>
            )}
          </div>
          <div style={{ color: 'var(--muted)' }}>{env.variables.length} variables</div>
        </div>
        <div className="flex items-center gap-2">
          {!isActive && (
            <button
              type="button"
              onClick={onSetActive}
              className="cursor-pointer rounded px-2.5 py-1"
              style={{
                background: 'var(--accent)',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              Set Active
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="cursor-pointer rounded p-1.5"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
            title="Delete environment"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <VarTable
        variables={env.variables}
        onUpdate={(id, updates) => {
          for (const k of Object.keys(updates) as Array<keyof typeof updates>) {
            onVarChange(
              id,
              k as 'key' | 'initialValue' | 'value' | 'enabled' | 'secret',
              updates[k] as string | boolean,
            )
          }
        }}
        onRemove={onRemoveVar}
        onAdd={onAddVar}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Shared variable table (Postman-style with Initial/Current columns)
// ────────────────────────────────────────────────────────────────

interface VarRow {
  id: string
  key: string
  value: string
  initialValue?: string
  enabled: boolean
  secret: boolean
}

function VarTable({
  variables,
  onUpdate,
  onRemove,
  onAdd,
}: {
  variables: VarRow[]
  onUpdate: (id: string, updates: Partial<VarRow>) => void
  onRemove: (id: string) => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header row */}
      <div
        className="grid shrink-0 items-center px-5 py-2 font-medium uppercase tracking-wide"
        style={{
          gridTemplateColumns: '22px 1fr 100px 1fr 1fr 28px 28px',
          gap: 12,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--muted)',
        }}
      >
        <span />
        <span>Variable</span>
        <span>Type</span>
        <span>Initial Value</span>
        <span>Current Value</span>
        <span />
        <span />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {variables.map((v) => (
          <VarRowView
            key={v.id}
            variable={v}
            onUpdate={(u) => onUpdate(v.id, u)}
            onRemove={() => onRemove(v.id)}
          />
        ))}

        <button
          type="button"
          onClick={onAdd}
          className="m-4 flex w-[calc(100%-2rem)] cursor-pointer items-center justify-center gap-1 rounded-[6px] border border-dashed py-2"
          style={{
            borderColor: 'var(--border2)',
            background: 'transparent',
            color: 'var(--muted)',
          }}
        >
          <Plus size={12} />
          Add Variable
        </button>
      </div>
    </div>
  )
}

function VarRowView({
  variable,
  onUpdate,
  onRemove,
}: {
  variable: VarRow
  onUpdate: (updates: Partial<VarRow>) => void
  onRemove: () => void
}) {
  const [showCurrent, setShowCurrent] = useState(false)
  const [copied, setCopied] = useState(false)

  const INPUT: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '6px 4px',
    fontSize: 13,
    color: 'var(--text)',
    outline: 'none',
    fontFamily: 'var(--font-mono)',
  }

  return (
    <div
      className="grid items-center px-5"
      style={{
        gridTemplateColumns: '22px 1fr 100px 1fr 1fr 28px',
        gap: 12,
        borderBottom: '1px solid var(--border-split)',
      }}
    >
      {/* Enabled checkbox */}
      <input
        type="checkbox"
        checked={variable.enabled}
        onChange={(e) => onUpdate({ enabled: e.target.checked })}
        style={{ accentColor: 'var(--accent)' }}
      />

      {/* Key */}
      <input
        value={variable.key}
        onChange={(e) => onUpdate({ key: e.target.value })}
        placeholder="variable_name"
        style={INPUT}
      />

      {/* Type */}
      <select
        value={variable.secret ? 'secret' : 'default'}
        onChange={(e) => onUpdate({ secret: e.target.value === 'secret' })}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '3px 6px',
          color: 'var(--muted)',
        }}
      >
        <option value="default">default</option>
        <option value="secret">secret</option>
      </select>

      {/* Initial Value */}
      <input
        value={variable.initialValue || ''}
        onChange={(e) => onUpdate({ initialValue: e.target.value })}
        placeholder="—"
        type={variable.secret && !showCurrent ? 'password' : 'text'}
        style={{ ...INPUT, color: 'var(--json-string)' }}
      />

      {/* Current Value — with show/hide toggle for secrets */}
      <div className="flex items-center gap-1">
        <input
          value={variable.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={variable.initialValue || '—'}
          type={variable.secret && !showCurrent ? 'password' : 'text'}
          style={{ ...INPUT, color: 'var(--json-string)' }}
        />
        {variable.secret && (
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            className="cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', padding: 2 }}
          >
            {showCurrent ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>

      {/* Copy {{var}} reference */}
      <button
        type="button"
        onClick={async () => {
          if (!variable.key) return
          try {
            await navigator.clipboard.writeText(`{{${variable.key}}}`)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          } catch {
            // ignore clipboard failures
          }
        }}
        title={variable.key ? `Copy {{${variable.key}}}` : 'Set a variable name first'}
        disabled={!variable.key}
        className="flex cursor-pointer items-center justify-center"
        style={{
          background: 'transparent',
          border: 'none',
          color: copied ? 'var(--accent)' : 'var(--hint)',
          padding: 4,
          opacity: variable.key ? 1 : 0.4,
          cursor: variable.key ? 'pointer' : 'not-allowed',
        }}
        onMouseEnter={(e) => {
          if (variable.key && !copied)
            (e.currentTarget as HTMLElement).style.color = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--hint)'
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="flex cursor-pointer items-center justify-center"
        style={{ background: 'transparent', border: 'none', color: 'var(--hint)', padding: 4 }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.color = 'var(--red)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.color = 'var(--hint)'
        }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}
