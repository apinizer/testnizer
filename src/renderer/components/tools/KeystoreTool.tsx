import { useEffect, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { useKeystoreStore } from '../../stores/keystore.store'
import { useTabsStore } from '../../stores/tabs.store'
import type { KeystoreLibraryEntry, KeystorePickFileResult, KeystoreType } from '../../types'
import AliasTable from './keystore/AliasTable'
import CertificateDetailDialog from './keystore/CertificateDetailDialog'
import ChangeStorePasswordDialog from './keystore/ChangeStorePasswordDialog'
import ConfirmDialog from './keystore/ConfirmDialog'
import ConvertDialog from './keystore/ConvertDialog'
import EntryPasswordPromptDialog from './keystore/EntryPasswordPromptDialog'
import ExportCertificateDialog from './keystore/ExportCertificateDialog'
import GenerateKeyPairDialog from './keystore/GenerateKeyPairDialog'
import GenerateSecretKeyDialog from './keystore/GenerateSecretKeyDialog'
import ImportDialog from './keystore/ImportDialog'
import RenameAliasDialog from './keystore/RenameAliasDialog'
import SetEntryPasswordDialog from './keystore/SetEntryPasswordDialog'
import { LabeledInput, LabeledSelect, Modal, ModalActions } from './keystore/dialog-ui'

type PasswordPrompt =
  | { kind: 'file'; pick: KeystorePickFileResult }
  | { kind: 'library'; id: string; name: string }

/** An alias-scoped B4 dialog (opened from a row action menu). */
type RowDialog = { kind: 'rename' | 'setEntryPw' | 'export' | 'delete'; alias: string }

export default function KeystoreTool() {
  const { t } = useTranslation()
  const s = useKeystoreStore()

  const [pwPrompt, setPwPrompt] = useState<PasswordPrompt | null>(null)
  const [pwValue, setPwValue] = useState('')
  const [pwType, setPwType] = useState<KeystoreType>('PKCS12')
  const [createOpen, setCreateOpen] = useState(false)
  const [createType, setCreateType] = useState<KeystoreType>('PKCS12')
  const [createPw, setCreatePw] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveRemember, setSaveRemember] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [genKeyPairOpen, setGenKeyPairOpen] = useState(false)
  const [genSecretOpen, setGenSecretOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // Faz B4 dialogs
  const [rowDialog, setRowDialog] = useState<RowDialog | null>(null)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [discardPrompt, setDiscardPrompt] = useState(false)

  useEffect(() => {
    // Clear FIRST. The store is a module-level singleton, so an error from an
    // earlier action outlives this component — testers opened Keystore Studio to
    // a red "Store password cannot be empty" without having typed anything,
    // because the TLS Inspector's "Create keystore & add" had failed earlier and
    // left its message behind.
    s.clearError()
    void s.loadLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dirty-guard (§9.7): mirror the session dirty flag onto the Keystore tool tab
  // so the shared `closeTabSafely` window.confirm guards a tool-tab close, and
  // warn the OS before the whole window/app closes on a dirty session.
  const dirty = s.dirty
  useEffect(() => {
    const tab = useTabsStore.getState().tabs.find((tb) => tb.protocol === 'tools.keystore')
    if (tab) useTabsStore.getState().markDirty(tab.id, dirty)
  }, [dirty])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function handleOpen(): Promise<void> {
    s.clearError()
    const pick = await s.pickFile()
    if (!pick) return
    setPwValue('')
    setPwType(pick.type)
    setPwPrompt({ kind: 'file', pick })
  }

  async function handleOpenEntry(entry: KeystoreLibraryEntry): Promise<void> {
    // Remembered password ⇒ open straight away; otherwise prompt for it (the
    // password is never persisted, so the user must re-enter it here).
    if (entry.remembered) {
      await s.openFromLibrary({ id: entry.id, name: entry.name })
      return
    }
    setPwValue('')
    setPwPrompt({ kind: 'library', id: entry.id, name: entry.name })
  }

  async function submitPassword(): Promise<void> {
    if (!pwPrompt) return
    const ok =
      pwPrompt.kind === 'file'
        ? await s.openFile({
            path: pwPrompt.pick.path,
            fileName: pwPrompt.pick.fileName,
            password: pwValue,
            type: pwType,
          })
        : await s.openFromLibrary({ id: pwPrompt.id, name: pwPrompt.name, password: pwValue })
    if (ok) {
      setPwPrompt(null)
      setPwValue('')
      toast.success(t('tools.keystore.toast.opened'))
    }
    // On failure the dialog stays open and now shows the reason itself — the
    // message used to land on the screen BEHIND it.
  }

  async function submitCreate(): Promise<void> {
    const ok = await s.createNew({ type: createType, password: createPw })
    if (ok) {
      setCreateOpen(false)
      setCreatePw('')
      // The screen that follows says "Untitled / 0 Aliases", which looks the
      // same whether or not anything happened. Say that it did.
      toast.success(t('tools.keystore.toast.created'))
    }
  }

  async function submitSave(): Promise<void> {
    if (!saveName.trim()) return
    const ok = await s.saveToLibrary({ name: saveName.trim(), rememberPassword: saveRemember })
    if (ok) {
      setSaveOpen(false)
      // The library list only renders on the empty state, so with a session open
      // there is otherwise NOTHING on screen to show the save happened.
      toast.success(t('tools.keystore.toast.savedToLibrary'))
    }
  }

  // Open a Generate dialog from the Add Entry menu with a clean error slate so a
  // stale banner from a previous op does not appear inside the fresh form.
  function openGenerator(which: 'keyPair' | 'secret'): void {
    setAddMenuOpen(false)
    s.clearError()
    if (which === 'keyPair') setGenKeyPairOpen(true)
    else setGenSecretOpen(true)
  }

  // Open the Import dialog with a clean error slate (same discipline as the
  // generators) so a stale banner never leaks into the fresh form.
  function openImport(): void {
    setAddMenuOpen(false)
    s.clearError()
    setImportOpen(true)
  }

  // Open an alias-scoped row dialog with a clean error slate.
  function openRowDialog(dialog: RowDialog): void {
    s.clearError()
    setRowDialog(dialog)
  }
  function openChangePw(): void {
    s.clearError()
    setChangePwOpen(true)
  }
  function openConvert(): void {
    s.clearError()
    setConvertOpen(true)
  }

  async function handleSaveAs(): Promise<void> {
    const result = await s.saveAs({ suggestedName: s.fileName ?? undefined })
    if (result && 'path' in result) {
      toast.success(t('tools.keystore.savedTo').replace('{path}', result.path))
    }
  }

  // Close guard (§9.7): a dirty session prompts before discarding; a clean
  // session closes silently.
  function requestClose(): void {
    if (s.dirty) setDiscardPrompt(true)
    else void s.closeSession()
  }

  /**
   * Is any modal on screen? Every dialog renders `s.error` itself, so the header
   * banner must stay quiet while one is up — otherwise the message is drawn
   * twice, and the copy behind the backdrop is the unreadable one.
   */
  const anyDialogOpen =
    genKeyPairOpen ||
    genSecretOpen ||
    importOpen ||
    changePwOpen ||
    convertOpen ||
    createOpen ||
    saveOpen ||
    discardPrompt ||
    rowDialog !== null ||
    pwPrompt !== null ||
    Boolean(s.pendingEntryPasswordOpen)

  const isPkcs12 = s.meta?.type === 'PKCS12'
  const isKeyAlias = (alias: string): boolean =>
    s.meta?.aliases.find((a) => a.alias === alias)?.entryType === 'KEY'

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* header / action bar */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--heading)' }}>
            {t('tools.keystore.title')}
          </h2>
          {/*
            `s.loading` was set by every action and read by nothing, so opening a
            large PKCS#12 or generating an RSA-4096 pair looked like a frozen
            screen.
          */}
          {s.loading && (
            <span role="status" className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('tools.keystore.working')}
            </span>
          )}
          {s.sessionId && s.meta && (
            <div
              className="flex min-w-0 items-center gap-2 text-xs"
              style={{ color: 'var(--muted)' }}
            >
              <span className="truncate" style={{ color: 'var(--text)' }}>
                {s.fileName ?? t('tools.keystore.untitled')}
              </span>
              <Pill>{s.meta.type}</Pill>
              <Pill>
                {s.meta.aliasCount} {t('tools.keystore.aliasCount')}
              </Pill>
              {s.dirty && (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: '#fff4e0', color: '#b35a00' }}
                >
                  {t('tools.keystore.dirty')}
                </span>
              )}
            </div>
          )}
        </div>
        {s.sessionId && (
          <div className="flex shrink-0 items-center gap-2">
            <AddEntryMenu
              open={addMenuOpen}
              onToggle={() => setAddMenuOpen((v) => !v)}
              onClose={() => setAddMenuOpen(false)}
              secretEnabled={!!isPkcs12}
              onKeyPair={() => openGenerator('keyPair')}
              onSecret={() => openGenerator('secret')}
              onImport={openImport}
            />
            <Btn onClick={openChangePw}>{t('tools.keystore.changePw.title')}</Btn>
            <Btn onClick={openConvert}>{t('tools.keystore.convert.button')}</Btn>
            <Btn onClick={() => void handleSaveAs()}>{t('tools.keystore.saveAs')}</Btn>
            <Btn onClick={() => setSaveOpen(true)}>{t('tools.keystore.saveToLibrary')}</Btn>
            <Btn onClick={requestClose}>{t('tools.keystore.close')}</Btn>
          </div>
        )}
      </div>

      {/* While ANY dialog is open the error belongs inside it (every dialog now
          takes `error`), so the header banner stands down. The condition used to
          be a hand-maintained list of seven flags and three dialogs were missing
          from it — those drew a banner nobody could read, behind the modal's own
          backdrop. Deriving it from one boolean means the list cannot drift
          again. */}
      {s.error && !anyDialogOpen && (
        <div
          role="alert"
          className="shrink-0 border-b px-4 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--border)', color: '#cc2200' }}
        >
          {s.error}
        </div>
      )}

      {/* body */}
      {s.sessionId && s.meta ? (
        <AliasTable
          aliases={s.meta.aliases}
          actions={{
            onDetail: (a) => void s.loadAliasDetail(a),
            onRename: (a) => openRowDialog({ kind: 'rename', alias: a }),
            onSetEntryPw: (a) => openRowDialog({ kind: 'setEntryPw', alias: a }),
            onExport: (a) => openRowDialog({ kind: 'export', alias: a }),
            onDelete: (a) => openRowDialog({ kind: 'delete', alias: a }),
          }}
        />
      ) : (
        <EmptyState
          onOpen={handleOpen}
          onCreate={() => setCreateOpen(true)}
          onOpenEntry={(entry) => void handleOpenEntry(entry)}
        />
      )}

      {/* certificate detail dialog */}
      {s.aliasDetail && (
        <CertificateDetailDialog detail={s.aliasDetail} onClose={() => s.clearAliasDetail()} />
      )}

      {/* generate key pair (Faz B2) */}
      {genKeyPairOpen && (
        <GenerateKeyPairDialog
          error={s.error}
          onSubmit={(opts) => s.generateKeyPair(opts)}
          onClose={() => setGenKeyPairOpen(false)}
        />
      )}

      {/* generate secret key (Faz B2) — PKCS12 only */}
      {genSecretOpen && (
        <GenerateSecretKeyDialog
          error={s.error}
          onSubmit={(opts) => s.generateSecretKey(opts)}
          onClose={() => setGenSecretOpen(false)}
        />
      )}

      {/* import entry (Faz B3) — PKCS12 / key material / pasted PEM / trusted cert */}
      {importOpen && <ImportDialog error={s.error} onClose={() => setImportOpen(false)} />}

      {/* ── Faz B4 dialogs ─────────────────────────────────────────────── */}

      {rowDialog?.kind === 'rename' && (
        <RenameAliasDialog
          alias={rowDialog.alias}
          isKeyEntry={isKeyAlias(rowDialog.alias)}
          error={s.error}
          onSubmit={(o) => s.renameAlias(o)}
          onClose={() => setRowDialog(null)}
        />
      )}

      {rowDialog?.kind === 'setEntryPw' && (
        <SetEntryPasswordDialog
          alias={rowDialog.alias}
          error={s.error}
          onSubmit={async (o) => {
            const ok = await s.setEntryPassword(o)
            // The alias table has no column for entry-password state, so the
            // dialog closing was the ONLY signal that anything happened.
            if (ok)
              toast.success(t('tools.keystore.toast.entryPwChanged').replace('{alias}', o.alias))
            return ok
          }}
          onClose={() => setRowDialog(null)}
        />
      )}

      {rowDialog?.kind === 'export' && (
        <ExportCertificateDialog
          alias={rowDialog.alias}
          error={s.error}
          onExport={async (o) => {
            const result = await s.exportCertificate(o)
            if (result && 'path' in result) {
              toast.success(t('tools.keystore.export.saved').replace('{path}', result.path))
            }
            return result
          }}
          onClose={() => setRowDialog(null)}
        />
      )}

      {rowDialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('tools.keystore.deleteConfirm.title')}
          message={t('tools.keystore.deleteConfirm.message').replace('{alias}', rowDialog.alias)}
          confirmLabel={t('tools.keystore.deleteConfirm.confirm')}
          danger
          onCancel={() => setRowDialog(null)}
          onConfirm={() => {
            const alias = rowDialog.alias
            setRowDialog(null)
            void s.deleteEntry(alias)
          }}
        />
      )}

      {changePwOpen && (
        <ChangeStorePasswordDialog
          error={s.error}
          onSubmit={async (o) => {
            const ok = await s.changeStorePassword(o)
            // Nothing on screen changes on success — users had to Close and
            // reopen with the new password just to learn whether it worked.
            if (ok) toast.success(t('tools.keystore.toast.pwChanged'))
            return ok
          }}
          onClose={() => setChangePwOpen(false)}
        />
      )}

      {convertOpen && s.meta && (
        <ConvertDialog
          currentType={s.meta.type}
          error={s.error}
          onSubmit={async (o) => {
            const ok = await s.convert(o)
            if (ok) {
              // "…use Save As" is part of the message on purpose: convert
              // produces a DIRTY in-memory session, and the type pill flipping
              // is easy to read as "already written to disk".
              toast.success(t('tools.keystore.toast.converted').replace('{type}', o.targetType))
              const skipped = useKeystoreStore.getState().convertSkipped
              if (skipped.length > 0) {
                toast.warning(
                  t('tools.keystore.toast.convertSkipped')
                    .replace('{n}', String(skipped.length))
                    .replace('{aliases}', skipped.join(', ')),
                )
              }
            }
            return ok
          }}
          onClose={() => setConvertOpen(false)}
        />
      )}

      {discardPrompt && (
        <ConfirmDialog
          title={t('tools.keystore.dirtyGuard.title')}
          message={t('tools.keystore.dirtyGuard.message')}
          confirmLabel={t('tools.keystore.dirtyGuard.discard')}
          cancelLabel={t('tools.keystore.dirtyGuard.keepEditing')}
          danger
          onCancel={() => setDiscardPrompt(false)}
          onConfirm={() => {
            setDiscardPrompt(false)
            void s.closeSession()
          }}
        />
      )}

      {/* entry-password prompt (FIX 1) — a key entry's pw ≠ the store pw */}
      {s.pendingEntryPasswordOpen && (
        <EntryPasswordPromptDialog
          aliases={s.pendingEntryPasswordOpen.aliases}
          error={s.error}
          onSubmit={(map) => s.retryOpenWithEntryPasswords(map)}
          onClose={() => s.cancelPendingOpen()}
        />
      )}

      {/* password prompt */}
      {pwPrompt && (
        <Modal
          title={t('tools.keystore.openTitle')}
          onClose={() => setPwPrompt(null)}
          error={s.error}
        >
          {pwPrompt.kind === 'file' && (
            <LabeledSelect
              label={t('tools.keystore.type')}
              value={pwType}
              onChange={(v) => setPwType(v as KeystoreType)}
              options={[
                ['PKCS12', 'PKCS12'],
                ['JKS', 'JKS'],
              ]}
            />
          )}
          <LabeledInput
            label={t('tools.keystore.password')}
            type="password"
            value={pwValue}
            autoFocus
            onChange={setPwValue}
            onEnter={() => void submitPassword()}
          />
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('tools.keystore.passwordHint')}
          </p>
          <ModalActions
            onCancel={() => setPwPrompt(null)}
            confirmLabel={t('tools.keystore.confirmOpen')}
            onConfirm={() => void submitPassword()}
          />
        </Modal>
      )}

      {/* create prompt */}
      {createOpen && (
        <Modal
          title={t('tools.keystore.createTitle')}
          onClose={() => setCreateOpen(false)}
          error={s.error}
        >
          <LabeledSelect
            label={t('tools.keystore.type')}
            value={createType}
            onChange={(v) => setCreateType(v as KeystoreType)}
            options={[
              ['PKCS12', 'PKCS12'],
              ['JKS', 'JKS'],
            ]}
          />
          {/*
            "optional" is now the truth, and only for PKCS#12. It used to say
            optional for both types while the engine rejected an empty password
            for either — so leaving it blank produced a Create button that did
            nothing, with the reason printed on the screen behind this dialog.
          */}
          <LabeledInput
            label={
              createType === 'PKCS12'
                ? `${t('tools.keystore.password')} (${t('tools.keystore.optional')})`
                : t('tools.keystore.password')
            }
            type="password"
            value={createPw}
            onChange={setCreatePw}
            onEnter={() => void submitCreate()}
          />
          {createType === 'PKCS12' && createPw === '' && (
            <p className="text-[11px]" style={{ color: 'var(--orange, #b35a00)' }}>
              {t('tools.keystore.emptyPwWarning')}
            </p>
          )}
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            confirmLabel={t('tools.keystore.create')}
            onConfirm={() => void submitCreate()}
          />
        </Modal>
      )}

      {/* save-to-library prompt */}
      {saveOpen && (
        <Modal
          title={t('tools.keystore.saveTitle')}
          onClose={() => setSaveOpen(false)}
          error={s.error}
        >
          <LabeledInput
            label={t('tools.keystore.name')}
            value={saveName}
            autoFocus
            onChange={setSaveName}
            onEnter={() => void submitSave()}
          />
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={saveRemember}
              onChange={(e) => setSaveRemember(e.target.checked)}
            />
            {t('tools.keystore.rememberPassword')}
          </label>
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('tools.keystore.rememberHint')}
          </p>
          <ModalActions
            onCancel={() => setSaveOpen(false)}
            confirmLabel={t('tools.keystore.save')}
            onConfirm={() => void submitSave()}
            confirmDisabled={!saveName.trim()}
          />
        </Modal>
      )}
    </div>
  )
}

// ── empty state (open / create / library) ───────────────────────────────────

function EmptyState({
  onOpen,
  onCreate,
  onOpenEntry,
}: {
  onOpen: () => void
  onCreate: () => void
  onOpenEntry: (entry: KeystoreLibraryEntry) => void
}) {
  const { t } = useTranslation()
  const library = useKeystoreStore((st) => st.library)
  const deleteFromLibrary = useKeystoreStore((st) => st.deleteFromLibrary)
  // Gate the ✕ (permanent SQLite blob drop) behind the same danger confirm as the
  // alias-row delete (FIX 3) — hold the pending id, only delete on confirm.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const pendingDeleteName = library.find((l) => l.id === pendingDeleteId)?.name ?? ''

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {t('tools.keystore.emptyState')}
        </p>
        <div className="flex gap-2">
          <button
            onClick={onOpen}
            className="rounded px-3 py-1.5 text-xs font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            {t('tools.keystore.open')}
          </button>
          <button
            onClick={onCreate}
            className="rounded border px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--text)',
            }}
          >
            {t('tools.keystore.createNew')}
          </button>
        </div>

        <div>
          <div
            className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            {t('tools.keystore.library')}
          </div>
          {library.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--hint)' }}>
              {t('tools.keystore.libraryEmpty')}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {library.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded border px-3 py-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
                >
                  <button
                    onClick={() => onOpenEntry(e)}
                    className="flex min-w-0 flex-col items-start text-left"
                  >
                    <span className="truncate text-xs font-medium" style={{ color: 'var(--text)' }}>
                      {e.name}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      {e.type} · {e.alias_count} {t('tools.keystore.aliasCount')}
                    </span>
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(e.id)}
                    className="text-[11px]"
                    style={{ color: 'var(--muted)' }}
                    title={t('tools.keystore.delete')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title={t('tools.keystore.libraryDeleteConfirm.title')}
          message={t('tools.keystore.libraryDeleteConfirm.message').replace(
            '{name}',
            pendingDeleteName,
          )}
          confirmLabel={t('tools.keystore.libraryDeleteConfirm.confirm')}
          danger
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            const id = pendingDeleteId
            setPendingDeleteId(null)
            void deleteFromLibrary(id)
          }}
        />
      )}
    </div>
  )
}

// ── small primitives ─────────────────────────────────────────────────────────

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: 'var(--accentLight)', color: 'var(--accentText)' }}
    >
      {children}
    </span>
  )
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded border px-2.5 py-1 text-[11px]"
      style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
    >
      {children}
    </button>
  )
}

/**
 * "Add Entry ▾" split menu — Generate Key Pair / Generate Secret Key / Import.
 * Secret keys are PKCS12-only, so that item is disabled for JKS sessions
 * (design §9.1); Import (Faz B3) opens the multi-format ImportDialog.
 */
function AddEntryMenu({
  open,
  onToggle,
  onClose,
  secretEnabled,
  onKeyPair,
  onSecret,
  onImport,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  secretEnabled: boolean
  onKeyPair: () => void
  onSecret: () => void
  onImport: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="rounded border px-2.5 py-1 text-[11px] font-medium"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--white)',
          color: 'var(--accentText)',
        }}
      >
        {t('tools.keystore.generate.addEntry')} ▾
      </button>
      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div
            className="absolute right-0 z-50 mt-1 w-52 rounded-md py-1 shadow-lg"
            style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
          >
            <MenuItem onClick={onKeyPair}>{t('tools.keystore.generate.keyPair')}</MenuItem>
            <MenuItem onClick={onSecret} disabled={!secretEnabled}>
              {t('tools.keystore.generate.secretKey')}
            </MenuItem>
            <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
            <MenuItem onClick={onImport}>{t('tools.keystore.generate.import')}</MenuItem>
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-xs disabled:opacity-40"
      style={{ color: 'var(--text)' }}
    >
      {children}
    </button>
  )
}
