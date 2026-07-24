import { useEffect, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { MaterialSource } from '../../types'

/**
 * KeyMaterialPicker (#60, design §2.4/§2.6) — the ONE reusable selection dialog
 * for "where does the key material come from?".
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 * OPAQUE. The value it emits is a `MaterialSource`: ids, aliases and paths ONLY.
 * No certificate/key BYTES ever enter renderer state through this component —
 * main dereferences the source at execution time via `resolveKeyMaterial`.
 *
 * WRITE-ONLY PASSWORDS. The store password (when the keystore row does not
 * remember one) and the per-alias key password (R11) are typed here, travel
 * INSIDE the emitted `MaterialSource` to main, and are NEVER read back: the
 * component deliberately does not seed its password inputs from `value`.
 *
 * ADDITIVE. This is one MORE option. Every consumer keeps its existing pasted
 * PEM / file-picker inputs as the default path; picking nothing here means the
 * consumer's config is byte-for-byte what it was before #60.
 */

/** Which material a consumer can use. `publicOnly` hides the key-password field. */
export type KeyMaterialFilter = 'privateKey' | 'publicOnly' | 'any'

export interface KeyMaterialSelection {
  /** Opaque — ids/aliases/paths (+ write-only passwords). Never key bytes. */
  source: MaterialSource
  /** Human label for the consumer to render without dereferencing, e.g. `keystore 'prod' › client1`. */
  label: string
}

interface LibraryRow {
  id: string
  name: string
  type: string
  alias_count: number
  remembered: boolean
}

interface AliasRow {
  alias: string
  entryType: string
  hasPrivateKey: boolean
  subjectDN?: string
  notAfter?: string
}

interface CertRowLite {
  id: string
  kind: 'ca' | 'client'
  host: string | null
  crt_path: string | null
  pfx_path: string | null
}

const BTN =
  'cursor-pointer rounded border px-2 py-1 text-xs disabled:cursor-default disabled:opacity-50'
const INPUT = 'w-full rounded border px-2 py-1 text-xs'
const INPUT_STYLE = {
  background: 'var(--white)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
} as const

export interface KeyMaterialPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (selection: KeyMaterialSelection) => void
  /** Restricts which entries are offered. Defaults to `privateKey` (signing/mTLS). */
  filter?: KeyMaterialFilter
  /** When given, a "Certificate" tab lists the project's saved certificate rows. */
  projectId?: string
  /** Current selection — used ONLY to highlight; passwords are never read back. */
  value?: MaterialSource | null
  /**
   * Set by consumers that PERSIST the selection (the mTLS certificate row).
   * Such a consumer has nowhere to keep a write-only store password, so a
   * keystore whose password is not remembered would fail on every future Send
   * and Run. Offering it and failing later is worse than not offering it.
   */
  requireRemembered?: boolean
}

export default function KeyMaterialPicker({
  open,
  onClose,
  onSelect,
  filter = 'privateKey',
  projectId,
  value,
  requireRemembered = false,
}: KeyMaterialPickerProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'keystore' | 'certRow'>('keystore')
  const [library, setLibrary] = useState<LibraryRow[]>([])
  const [certRows, setCertRows] = useState<CertRowLite[]>([])
  const [selectedStore, setSelectedStore] = useState<LibraryRow | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [aliases, setAliases] = useState<AliasRow[] | null>(null)
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null)
  const [aliasMeta, setAliasMeta] = useState<string | null>(null)
  // WRITE-ONLY: never seeded from `value`, never echoed back to a consumer.
  const [storePassword, setStorePassword] = useState('')
  const [keyPassword, setKeyPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void (async () => {
      setError(null)
      const res = (await window.api?.keystore?.libraryList()) as
        | { success: boolean; data?: LibraryRow[]; error?: string }
        | undefined
      if (res?.success && res.data) setLibrary(res.data)
      else if (res && !res.success) setError(res.error ?? 'Could not list saved keystores.')
    })()
    if (!projectId) return
    void (async () => {
      const res = (await window.api?.certificate?.list(projectId)) as
        | { success: boolean; data?: CertRowLite[] }
        | undefined
      if (res?.success && res.data) setCertRows(res.data)
    })()
  }, [open, projectId])

  async function openStore(row: LibraryRow): Promise<void> {
    setSelectedStore(row)
    setAliases(null)
    setSelectedAlias(null)
    setAliasMeta(null)
    setError(null)
    if (!row.remembered && !storePassword) return // wait for the password
    setBusy(true)
    const res = (await window.api?.keystore?.libraryOpen({
      id: row.id,
      password: row.remembered ? undefined : storePassword,
    })) as
      | {
          success: boolean
          data?: { sessionId: string; meta: { aliases: AliasRow[] } }
          error?: string
        }
      | undefined
    setBusy(false)
    if (!res?.success || !res.data) {
      setError(res?.error ?? 'Could not open the keystore.')
      return
    }
    setAliases(res.data.meta.aliases ?? [])
    setSessionId(res.data.sessionId)
  }

  /** PUBLIC metadata only — `aliasDetail` never returns private key material. */
  async function pickAlias(row: AliasRow): Promise<void> {
    setSelectedAlias(row.alias)
    setAliasMeta(row.subjectDN ?? null)
    if (!sessionId) return
    const res = (await window.api?.keystore?.aliasDetail({ sessionId, alias: row.alias })) as
      | { success: boolean; data?: { chain?: Array<{ subjectDN?: string; notAfter?: string }> } }
      | undefined
    const leaf = res?.success ? res.data?.chain?.[0] : undefined
    if (leaf) setAliasMeta([leaf.subjectDN, leaf.notAfter].filter(Boolean).join(' · '))
  }

  /** Drop the main-side session — the picker only ever needed public metadata. */
  function close(): void {
    if (sessionId) void window.api?.keystore?.closeSession(sessionId)
    setSessionId(null)
    setStorePassword('')
    setKeyPassword('')
    onClose()
  }

  function confirmKeystore(): void {
    if (!selectedStore || !selectedAlias) return
    const source: MaterialSource = {
      kind: 'keystore',
      keystoreId: selectedStore.id,
      alias: selectedAlias,
      ...(keyPassword ? { keyPassword } : {}),
      ...(!selectedStore.remembered && storePassword ? { storePassword } : {}),
    }
    onSelect({ source, label: `keystore '${selectedStore.name}' › ${selectedAlias}` })
    close()
  }

  function confirmCertRow(row: CertRowLite): void {
    onSelect({
      source: { kind: 'certRow', certificateId: row.id },
      label: `certificate ${row.host || '*'}`,
    })
    close()
  }

  if (!open) return null

  const visibleAliases = (aliases ?? []).filter((a) =>
    filter === 'privateKey' ? a.hasPrivateKey : true,
  )
  const visibleCertRows = certRows.filter((c) =>
    filter === 'privateKey' ? c.kind === 'client' : true,
  )
  const currentKeystoreId = value?.kind === 'keystore' ? value.keystoreId : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={close}
      data-testid="key-material-picker"
    >
      <div
        className="w-full max-w-md max-h-[85vh] space-y-3 overflow-y-auto rounded-lg p-4 shadow-xl"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {t('keyMaterial.title')}
        </h3>

        {projectId && (
          <div className="flex gap-1">
            {(['keystore', 'certRow'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="cursor-pointer rounded px-2 py-1 text-xs"
                style={{
                  background: tab === id ? 'var(--accent-light)' : 'transparent',
                  color: tab === id ? 'var(--accent-text)' : 'var(--muted)',
                  border: 'none',
                }}
              >
                {t(id === 'keystore' ? 'keyMaterial.tabKeystore' : 'keyMaterial.tabCertificate')}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="text-xs" style={{ color: 'var(--red, #cc2200)' }}>
            {error}
          </div>
        )}

        {tab === 'keystore' && (
          <>
            {library.length === 0 && (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('keyMaterial.libraryEmpty')}
              </div>
            )}
            <div className="space-y-1">
              {library.map((row) => {
                // A store whose password is not remembered cannot back a
                // PERSISTED selection — see `requireRemembered`.
                const blocked = requireRemembered && !row.remembered
                return (
                  <button
                    key={row.id}
                    type="button"
                    disabled={blocked}
                    title={blocked ? t('keyMaterial.rememberRequired') : undefined}
                    onClick={() => void openStore(row)}
                    className="flex w-full items-center justify-between rounded border px-2 py-1 text-left text-xs disabled:cursor-default"
                    style={{
                      borderColor:
                        selectedStore?.id === row.id || currentKeystoreId === row.id
                          ? 'var(--accent)'
                          : 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--text)',
                      opacity: blocked ? 0.55 : 1,
                      cursor: blocked ? 'default' : 'pointer',
                    }}
                  >
                    <span>{row.name}</span>
                    <span style={{ color: 'var(--muted)' }}>
                      {blocked
                        ? t('keyMaterial.rememberRequiredShort')
                        : `${row.type} · ${row.alias_count}`}
                    </span>
                  </button>
                )
              })}
            </div>
            {requireRemembered && library.some((r) => !r.remembered) && (
              <div className="text-[10px]" style={{ color: 'var(--hint)' }}>
                {t('keyMaterial.rememberRequired')}
              </div>
            )}

            {selectedStore && !selectedStore.remembered && (
              <label className="block">
                <span
                  className="mb-0.5 block text-[10px] uppercase"
                  style={{ color: 'var(--muted)' }}
                >
                  {t('keyMaterial.storePassword')}
                </span>
                <input
                  type="password"
                  className={INPUT}
                  style={INPUT_STYLE}
                  aria-label={t('keyMaterial.storePassword')}
                  value={storePassword}
                  onChange={(e) => setStorePassword(e.target.value)}
                />
                <span className="mt-0.5 block text-[10px]" style={{ color: 'var(--hint)' }}>
                  {t('keyMaterial.storePasswordHint')}
                </span>
              </label>
            )}

            {selectedStore && (
              <button
                type="button"
                className={BTN}
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                disabled={busy}
                onClick={() => void openStore(selectedStore)}
              >
                {t('keyMaterial.open')}
              </button>
            )}

            {aliases !== null && (
              <div className="space-y-1">
                {visibleAliases.length === 0 && (
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    {t('keyMaterial.noAliases')}
                  </div>
                )}
                {visibleAliases.map((a) => (
                  <button
                    key={a.alias}
                    type="button"
                    onClick={() => void pickAlias(a)}
                    className="flex w-full cursor-pointer items-center justify-between rounded border px-2 py-1 text-left text-xs"
                    style={{
                      borderColor: selectedAlias === a.alias ? 'var(--accent)' : 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--text)',
                    }}
                  >
                    <span>{a.alias}</span>
                    <span style={{ color: 'var(--muted)' }}>{a.entryType}</span>
                  </button>
                ))}
              </div>
            )}

            {aliasMeta && (
              <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {aliasMeta}
              </div>
            )}

            {selectedAlias && filter !== 'publicOnly' && (
              <label className="block">
                <span
                  className="mb-0.5 block text-[10px] uppercase"
                  style={{ color: 'var(--muted)' }}
                >
                  {t('keyMaterial.keyPassword')} ({t('keyMaterial.optional')})
                </span>
                <input
                  type="password"
                  className={INPUT}
                  style={INPUT_STYLE}
                  aria-label={t('keyMaterial.keyPassword')}
                  value={keyPassword}
                  onChange={(e) => setKeyPassword(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        {tab === 'certRow' && (
          <div className="space-y-1">
            {visibleCertRows.length === 0 && (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('keyMaterial.certRowsEmpty')}
              </div>
            )}
            {visibleCertRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => confirmCertRow(row)}
                className="flex w-full cursor-pointer items-center justify-between rounded border px-2 py-1 text-left text-xs"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--white)',
                  color: 'var(--text)',
                }}
              >
                <span>{row.host || '*'}</span>
                <span style={{ color: 'var(--muted)' }}>{row.pfx_path || row.crt_path || ''}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className={BTN}
            style={{
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--muted)',
            }}
          >
            {t('keyMaterial.cancel')}
          </button>
          {tab === 'keystore' && (
            <button
              type="button"
              onClick={confirmKeystore}
              disabled={!selectedAlias || busy}
              className="cursor-pointer rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)', border: 'none' }}
            >
              {t('keyMaterial.use')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
