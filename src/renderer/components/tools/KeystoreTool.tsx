import { useEffect, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useKeystoreStore } from '../../stores/keystore.store'
import type { KeystoreLibraryEntry, KeystorePickFileResult, KeystoreType } from '../../types'
import AliasTable from './keystore/AliasTable'
import CertificateDetailDialog from './keystore/CertificateDetailDialog'
import GenerateKeyPairDialog from './keystore/GenerateKeyPairDialog'
import GenerateSecretKeyDialog from './keystore/GenerateSecretKeyDialog'
import { LabeledInput, LabeledSelect, Modal, ModalActions } from './keystore/dialog-ui'

type PasswordPrompt =
  | { kind: 'file'; pick: KeystorePickFileResult }
  | { kind: 'library'; id: string; name: string }

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

  useEffect(() => {
    void s.loadLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleOpen(): Promise<void> {
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
    }
  }

  async function submitCreate(): Promise<void> {
    const ok = await s.createNew({ type: createType, password: createPw })
    if (ok) {
      setCreateOpen(false)
      setCreatePw('')
    }
  }

  async function submitSave(): Promise<void> {
    if (!saveName.trim()) return
    const ok = await s.saveToLibrary({ name: saveName.trim(), rememberPassword: saveRemember })
    if (ok) setSaveOpen(false)
  }

  // Open a Generate dialog from the Add Entry menu with a clean error slate so a
  // stale banner from a previous op does not appear inside the fresh form.
  function openGenerator(which: 'keyPair' | 'secret'): void {
    setAddMenuOpen(false)
    s.clearError()
    if (which === 'keyPair') setGenKeyPairOpen(true)
    else setGenSecretOpen(true)
  }

  const isPkcs12 = s.meta?.type === 'PKCS12'

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
            />
            <Btn onClick={() => setSaveOpen(true)}>{t('tools.keystore.saveToLibrary')}</Btn>
            <Btn onClick={() => void s.closeSession()}>{t('tools.keystore.close')}</Btn>
          </div>
        )}
      </div>

      {/* While a Generate dialog is open, route its error INTO the dialog only
          (it receives error={s.error}) — suppress the header banner so the same
          message doesn't render twice. */}
      {s.error && !genKeyPairOpen && !genSecretOpen && (
        <div
          className="shrink-0 border-b px-4 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--border)', color: '#cc2200' }}
        >
          {s.error}
        </div>
      )}

      {/* body */}
      {s.sessionId && s.meta ? (
        <AliasTable aliases={s.meta.aliases} onDetail={(a) => void s.loadAliasDetail(a)} />
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

      {/* password prompt */}
      {pwPrompt && (
        <Modal title={t('tools.keystore.openTitle')} onClose={() => setPwPrompt(null)}>
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
        <Modal title={t('tools.keystore.createTitle')} onClose={() => setCreateOpen(false)}>
          <LabeledSelect
            label={t('tools.keystore.type')}
            value={createType}
            onChange={(v) => setCreateType(v as KeystoreType)}
            options={[
              ['PKCS12', 'PKCS12'],
              ['JKS', 'JKS'],
            ]}
          />
          <LabeledInput
            label={`${t('tools.keystore.password')} (${t('tools.keystore.optional')})`}
            type="password"
            value={createPw}
            onChange={setCreatePw}
            onEnter={() => void submitCreate()}
          />
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            confirmLabel={t('tools.keystore.create')}
            onConfirm={() => void submitCreate()}
          />
        </Modal>
      )}

      {/* save-to-library prompt */}
      {saveOpen && (
        <Modal title={t('tools.keystore.saveTitle')} onClose={() => setSaveOpen(false)}>
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
                    onClick={() => void deleteFromLibrary(e.id)}
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
 * (design §9.1); Import is a placeholder wired up in Faz B3.
 */
function AddEntryMenu({
  open,
  onToggle,
  onClose,
  secretEnabled,
  onKeyPair,
  onSecret,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  secretEnabled: boolean
  onKeyPair: () => void
  onSecret: () => void
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
            <MenuItem onClick={onClose} disabled>
              {t('tools.keystore.generate.import')}
            </MenuItem>
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
