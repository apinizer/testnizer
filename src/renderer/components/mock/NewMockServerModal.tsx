/**
 * "New mock server" dialog (issue #140) — ONE creation flow for HTTP mocks
 * and Mock MCP servers: type switch, preset list, Name (prefilled, unique) and
 * Port (suggested, free across both kinds), Create. Enter submits, Escape
 * closes. Mount it only while open: every open starts from fresh state.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMockStore } from '../../stores/mock.store'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { GhostButton, INPUT_CLS, PrimaryButton } from '../mock-mcp/ui'
import NewMockServerPresetPicker from './NewMockServerPresetPicker'
import { uniqueName } from './mock-create-helpers'
import {
  createMockServer,
  DEFAULT_PRESET,
  presetOption,
  suggestMockPort,
  type MockKind,
} from './new-mock-server'

export default function NewMockServerModal({
  initialKind,
  onClose,
}: {
  initialKind: MockKind
  onClose: () => void
}) {
  const { t } = useTranslation()
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const httpServers = useMockStore((s) => s.servers)
  const mcpAll = useMockMcpStore((s) => s.servers)
  const mcpFor = useMockMcpStore((s) => s.projectId)
  const [kind, setKind] = useState<MockKind>(initialKind)
  const [presetId, setPresetId] = useState(DEFAULT_PRESET[initialKind])
  // null = follow the suggestion; a string once the user typed in the field.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = setTimeout(() => nameRef.current?.select(), 50)
    return () => clearTimeout(id)
  }, [])

  const taken = useMemo(() => {
    const mcp = mcpFor && mcpFor === projectId ? mcpAll : []
    const all = [...httpServers, ...mcp]
    return { names: all.map((s) => s.name), ports: all.map((s) => s.port) }
  }, [httpServers, mcpAll, mcpFor, projectId])

  const option = presetOption(kind, presetId)
  const name = nameDraft ?? uniqueName(option.defaultName, taken.names)
  const port = portDraft ?? String(suggestMockPort(kind, taken.ports))
  const portNum = Number(port.trim())
  const portTaken = taken.ports.includes(portNum)

  function chooseKind(next: MockKind): void {
    if (next === kind) return
    setKind(next)
    setPresetId(DEFAULT_PRESET[next])
    setError(null)
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    if (!projectId) return setError(t('mock.noActiveProject'))
    const trimmed = name.trim()
    if (!trimmed) return setError(t('mock.nameRequired'))
    if (!/^\d+$/.test(port.trim()) || portNum < 1 || portNum > 65535) {
      return setError(t('mock.invalidPort'))
    }
    setBusy(true)
    setError(null)
    const err = await createMockServer({ kind, presetId, projectId, name: trimmed, port: portNum })
    if (err) {
      setBusy(false)
      setError(`${t('mock.createFailed')} ${err}`)
      return
    }
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose()
      }}
      title={t('mockNew.title')}
      description={t('mockNew.subtitle')}
      preventClose={busy}
      testId="mock-new-dialog"
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="flex max-h-[calc(100vh-48px)] w-[520px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-[var(--border)] bg-[var(--white)] shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">{t('mockNew.title')}</h2>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">{t('mockNew.subtitle')}</p>
          </div>
          <button
            type="button"
            title={t('mockNew.close')}
            aria-label={t('mockNew.close')}
            disabled={busy}
            onClick={onClose}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <NewMockServerPresetPicker
            kind={kind}
            presetId={presetId}
            onKind={chooseKind}
            onPreset={setPresetId}
          />
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--muted)]">
                {t('mockNew.name')}
              </span>
              <input
                ref={nameRef}
                data-testid="mock-new-name"
                value={name}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={t('mock.namePlaceholder')}
                className={INPUT_CLS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--muted)]">
                {t('mockNew.port')}
              </span>
              <input
                data-testid="mock-new-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPortDraft(e.target.value)}
                className={`${INPUT_CLS} font-mono`}
              />
            </label>
          </div>
          {portTaken && (
            <p
              data-testid="mock-new-port-warning"
              className="-mt-2 text-[11px] text-[var(--orange)]"
            >
              {t('mockNew.portTaken').replace('{port}', String(portNum))}
            </p>
          )}
          {error && (
            <p data-testid="mock-new-error" role="alert" className="text-[12px] text-[var(--red)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <GhostButton disabled={busy} onClick={onClose} data-testid="mock-new-cancel">
            {t('mock.cancel')}
          </GhostButton>
          <PrimaryButton type="submit" disabled={busy} data-testid="mock-new-create">
            {busy && <Loader2 size={12} className="animate-spin" />}
            {t('mock.create')}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
