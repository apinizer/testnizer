import { useId, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { useKeystoreStore } from '../../stores/keystore.store'
import type { KeystoreLibraryEntry, TlsCertificateInfo, TlsInspectResult } from '../../types'
import ToolShell from './ToolShell'
import CertificateDetailDialog from './keystore/CertificateDetailDialog'
import {
  buildInspectRequest,
  CIPHER_PRESETS,
  emptyFormState,
  hasLegacySelection,
  TLS_VERSIONS,
  toCertDetail,
  trustedAliasFor,
  type TlsInspectFormState,
} from '../../lib/tools/tls-inspect'

const GREEN = '#1a7a4a'
const GREEN_BG = '#e8f9f1'
const AMBER = '#b35a00'
const AMBER_BG = '#fff4e0'
const RED = '#cc2200'
const RED_BG = '#fff0f0'

export default function TlsInspectorTool() {
  const { t } = useTranslation()
  const [form, setForm] = useState<TlsInspectFormState>(emptyFormState)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TlsInspectResult | null>(null)
  const [lastHost, setLastHost] = useState('')
  const [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [trustCert, setTrustCert] = useState<TlsCertificateInfo | null>(null)

  const patch = (p: Partial<TlsInspectFormState>): void => setForm((f) => ({ ...f, ...p }))
  const legacy = hasLegacySelection(form.minVersion, form.maxVersion)

  async function inspect(): Promise<void> {
    const built = buildInspectRequest(form)
    if (!built.ok) {
      setError(built.error)
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.tls.inspect(built.request)
      if (!r.success || !r.data) {
        setError(r.error ?? t('tools.tlsInspect.failed'))
        setResult(null)
      } else {
        setResult(r.data)
        setLastHost(built.request.host)
        setError(r.data.ok ? null : (r.data.error ?? null))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function pickFile(field: 'certPath' | 'keyPath' | 'pfxPath'): Promise<void> {
    const r = await window.api.dialog.openFile({
      title: t('tools.tlsInspect.fromFile'),
      filters: [
        { name: 'Certificates', extensions: ['crt', 'pem', 'cer', 'key', 'pfx', 'p12'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!r.success || !r.data) return
    const picked = Array.isArray(r.data) ? r.data[0] : r.data
    if (picked) patch({ clientCert: { ...form.clientCert, [field]: picked.filePath } })
  }

  const toolbar = (
    <>
      {result || error ? (
        <button
          onClick={() => {
            setResult(null)
            setError(null)
          }}
          className="rounded border px-2.5 py-1 text-[11px]"
          style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
        >
          {t('tools.common.clear')}
        </button>
      ) : null}
      <button
        onClick={() => void inspect()}
        disabled={loading}
        className="rounded px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {loading ? t('tools.tlsInspect.inspecting') : t('tools.tlsInspect.inspect')}
      </button>
    </>
  )

  return (
    <>
      <ToolShell
        title={t('tools.tlsInspect.title')}
        toolbar={toolbar}
        inputLabel={t('tools.tlsInspect.connection')}
        outputLabel={t('tools.tlsInspect.result')}
        inputPane={
          <RequestForm
            form={form}
            patch={patch}
            legacy={legacy}
            onPickFile={(f) => void pickFile(f)}
          />
        }
        outputPane={
          <ResultPane
            result={result}
            error={error}
            host={lastHost}
            onOpenCert={(i) => setDetailIndex(i)}
            onAddTrusted={(c) => setTrustCert(c)}
          />
        }
      />

      {result && detailIndex !== null && (
        <CertificateDetailDialog
          detail={toCertDetail(result, lastHost)}
          initialIndex={detailIndex}
          onClose={() => setDetailIndex(null)}
        />
      )}

      {trustCert && (
        <AddTrustedDialog cert={trustCert} host={lastHost} onClose={() => setTrustCert(null)} />
      )}
    </>
  )
}

// ── request form (left pane) ─────────────────────────────────────────────────

function RequestForm({
  form,
  patch,
  legacy,
  onPickFile,
}: {
  form: TlsInspectFormState
  patch: (p: Partial<TlsInspectFormState>) => void
  legacy: boolean
  onPickFile: (field: 'certPath' | 'keyPath' | 'pfxPath') => void
}) {
  const { t } = useTranslation()
  const ids = {
    host: useId(),
    port: useId(),
    sni: useId(),
    min: useId(),
    max: useId(),
    cipher: useId(),
    ca: useId(),
  }
  const cc = form.clientCert

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Labeled id={ids.host} label={t('tools.tlsInspect.host')}>
          <TextInput
            id={ids.host}
            value={form.host}
            placeholder="example.com"
            onChange={(v) => patch({ host: v })}
          />
        </Labeled>
        <Labeled id={ids.port} label={t('tools.tlsInspect.port')}>
          <TextInput
            id={ids.port}
            value={form.port}
            placeholder="443"
            width="w-20"
            onChange={(v) => patch({ port: v })}
          />
        </Labeled>
      </div>

      <Labeled id={ids.sni} label={t('tools.tlsInspect.sni')}>
        <TextInput
          id={ids.sni}
          value={form.servername}
          placeholder={t('tools.tlsInspect.sniHint')}
          onChange={(v) => patch({ servername: v })}
        />
      </Labeled>

      <div className="grid grid-cols-2 gap-2">
        <Labeled id={ids.min} label={t('tools.tlsInspect.versionMin')}>
          <SelectInput
            id={ids.min}
            value={form.minVersion}
            onChange={(v) => patch({ minVersion: v })}
            options={[
              ['', t('tools.tlsInspect.auto')],
              ...TLS_VERSIONS.map((v) => [v, v] as [string, string]),
            ]}
          />
        </Labeled>
        <Labeled id={ids.max} label={t('tools.tlsInspect.versionMax')}>
          <SelectInput
            id={ids.max}
            value={form.maxVersion}
            onChange={(v) => patch({ maxVersion: v })}
            options={[
              ['', t('tools.tlsInspect.auto')],
              ...TLS_VERSIONS.map((v) => [v, v] as [string, string]),
            ]}
          />
        </Labeled>
      </div>

      {legacy && (
        <div
          className="rounded px-2.5 py-1.5 text-[11px]"
          style={{ background: AMBER_BG, color: AMBER }}
        >
          {t('tools.tlsInspect.legacyWarning')}
        </div>
      )}

      <Labeled id={ids.cipher} label={t('tools.tlsInspect.cipherPreset')}>
        <SelectInput
          id={ids.cipher}
          value={form.cipherPreset}
          onChange={(v) => patch({ cipherPreset: v })}
          options={[
            ['', t('tools.tlsInspect.auto')],
            ...CIPHER_PRESETS.map(
              (c) => [c, t(`tools.tlsInspect.cipher.${c}`)] as [string, string],
            ),
          ]}
        />
      </Labeled>

      <Labeled id={ids.ca} label={t('tools.tlsInspect.caCerts')}>
        <textarea
          id={ids.ca}
          value={form.caCerts}
          onChange={(e) => patch({ caCerts: e.target.value })}
          placeholder={'-----BEGIN CERTIFICATE-----\n…'}
          className="h-20 w-full resize-y rounded border p-2 font-mono text-[11px]"
          style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
        />
        <p className="mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
          {t('tools.tlsInspect.caHint')}
        </p>
      </Labeled>

      {/* mTLS client cert — ADDITIVE, default OFF */}
      <div className="rounded border" style={{ borderColor: 'var(--border)' }}>
        <label
          className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium"
          style={{ color: 'var(--text)' }}
        >
          <input
            type="checkbox"
            checked={cc.enabled}
            onChange={(e) => patch({ clientCert: { ...cc, enabled: e.target.checked } })}
          />
          {t('tools.tlsInspect.clientCert')}
        </label>

        {cc.enabled && (
          <div
            className="space-y-3 border-t px-3 py-3"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="flex gap-1">
              {(['inline', 'file'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => patch({ clientCert: { ...cc, mode: m } })}
                  className="rounded px-2 py-0.5 text-[11px]"
                  style={{
                    background: cc.mode === m ? 'var(--accentLight)' : 'var(--white)',
                    border: '1px solid',
                    borderColor: cc.mode === m ? 'var(--accentText)' : 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {t(m === 'inline' ? 'tools.tlsInspect.inlinePem' : 'tools.tlsInspect.fromFile')}
                </button>
              ))}
              <span
                className="ml-auto inline-flex items-center rounded px-2 py-0.5 text-[10px]"
                style={{ background: 'var(--white)', color: 'var(--muted)', cursor: 'not-allowed' }}
                title={t('tools.tlsInspect.fromKeystoreHint')}
              >
                {t('tools.tlsInspect.fromKeystore')}
              </span>
            </div>

            {cc.mode === 'inline' ? (
              <>
                <textarea
                  value={cc.certPem}
                  onChange={(e) => patch({ clientCert: { ...cc, certPem: e.target.value } })}
                  placeholder={t('tools.tlsInspect.certPemPlaceholder')}
                  className="h-16 w-full resize-y rounded border p-2 font-mono text-[11px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--white)',
                    color: 'var(--text)',
                  }}
                />
                <textarea
                  value={cc.keyPem}
                  onChange={(e) => patch({ clientCert: { ...cc, keyPem: e.target.value } })}
                  placeholder={t('tools.tlsInspect.keyPemPlaceholder')}
                  className="h-16 w-full resize-y rounded border p-2 font-mono text-[11px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--white)',
                    color: 'var(--text)',
                  }}
                />
              </>
            ) : (
              <div className="space-y-2">
                <FileRow
                  label={t('tools.tlsInspect.certFile')}
                  value={cc.certPath}
                  onPick={() => onPickFile('certPath')}
                />
                <FileRow
                  label={t('tools.tlsInspect.keyFile')}
                  value={cc.keyPath}
                  onPick={() => onPickFile('keyPath')}
                />
                <FileRow
                  label={t('tools.tlsInspect.pfxFile')}
                  value={cc.pfxPath}
                  onPick={() => onPickFile('pfxPath')}
                />
              </div>
            )}

            <input
              type="password"
              value={cc.passphrase}
              onChange={(e) => patch({ clientCert: { ...cc, passphrase: e.target.value } })}
              placeholder={t('tools.tlsInspect.passphrase')}
              className="w-full rounded border p-1.5 text-xs"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── result pane (right) ──────────────────────────────────────────────────────

function ResultPane({
  result,
  error,
  host,
  onOpenCert,
  onAddTrusted,
}: {
  result: TlsInspectResult | null
  error: string | null
  host: string
  onOpenCert: (index: number) => void
  onAddTrusted: (cert: TlsCertificateInfo) => void
}) {
  const { t } = useTranslation()

  if (!result && !error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-xs" style={{ color: 'var(--hint)' }}>
          {t('tools.tlsInspect.emptyState')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {error && (
        <div className="rounded px-3 py-2 text-[11px]" style={{ background: RED_BG, color: RED }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="flex flex-wrap gap-2">
            {result.authorized ? (
              <Badge bg={GREEN_BG} color={GREEN}>
                {t('tools.tlsInspect.trusted')}
              </Badge>
            ) : (
              <Badge bg={AMBER_BG} color={AMBER}>
                {t('tools.tlsInspect.notValidated')}
              </Badge>
            )}
            <Badge
              bg={result.hostnameValid ? GREEN_BG : RED_BG}
              color={result.hostnameValid ? GREEN : RED}
            >
              {result.hostnameValid
                ? t('tools.tlsInspect.hostnameOk')
                : t('tools.tlsInspect.hostnameBad')}
            </Badge>
            <ValidityBadge result={result} />
            {result.selfSigned && (
              <Badge bg={AMBER_BG} color={AMBER}>
                {t('tools.tlsInspect.selfSigned')}
              </Badge>
            )}
          </div>

          {!result.authorized && result.authorizationError && (
            <div>
              <Caption>{t('tools.tlsInspect.authError')}</Caption>
              <div className="break-all font-mono text-[11px]" style={{ color: RED }}>
                {result.authorizationError}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meta label={t('tools.tlsInspect.protocol')} value={result.protocol ?? '—'} />
            <Meta
              label={t('tools.tlsInspect.cipher')}
              value={result.cipher ? result.cipher.name : '—'}
            />
            <Meta
              label={t('tools.tlsInspect.alpn')}
              value={result.alpnProtocol === false ? '—' : result.alpnProtocol}
            />
            <Meta
              label={t('tools.tlsInspect.expiresIn')}
              value={
                result.expired
                  ? t('tools.tlsInspect.expiredAgo').replace(
                      '{n}',
                      String(Math.abs(result.daysToExpiry)),
                    )
                  : t('tools.tlsInspect.inDays').replace('{n}', String(result.daysToExpiry))
              }
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Caption>{t('tools.tlsInspect.chain')}</Caption>
              <span className="text-[10px]" style={{ color: 'var(--hint)' }}>
                {t('tools.tlsInspect.presentedNote')}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {result.chain.map((c, i) => (
                <div
                  key={`${c.sha256Fingerprint}-${i}`}
                  className="flex items-center gap-2 rounded border px-2.5 py-1.5"
                  style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
                >
                  <button
                    onClick={() => onOpenCert(i)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span
                      className="truncate text-xs font-medium"
                      style={{ color: 'var(--accentText)' }}
                    >
                      {i === 0 ? `${t('tools.tlsInspect.leaf')} · ` : ''}
                      {c.subjectDN}
                    </span>
                    <span className="truncate text-[10px]" style={{ color: 'var(--muted)' }}>
                      {t('tools.tlsInspect.issuedBy')} {c.issuerDN}
                    </span>
                  </button>
                  <button
                    onClick={() => onAddTrusted(c)}
                    className="shrink-0 rounded border px-2 py-0.5 text-[10px]"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--accentText)',
                    }}
                    title={t('tools.tlsInspect.addTrusted')}
                  >
                    {t('tools.tlsInspect.addTrusted')}
                  </button>
                </div>
              ))}
              {result.chain.length === 0 && (
                <span className="text-xs" style={{ color: 'var(--hint)' }}>
                  {t('tools.tlsInspect.noChain')}
                </span>
              )}
            </div>
          </div>

          <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
            {host}:{result.port} · {t('tools.tlsInspect.presentedFooter')}
          </p>
        </>
      )}
    </div>
  )
}

function ValidityBadge({ result }: { result: TlsInspectResult }) {
  const { t } = useTranslation()
  const map = {
    valid: { bg: GREEN_BG, color: GREEN, key: 'tools.tlsInspect.valid' },
    expiring: { bg: AMBER_BG, color: AMBER, key: 'tools.tlsInspect.expiring' },
    expired: { bg: RED_BG, color: RED, key: 'tools.tlsInspect.expired' },
  } as const
  const s = map[result.validityStatus]
  return (
    <Badge bg={s.bg} color={s.color}>
      {t(s.key)}
    </Badge>
  )
}

// ── add-as-trusted → keystore session ────────────────────────────────────────

function AddTrustedDialog({
  cert,
  host,
  onClose,
}: {
  cert: TlsCertificateInfo
  host: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const sessionId = useKeystoreStore((s) => s.sessionId)
  const fileName = useKeystoreStore((s) => s.fileName)
  const library = useKeystoreStore((s) => s.library)
  const [busy, setBusy] = useState(false)

  async function doImport(): Promise<void> {
    setBusy(true)
    const ok = await useKeystoreStore
      .getState()
      .importTrustedCert({ alias: trustedAliasFor(host, cert), certificateContent: cert.pem })
    setBusy(false)
    if (ok) {
      toast.success(t('tools.tlsInspect.trustAdded'))
      onClose()
    } else {
      toast.error(useKeystoreStore.getState().error ?? t('tools.tlsInspect.trustFailed'))
    }
  }

  async function createThenImport(): Promise<void> {
    setBusy(true)
    const ok = await useKeystoreStore.getState().createNew({ type: 'PKCS12' })
    setBusy(false)
    if (ok) void doImport()
  }

  async function openThenImport(entry: KeystoreLibraryEntry): Promise<void> {
    setBusy(true)
    const ok = await useKeystoreStore.getState().openFromLibrary({ id: entry.id, name: entry.name })
    setBusy(false)
    if (ok) void doImport()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-lg p-4 shadow-xl"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('tools.tlsInspect.addTrusted')}
        </h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {cert.subjectDN}
        </p>

        {sessionId ? (
          <>
            <p className="text-xs" style={{ color: 'var(--text)' }}>
              {t('tools.tlsInspect.trustIntoOpen').replace(
                '{name}',
                fileName ?? t('tools.tlsInspect.untitledStore'),
              )}
            </p>
            <div className="flex justify-end gap-2">
              <DialogBtn onClick={onClose}>{t('tools.common.clear')}</DialogBtn>
              <DialogBtn primary disabled={busy} onClick={() => void doImport()}>
                {t('tools.tlsInspect.addTrusted')}
              </DialogBtn>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs" style={{ color: 'var(--text)' }}>
              {t('tools.tlsInspect.noKeystoreOpen')}
            </p>
            {library.length > 0 && (
              <div className="flex flex-col gap-1">
                <Caption>{t('tools.tlsInspect.openFromLibrary')}</Caption>
                {library.map((e) => (
                  <button
                    key={e.id}
                    disabled={busy || !e.remembered}
                    onClick={() => void openThenImport(e)}
                    className="rounded border px-2.5 py-1.5 text-left text-xs disabled:opacity-40"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--text)',
                    }}
                    title={e.remembered ? '' : t('tools.tlsInspect.libraryNeedsPassword')}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <DialogBtn onClick={onClose}>{t('tools.common.clear')}</DialogBtn>
              <DialogBtn primary disabled={busy} onClick={() => void createThenImport()}>
                {t('tools.tlsInspect.createAndAdd')}
              </DialogBtn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── primitives ───────────────────────────────────────────────────────────────

function Labeled({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function TextInput({
  id,
  value,
  placeholder,
  width,
  onChange,
}: {
  id: string
  value: string
  placeholder?: string
  width?: string
  onChange: (v: string) => void
}) {
  return (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${width ?? 'w-full'} rounded border p-1.5 text-xs`}
      style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
    />
  )
}

function SelectInput({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: Array<[string, string]>
  onChange: (v: string) => void
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border p-1.5 text-xs"
      style={{ borderColor: 'var(--border)', background: 'var(--white)', color: 'var(--text)' }}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

function FileRow({ label, value, onPick }: { label: string; value: string; onPick: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPick}
        className="shrink-0 rounded border px-2 py-1 text-[11px]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--white)',
          color: 'var(--accentText)',
        }}
      >
        {label}
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
        {value || '—'}
      </span>
    </div>
  )
}

function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Caption>{label}</Caption>
      <div className="break-all font-mono text-[11px]" style={{ color: 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--muted)' }}
    >
      {children}
    </div>
  )
}

function DialogBtn({
  onClick,
  primary,
  disabled,
  children,
}: {
  onClick: () => void
  primary?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      style={
        primary
          ? { background: 'var(--accent)', color: '#fff' }
          : { border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text)' }
      }
    >
      {children}
    </button>
  )
}
