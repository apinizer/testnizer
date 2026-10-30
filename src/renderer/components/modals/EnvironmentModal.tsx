import { useState, useMemo } from 'react'
import {
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Globe,
  Layers,
  Check,
  Copy,
  Download,
  Upload,
  Search,
  Variable,
  Lock,
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { Environment, EnvironmentVariable, GlobalVariable } from '../../types'
import { buildVariablesExport } from '../../lib/variables-export'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import Modal from '../shared/Modal'
import EmptyState from '../shared/EmptyState'
import { SecretStorageUnencryptedNote } from '../shared/SecretStorageNotes'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { classifyPostmanDocument, isPostmanVariablesKind } from '../../../shared/postman-detect'

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
  const moveToGlobals = useEnvironmentStore((s) => s.moveEnvironmentToProjectVariables)

  const globalVariables = useEnvironmentStore((s) => s.globalVariables)
  const addGlobalVariable = useEnvironmentStore((s) => s.addGlobalVariable)
  const updateGlobalVariable = useEnvironmentStore((s) => s.updateGlobalVariable)
  const deleteGlobalVariable = useEnvironmentStore((s) => s.deleteGlobalVariable)

  const fetchEnvironments = useEnvironmentStore((s) => s.fetchEnvironments)
  const fetchGlobalVariables = useEnvironmentStore((s) => s.fetchGlobalVariables)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const { t, locale } = useTranslation()

  const [pane, setPane] = useState<Pane>({ kind: 'globals' })
  const [creatingEnv, setCreatingEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [deleteEnvTarget, setDeleteEnvTarget] = useState<Environment | null>(null)
  // Issue #281: after "Move to Globals", the environment is deleted only on confirm.
  const [movedEnv, setMovedEnv] = useState<{ env: Environment; conflicts: string[] } | null>(null)
  const [importing, setImporting] = useState(false)

  const selectedEnv: Environment | null = useMemo(() => {
    if (pane.kind !== 'env') return null
    return environments.find((e) => e.id === pane.id) || null
  }, [pane, environments])

  if (!show) return null

  async function handleImportEnvironment(): Promise<void> {
    if (importing || !activeProjectId) return
    setImporting(true)
    try {
      const fileResult = (await window.api?.importExport?.openFile()) as
        | { success: boolean; data?: { content: string } | null; error?: string }
        | undefined
      if (!fileResult?.success || !fileResult.data) {
        // Main refuses a file it will not read here (a .zip: issue #276).
        if (fileResult?.error) toast.error(`${t('env.importFailed')}: ${fileResult.error}`)
        return
      }
      const content = fileResult.data.content

      // Insomnia v5 exports are YAML, not JSON, so we can't JSON.parse them
      // up-front. Detect the v5 shape directly from the raw text and route
      // straight to the Insomnia importer (which handles YAML on the main
      // side). Otherwise fall through to JSON parsing for the JSON formats.
      const isInsomniaV5Yaml = /^\s*type:\s*\S*insomnia\.rest\b/m.test(content)

      let root: Record<string, unknown> = {}
      if (!isInsomniaV5Yaml) {
        try {
          root = JSON.parse(content) as Record<string, unknown>
        } catch (parseErr) {
          toast.error(t('env.importUnknownFormat'))
          console.warn('Environment import: JSON parse failed', parseErr)
          return
        }
      }

      // Auto-detect what kind of file the user picked. Postman environment
      // exports carry `_postman_variable_scope: 'environment'`; Insomnia
      // env-only exports aren't a real shape (Insomnia bundles envs into
      // a collection export) so for Insomnia we route through the same
      // importer that handles the collection — it picks up any environment
      // resources along the way and surfaces them as suggested vars.
      // One shared Postman classifier (issue #276): environment AND globals
      // exports import here (globals → the project Globals, issue #281); any
      // collection kind (v1 / v2 / dump / v3) gets the "use APIs Import" hint.
      const postmanKind = isInsomniaV5Yaml ? null : (classifyPostmanDocument(root)?.kind ?? null)
      const isPostmanEnv = isPostmanVariablesKind(postmanKind)
      const isPostmanCollection = !!postmanKind && !isPostmanEnv
      const isInsomniaV4 =
        !isInsomniaV5Yaml && root['_type'] === 'export' && Array.isArray(root['resources'])
      const isInsomniaV5 =
        isInsomniaV5Yaml ||
        (typeof root['type'] === 'string' && /\binsomnia\.rest\b/.test(root['type'] as string))

      // The IPC wrapper returns `{ success: true, data: importerResult }` on
      // success and `{ success: false, error }` only when the handler itself
      // throws — internal importer failures (e.g. "Project not found",
      // "Postman environment file is missing `name`") arrive as
      // `{ success: true, data: { success: false, error } }`. We must inspect
      // both layers, otherwise a silent failure pops up as "Environment
      // imported" with no env actually created (Mehmet #1 / B8 / B9).
      let result:
        | {
            success: boolean
            data?: {
              success?: boolean
              error?: string
              environmentName?: string
              suggestedEnvVars?: Record<string, string>
              warnings?: string[]
            }
            error?: string
          }
        | undefined

      if (isPostmanEnv) {
        // Use the env-only IPC. The shared importPostman handler now
        // rejects env files outright (so APIs Import doesn't silently
        // create phantom empty folders); env-only callers like this
        // modal go through the dedicated channel instead.
        result = (await window.api?.importExport?.importPostmanEnvironment({
          projectId: activeProjectId,
          content,
        })) as typeof result
      } else if (isPostmanCollection) {
        toast.error(t('env.importPostmanCollectionHint'))
        return
      } else if (isInsomniaV5) {
        result = (await window.api?.importExport?.importInsomniaEnvironment({
          projectId: activeProjectId,
          content,
        })) as typeof result
      } else if (isInsomniaV4) {
        // v4 environments live inside a collection-shaped resources[]
        // array, so we still send them through the collection importer —
        // it picks them out and creates env rows (v1.4.3 #3 fix).
        result = (await window.api?.importExport?.importInsomnia({
          projectId: activeProjectId,
          content,
        })) as typeof result
      } else {
        toast.error(t('env.importUnknownFormat'))
        return
      }

      const ipcOk = result?.success === true
      const importerOk = result?.data?.success !== false
      if (ipcOk && importerOk) {
        // A Postman globals file lands in Globals (issue #281), not in an environment.
        await Promise.all([fetchEnvironments(), fetchGlobalVariables()])
        const name = result?.data?.environmentName
        toast.success(
          name
            ? `${t('env.importSuccess')}: ${name}`
            : isPostmanEnv && postmanKind === 'globals'
              ? t('env.importedToGlobals')
              : t('env.importSuccess'),
        )
        // Nothing silently dropped (issue #276): vault-linked secrets, the
        // Globals note, an inactive imported environment.
        const warnings = result?.data?.warnings ?? []
        if (warnings.length > 0) toast.warning(warnings.join(' · '))
      } else {
        const errMsg = result?.data?.error || result?.error || t('env.unknownError')
        toast.error(`${t('env.importFailed')}: ${errMsg}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`${t('env.importFailed')}: ${message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleMoveToGlobals(env: Environment): Promise<void> {
    try {
      const { moved, conflicts } = await moveToGlobals(env.id)
      toast.success(t('env.moveDone').replace('{count}', String(moved.length)))
      if (conflicts.length > 0) {
        toast.warning(t('env.moveConflicts').replace('{keys}', conflicts.join(', ')))
      }
      setMovedEnv({ env, conflicts })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`${t('env.moveFailed')}: ${message}`)
    }
  }

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
    <Modal open={show} onOpenChange={setShow} title={t('env.title')} testId="environment-modal">
      {/* `lang` makes the CSS `uppercase` headers use Turkish casing
          (Değişken → DEĞİŞKEN, not DEĞIŞKEN). Local to this modal on purpose:
          a global <html lang> would turn leftover English elsewhere into "İ". */}
      <div
        lang={locale}
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
              {t('env.title')}
            </span>
            <button
              type="button"
              aria-label={t('common.close')}
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
            data-testid="env-globals-nav"
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
            {t('env.globals')}
          </button>

          {/* Separator */}
          <div className="px-4 pt-3 pb-1 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {t('env.sectionEnvironments')}
          </div>

          <div className="flex-1 overflow-y-auto">
            {environments.length === 0 && !creatingEnv && (
              <EmptyState icon={Layers} title={t('env.empty')} variant="compact" size="sm" />
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
                  placeholder={t('env.namePlaceholder')}
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

          <div className="flex flex-col gap-2 p-3" style={{ borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              data-testid="env-new"
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
              {t('env.newEnvironment')}
            </button>
            <button
              type="button"
              onClick={handleImportEnvironment}
              disabled={importing || !activeProjectId}
              className="flex w-full cursor-pointer items-center justify-center gap-1 rounded-[6px] py-1.5 disabled:cursor-default disabled:opacity-60"
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontWeight: 500,
              }}
              title={t('env.importEnvironmentHint')}
            >
              <Download size={12} />
              {importing ? t('env.importing') : t('env.importEnvironment')}
            </button>
            {/* Export the selected environment. The CONTENT stays Postman-schema
             *  on purpose (round-trips through the existing Postman-environment
             *  importer, which keys off `_postman_variable_scope` in the body —
             *  not the filename). Only the default FILENAME is Testnizer-native
             *  so exports aren't Postman-branded (issue #7; export added #15). */}
            <button
              type="button"
              data-testid={
                pane.kind === 'globals' ? 'env-export-globals' : 'env-export-environment'
              }
              onClick={() => {
                // Globals pane → a Postman globals export (issue #277); an
                // environment → the environment export. Same Postman shape,
                // `_postman_variable_scope` tells them apart on import.
                const exported = buildVariablesExport(
                  pane.kind === 'globals' ? null : selectedEnv,
                  globalVariables,
                )
                if (!exported) return
                void window.api?.importExport?.saveFile(
                  JSON.stringify(exported.doc, null, 2),
                  exported.fileName,
                )
              }}
              disabled={pane.kind !== 'globals' && !selectedEnv}
              className="flex w-full cursor-pointer items-center justify-center gap-1 rounded-[6px] py-1.5 disabled:cursor-default disabled:opacity-60"
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                fontWeight: 500,
              }}
              title={
                pane.kind === 'globals'
                  ? t('env.exportGlobalsHint')
                  : selectedEnv
                    ? t('env.exportEnvironmentHint')
                    : t('env.exportEnvironmentSelectHint')
              }
            >
              <Upload size={12} />
              {pane.kind === 'globals' ? t('env.exportGlobals') : t('env.exportEnvironment')}
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
              onMoveToGlobals={() => void handleMoveToGlobals(selectedEnv)}
              onVarChange={handleVarChange}
              onAddVar={handleAddVar}
              onRemoveVar={handleRemoveVar}
            />
          ) : (
            <div
              className="flex h-full items-center justify-center"
              style={{ color: 'var(--hint)' }}
            >
              {t('env.selectFromSidebar')}
            </div>
          )}
        </div>
      </div>

      <DeleteConfirmDialog
        open={!!deleteEnvTarget}
        itemName={deleteEnvTarget?.name || ''}
        itemType={t('env.itemType')}
        onConfirm={() => {
          if (deleteEnvTarget) {
            deleteEnvironment(deleteEnvTarget.id)
            setPane({ kind: 'globals' })
          }
          setDeleteEnvTarget(null)
        }}
        onCancel={() => setDeleteEnvTarget(null)}
      />

      {/* After "Move to Globals": the environment goes only on confirm, and
          the dialog names the variables whose value it still holds alone. */}
      <DeleteConfirmDialog
        open={!!movedEnv}
        itemName={movedEnv?.env.name || ''}
        itemType={t('env.itemType')}
        description={
          movedEnv && movedEnv.conflicts.length > 0
            ? t('env.moveDeleteConflicts').replace('{keys}', movedEnv.conflicts.join(', '))
            : t('env.moveDeleteDesc')
        }
        onConfirm={() => {
          if (movedEnv) {
            void deleteEnvironment(movedEnv.env.id)
            setPane({ kind: 'globals' })
          }
          setMovedEnv(null)
        }}
        onCancel={() => setMovedEnv(null)}
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
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex shrink-0 items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="text-[15px] font-semibold" style={{ color: 'var(--heading)' }}>
            {t('env.globals')}
          </div>
          <div style={{ color: 'var(--muted)' }}>{t('env.globalsDescription')}</div>
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
  onMoveToGlobals,
  onVarChange,
  onAddVar,
  onRemoveVar,
}: {
  env: Environment
  isActive: boolean
  onSetActive: () => void
  onDelete: () => void
  onMoveToGlobals: () => void
  onVarChange: (
    id: string,
    field: 'key' | 'initialValue' | 'value' | 'enabled' | 'secret',
    val: string | boolean,
  ) => void
  onAddVar: () => void
  onRemoveVar: (id: string) => void
}) {
  const { t } = useTranslation()
  const count = env.variables.length
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
                {t('env.active')}
              </span>
            )}
          </div>
          <div style={{ color: 'var(--muted)' }}>
            {count === 1
              ? t('env.variableCountOne')
              : t('env.variableCount').replace('{count}', String(count))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isActive && (
            <button
              type="button"
              data-testid="env-set-active"
              onClick={onSetActive}
              className="cursor-pointer rounded px-2.5 py-1"
              style={{
                background: 'var(--accent)',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              {t('env.setActive')}
            </button>
          )}
          <button
            type="button"
            data-testid="env-move-to-project-vars"
            onClick={onMoveToGlobals}
            disabled={count === 0}
            className="flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 disabled:cursor-default disabled:opacity-60"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontWeight: 500,
            }}
            title={t('env.moveToGlobalsHint')}
          >
            <Globe size={12} aria-hidden="true" />
            {t('env.moveToGlobals')}
          </button>
          <button
            type="button"
            data-testid="env-delete"
            onClick={onDelete}
            className="cursor-pointer rounded p-1.5"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
            title={t('env.deleteEnvironment')}
            aria-label={t('env.deleteEnvironment')}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <VarTable
        // Remount per environment: a filter belongs to the list you typed it
        // over, and carrying it across a switch would greet the next
        // environment with an empty-looking table.
        key={env.id}
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
  /** Issue #239: main could not decrypt the stored secret on this computer. */
  decryptFailed?: boolean
}

/**
 * Substring match over the three fields the user can actually read in the
 * table. Values are searched as well as names (issue #95 asked for both):
 * a secret's value is masked on screen but the per-row reveal toggle is
 * unconditional, so excluding secrets would only make the search quietly
 * incomplete without protecting anything.
 *
 * Plain `toLowerCase`, not the Turkish locale variant — variable names are
 * identifiers, and `'ID'.toLocaleLowerCase('tr')` is `'ıd'`, which would stop
 * `id` from matching `ProjectID`.
 */
function matchesQuery(v: VarRow, needle: string): boolean {
  return (
    v.key.toLowerCase().includes(needle) ||
    (v.initialValue ?? '').toLowerCase().includes(needle) ||
    v.value.toLowerCase().includes(needle)
  )
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
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  // The row the user is typing in. Renaming a key can make it stop matching
  // the filter, and dropping it right then would pull the input out from under
  // the cursor mid-keystroke — so a focused row stays visible until the search
  // itself changes.
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()

  const matchCount = useMemo(
    () => (needle ? variables.filter((v) => matchesQuery(v, needle)).length : variables.length),
    [variables, needle],
  )

  const shown = useMemo(
    () =>
      needle ? variables.filter((v) => v.id === focusedId || matchesQuery(v, needle)) : variables,
    [variables, needle, focusedId],
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Issue #239: shown only when the OS keychain cannot encrypt secrets.
          `py-2` like the search row below it, so the note never touches the
          table's column header when there is no search row. */}
      <SecretStorageUnencryptedNote className="shrink-0 px-5 py-2" />
      {/* What "secret" means, said once and always visible (issue #257) —
          the tooltips alone were the status quo nobody found. */}
      {variables.some((v) => v.secret) && (
        <div
          data-testid="env-secret-note"
          role="note"
          className="flex shrink-0 items-start gap-1.5 px-5 py-2 text-[11px] text-[var(--muted)]"
        >
          <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('env.secretStaysLocal')}</span>
        </div>
      )}
      {/* Search — only meaningful once there is something to search. */}
      {variables.length > 0 && (
        <div className="shrink-0 px-5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <div
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5"
            style={{ background: 'var(--surface)', border: '1.5px solid var(--border2)' }}
          >
            <Search size={13} style={{ color: 'var(--hint)', flexShrink: 0 }} aria-hidden="true" />
            <input
              data-testid="env-var-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setFocusedId(null)
              }}
              // No Escape-to-clear here: Radix's dialog listens for Escape on
              // `document` in the capture phase, so it closes the modal before
              // anything in the React tree can intercept the key. Clearing the
              // filter *and* closing the modal is worse than just closing it —
              // the clear button next to this input is the honest affordance.
              placeholder={t('env.searchPlaceholder')}
              aria-label={t('env.searchPlaceholder')}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: 'var(--text)',
                width: '100%',
                fontFamily: 'inherit',
              }}
            />
            {needle && (
              <>
                <span
                  data-testid="env-var-search-count"
                  title={t('env.searchMatchHint')}
                  style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}
                >
                  {matchCount} / {variables.length}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setFocusedId(null)
                  }}
                  aria-label={t('env.searchClear')}
                  title={t('env.searchClear')}
                  className="flex cursor-pointer items-center justify-center"
                  style={{ background: 'transparent', border: 'none', color: 'var(--hint)' }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header row */}
      <div
        className="grid shrink-0 items-center px-5 py-2 font-medium uppercase tracking-wide"
        style={{
          gridTemplateColumns: '22px minmax(0,1fr) 100px minmax(0,1fr) minmax(0,1fr) 28px 28px',
          gap: 12,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--muted)',
        }}
      >
        <span />
        <span>{t('env.colVariable')}</span>
        <span title={t('env.secretStaysLocal')}>{t('env.colType')}</span>
        <span>{t('env.colInitialValue')}</span>
        <span>{t('env.colCurrentValue')}</span>
        <span />
        <span />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {shown.map((v) => (
          <VarRowView
            key={v.id}
            variable={v}
            onFocus={() => setFocusedId(v.id)}
            onUpdate={(u) => onUpdate(v.id, u)}
            onRemove={() => onRemove(v.id)}
          />
        ))}

        {/* Review #12: "no match" only for an actual search; an empty list is
            its own state (the Add Variable button right below is the action). */}
        {variables.length === 0 && (
          <div data-testid="env-var-empty">
            <EmptyState
              icon={Variable}
              title={t('env.noVariables')}
              description={t('env.noVariablesHint')}
              variant="compact"
              size="sm"
            />
          </div>
        )}
        {shown.length === 0 && variables.length > 0 && (
          <div
            data-testid="env-var-no-match"
            className="px-5 py-6 text-center"
            style={{ color: 'var(--hint)' }}
          >
            {t('env.searchNoMatch')}
          </div>
        )}

        <button
          type="button"
          data-testid="env-var-add"
          // A new row starts with an empty key, so an active filter would hide
          // it the instant it is created and the button would read as broken.
          onClick={() => {
            setQuery('')
            setFocusedId(null)
            onAdd()
          }}
          className="m-4 flex w-[calc(100%-2rem)] cursor-pointer items-center justify-center gap-1 rounded-[6px] border border-dashed py-2"
          style={{
            borderColor: 'var(--border2)',
            background: 'transparent',
            color: 'var(--muted)',
          }}
        >
          <Plus size={12} />
          {t('env.addVariable')}
        </button>
      </div>
    </div>
  )
}

function VarRowView({
  variable,
  onUpdate,
  onRemove,
  onFocus,
}: {
  variable: VarRow
  onUpdate: (updates: Partial<VarRow>) => void
  onRemove: () => void
  onFocus?: () => void
}) {
  const { t } = useTranslation()
  const [showCurrent, setShowCurrent] = useState(false)
  const [copied, setCopied] = useState(false)
  // Undecryptable until the user types a new value (issue #239).
  const locked = !!variable.decryptFailed && !variable.value
  // A secret's dots read like an error in the value colour (orange); secrets
  // stay neutral, masked or revealed (issue #257). Other rows keep it.
  const valueColor = variable.secret ? 'var(--text)' : 'var(--json-string)'

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
      data-testid="env-var-row"
      onFocusCapture={onFocus}
      className="grid items-center px-5"
      style={{
        // Seven tracks for seven cells, matching the header above. One short
        // and the remove button wrapped onto a second line, left-aligned under
        // the checkbox and doubling every row's height.
        gridTemplateColumns: '22px minmax(0,1fr) 100px minmax(0,1fr) minmax(0,1fr) 28px 28px',
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
        data-testid="env-var-key"
        value={variable.key}
        onChange={(e) => onUpdate({ key: e.target.value })}
        placeholder={t('env.varNamePlaceholder')}
        style={INPUT}
      />

      {/* Type */}
      <select
        data-testid="env-var-type"
        value={variable.secret ? 'secret' : 'default'}
        onChange={(e) => onUpdate({ secret: e.target.value === 'secret' })}
        // What "secret" means for sharing (issue #177).
        title={t('env.secretStaysLocal')}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '3px 6px',
          color: 'var(--muted)',
        }}
      >
        {/* Values stay 'default' / 'secret' — e2e selects by value. */}
        <option value="default">{t('env.typeDefault')}</option>
        <option value="secret" title={t('env.secretStaysLocal')}>
          {t('env.typeSecret')}
        </option>
      </select>

      {/* Initial Value */}
      <input
        data-testid="env-var-initial"
        value={variable.initialValue || ''}
        onChange={(e) => onUpdate({ initialValue: e.target.value })}
        placeholder="—"
        type={variable.secret && !showCurrent ? 'password' : 'text'}
        title={variable.secret ? t('env.secretStaysLocal') : undefined}
        // min-w-0: the grid track can shrink, the dots are not clipped (#257).
        className="min-w-0"
        style={{ ...INPUT, color: valueColor }}
      />

      {/* Current Value — with show/hide toggle for secrets */}
      <div className="flex min-w-0 items-center gap-1">
        <input
          data-testid="env-var-current"
          value={variable.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          // The Current Value falls back to the Initial Value when empty, and
          // that inherited value was shown via the placeholder — but
          // placeholders are never masked by type="password", so a secret's
          // value leaked in plain text (issue #13). Mask the placeholder hint
          // for hidden secrets while keeping the inherited-value affordance.
          placeholder={
            locked
              ? t('env.decryptFailed')
              : variable.secret && !showCurrent
                ? variable.initialValue
                  ? '••••••'
                  : '—'
                : variable.initialValue || '—'
          }
          // Issue #239: the stored secret cannot be decrypted on this computer.
          title={
            locked
              ? t('env.decryptFailed')
              : variable.secret
                ? t('env.secretStaysLocal')
                : undefined
          }
          data-decrypt-failed={locked || undefined}
          type={variable.secret && !showCurrent && !locked ? 'password' : 'text'}
          className="min-w-0"
          style={{
            ...INPUT,
            color: valueColor,
            ...(locked ? { boxShadow: 'inset 0 0 0 1px var(--red)' } : {}),
          }}
        />
        {variable.secret && (
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            aria-label={showCurrent ? t('env.hideValue') : t('env.showValue')}
            title={showCurrent ? t('env.hideValue') : t('env.showValue')}
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
        title={
          variable.key
            ? t('env.copyReference').replace('{ref}', `{{${variable.key}}}`)
            : t('env.copyNeedsName')
        }
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
        aria-label={t('env.removeVariable')}
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
