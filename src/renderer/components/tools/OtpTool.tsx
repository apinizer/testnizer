import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import ToolShell from './ToolShell'
import NumberField from '../shared/NumberField'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import { useCopy } from '../../lib/use-copy'
import { useOtpStore } from '../../stores/otp.store'
import { decodeQrFromFile, encodeQrDataUrl } from '../../lib/tools/qr'
import type { OtpAddInput, OtpAlgorithm, OtpType } from '../../types'
import { useTranslation } from '../../lib/i18n'

const ALGORITHMS: OtpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512']

const EMPTY_FORM: OtpAddInput = {
  issuer: '',
  account: '',
  secret: '',
  type: 'totp',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  counter: 0,
}

/** Group the code into two halves for readability: 123456 → "123 456". */
function formatCode(code: string): string {
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)} ${code.slice(mid)}`
}

export default function OtpTool() {
  const { t } = useTranslation()
  const entries = useOtpStore((s) => s.entries)
  const codesById = useOtpStore((s) => s.codesById)
  const selectedId = useOtpStore((s) => s.selectedId)
  const error = useOtpStore((s) => s.error)
  const load = useOtpStore((s) => s.load)
  const refreshCodes = useOtpStore((s) => s.refreshCodes)
  const add = useOtpStore((s) => s.add)
  const remove = useOtpStore((s) => s.remove)
  const select = useOtpStore((s) => s.select)
  const generateNext = useOtpStore((s) => s.generateNext)
  const parseUri = useOtpStore((s) => s.parseUri)
  const reveal = useOtpStore((s) => s.reveal)
  const getUri = useOtpStore((s) => s.getUri)

  const [uri, setUri] = useState('')
  const [form, setForm] = useState<OtpAddInput>({ ...EMPTY_FORM })
  // Keyed by entry id so a revealed secret auto-hides when the selection changes.
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null)
  // Rendered QR (secret-bearing) for the selected entry, when "Show QR" is on.
  const [qr, setQr] = useState<{ id: string; dataUrl: string } | null>(null)
  // Keyed by entry id, like `qr` and `revealed` above, so it self-invalidates
  // when the selection moves. It used to be a bare string and stayed on screen
  // describing an entry the user had already navigated away from.
  const [qrError, setQrError] = useState<{ id: string; message: string } | null>(null)
  // Deleting an OTP entry destroys the only copy of that shared secret, so it
  // asks first. The button used to be titled "Clear" and removed the record on
  // a single click.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const qrFileRef = useRef<HTMLInputElement>(null)
  const codeCopy = useCopy()

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recompute every code once a second — offline HMAC over a few entries is
  // cheap, and this keeps both the countdown and the code fresh across the
  // period boundary without per-entry boundary math.
  useEffect(() => {
    if (entries.length === 0) return
    const id = window.setInterval(() => void refreshCodes(), 1000)
    return () => window.clearInterval(id)
  }, [entries.length, refreshCodes])

  const setF = <K extends keyof OtpAddInput>(k: K, v: OtpAddInput[K]): void =>
    setForm((prev) => ({ ...prev, [k]: v }))

  async function handleParse(value: string = uri): Promise<void> {
    const d = await parseUri(value)
    if (d) {
      setForm({
        issuer: d.issuer,
        account: d.account,
        secret: d.secret,
        type: d.type,
        algorithm: d.algorithm,
        digits: d.digits,
        period: d.period,
        counter: d.counter,
      })
    }
  }

  async function handleQrFile(file: File | undefined | null): Promise<void> {
    if (!file) return
    try {
      const decoded = await decodeQrFromFile(file)
      setUri(decoded)
      await handleParse(decoded)
    } catch (e) {
      useOtpStore.setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  async function handleShowQr(id: string): Promise<void> {
    setQrError(null)
    if (qr?.id === id) {
      setQr(null)
      return
    }
    const u = await getUri(id)
    if (u) {
      try {
        setQr({ id, dataUrl: encodeQrDataUrl(u, { cellSize: 5 }) })
      } catch (e) {
        setQrError({ id, message: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  async function handleAdd(): Promise<void> {
    if (!form.secret.trim()) return
    // Send only the field the chosen type actually uses. `counter` is hidden for
    // TOTP and `period` for HOTP, but both were still travelling — so a value
    // left over from a previous edit reached the store invisibly.
    const { counter, period, ...common } = form
    const created = await add({
      ...common,
      secret: form.secret.trim(),
      ...(form.type === 'hotp' ? { counter } : { period }),
    })
    if (created) {
      setForm({ ...EMPTY_FORM })
      setUri('')
    }
  }

  const selected = entries.find((e) => e.id === selectedId) ?? null
  const selectedCode = selectedId ? codesById[selectedId] : undefined

  return (
    <ToolShell
      title={t('tools.otp.title')}
      inputPane={
        <div className="flex h-full flex-col">
          {/* vault list */}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {entries.length === 0 ? (
              <div className="p-3 text-xs" style={{ color: 'var(--muted)' }}>
                {t('tools.otp.emptyList')}
              </div>
            ) : (
              entries.map((e) => {
                const c = codesById[e.id]
                const active = e.id === selectedId
                return (
                  <div
                    key={e.id}
                    onClick={() => select(e.id)}
                    className="mb-1 flex cursor-pointer items-center justify-between rounded px-2 py-1.5"
                    style={{
                      background: active ? 'var(--accentLight)' : 'var(--white)',
                      border: '1px solid',
                      borderColor: active ? 'var(--accentText)' : 'var(--border)',
                    }}
                  >
                    <div className="min-w-0">
                      <div
                        className="truncate text-xs font-medium"
                        style={{ color: 'var(--text)' }}
                      >
                        {e.issuer || e.label || t('tools.otp.unnamed')}
                      </div>
                      <div className="truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                        {e.account || e.type.toUpperCase()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-sm tabular-nums"
                        style={{ color: 'var(--accentText)' }}
                      >
                        {c?.code ?? '••••••'}
                      </span>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setPendingDelete({
                            id: e.id,
                            name: e.issuer || e.label || t('tools.otp.unnamed'),
                          })
                        }}
                        aria-label={`${t('tools.common.delete')}: ${
                          e.issuer || e.label || t('tools.otp.unnamed')
                        }`}
                        title={t('tools.common.delete')}
                        className="text-xs"
                        style={{ color: 'var(--muted)' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* add / import form */}
          <div
            className="shrink-0 space-y-2 overflow-auto border-t p-3"
            style={{ borderColor: 'var(--border)', maxHeight: '55%' }}
          >
            <div
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.otp.addTitle')}
            </div>

            <div className="flex gap-1">
              <input
                type="text"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder="otpauth://totp/..."
                className="min-w-0 flex-1 rounded border px-2 py-1 text-xs font-mono"
                style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
              />
              <button
                onClick={() => handleParse()}
                disabled={!uri.trim()}
                className="shrink-0 rounded border px-2 py-1 text-[11px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--white)',
                  color: 'var(--muted)',
                }}
              >
                {t('tools.otp.parseUri')}
              </button>
            </div>
            <input
              ref={qrFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleQrFile(e.target.files?.[0])}
            />
            <button
              onClick={() => qrFileRef.current?.click()}
              className="w-full rounded border border-dashed px-2 py-1 text-[11px]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--muted)',
              }}
            >
              {t('tools.otp.uploadQr')}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <TextInput
                label={t('tools.otp.issuer')}
                value={form.issuer ?? ''}
                onChange={(v) => setF('issuer', v)}
              />
              <TextInput
                label={t('tools.otp.account')}
                value={form.account ?? ''}
                onChange={(v) => setF('account', v)}
              />
            </div>

            <TextInput
              label={t('tools.otp.secret')}
              value={form.secret}
              mono
              onChange={(v) => setF('secret', v)}
            />

            <div className="grid grid-cols-2 gap-2">
              <SelectInput
                label={t('tools.otp.type')}
                value={form.type ?? 'totp'}
                options={[
                  ['totp', 'TOTP'],
                  ['hotp', 'HOTP'],
                ]}
                onChange={(v) => setF('type', v as OtpType)}
              />
              <SelectInput
                label={t('tools.otp.algorithm')}
                value={form.algorithm ?? 'SHA1'}
                options={ALGORITHMS.map((a) => [a, a])}
                onChange={(v) => setF('algorithm', v as OtpAlgorithm)}
              />
              <NumberField
                dense
                label={t('tools.otp.digits')}
                value={form.digits ?? 6}
                min={6}
                max={10}
                onChange={(v) => setF('digits', v)}
              />
              {form.type === 'hotp' ? (
                <NumberField
                  dense
                  label={t('tools.otp.counter')}
                  value={form.counter ?? 0}
                  min={0}
                  max={2000000000}
                  onChange={(v) => setF('counter', v)}
                />
              ) : (
                <NumberField
                  dense
                  label={t('tools.otp.period')}
                  value={form.period ?? 30}
                  min={10}
                  max={120}
                  onChange={(v) => setF('period', v)}
                />
              )}
            </div>

            <button
              onClick={handleAdd}
              disabled={!form.secret.trim()}
              className="w-full rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {t('tools.otp.add')}
            </button>
            {error && (
              <div className="text-[11px]" style={{ color: '#cc2200' }}>
                {error}
              </div>
            )}
          </div>

          {/*
           * Lives in this pane, not the output pane: the delete buttons are in
           * the list above and an entry can be removed without selecting it.
           */}
          <DeleteConfirmDialog
            open={pendingDelete !== null}
            itemName={pendingDelete?.name ?? ''}
            itemType={t('tools.otp.entryType')}
            description={t('tools.otp.deleteWarning')}
            onConfirm={() => {
              if (pendingDelete) void remove(pendingDelete.id)
              setPendingDelete(null)
            }}
            onCancel={() => setPendingDelete(null)}
          />
        </div>
      }
      outputPane={
        !selected ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.otp.hint')}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            <div className="text-center">
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {selected.issuer || selected.label || t('tools.otp.unnamed')}
                {selected.account ? ` · ${selected.account}` : ''}
              </div>
            </div>

            {selectedCode?.error ? (
              <div className="text-sm" style={{ color: '#cc2200' }}>
                {selectedCode.error}
              </div>
            ) : (
              <button
                onClick={() => selectedCode?.code && void codeCopy.copy(selectedCode.code)}
                aria-label={t('tools.otp.copyCode')}
                title={codeCopy.copied ? t('tools.common.copied') : t('tools.otp.copyCode')}
                className="font-mono tabular-nums"
                style={{ fontSize: '2.75rem', letterSpacing: '0.05em', color: 'var(--text)' }}
              >
                {selectedCode?.code ? formatCode(selectedCode.code) : '••• •••'}
              </button>
            )}
            {/*
             * The code itself stays on screen, so the confirmation goes under it
             * rather than replacing the glyphs with a ✓.
             */}
            <div
              className="-mt-3 h-4 text-[11px]"
              style={{ color: 'var(--green, #1a7a4a)' }}
              role="status"
            >
              {codeCopy.copied ? t('tools.common.copied') : ''}
            </div>

            {selected.type === 'totp' ? (
              <div className="w-48">
                <div
                  className="h-1.5 w-full overflow-hidden rounded"
                  style={{ background: 'var(--surface)' }}
                >
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${((selectedCode?.secondsRemaining ?? 0) / selected.period) * 100}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
                <div className="mt-1 text-center text-[11px]" style={{ color: 'var(--muted)' }}>
                  {selectedCode?.secondsRemaining ?? 0}
                  {t('tools.otp.secondsSuffix')}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => void generateNext(selected.id)}
                  className="rounded px-3 py-1 text-xs font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {t('tools.otp.generateNext')}
                </button>
                <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  {t('tools.otp.counter')}: {selected.counter}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--muted)' }}>
              <span>{selected.type.toUpperCase()}</span>
              <span>{selected.algorithm}</span>
              <span>
                {selected.digits} {t('tools.otp.digitsSuffix')}
              </span>
              {selected.type === 'totp' && <span>{selected.period}s</span>}
            </div>

            {(() => {
              const shownSecret = revealed?.id === selected.id ? revealed.secret : null
              return (
                <>
                  <button
                    onClick={async () => {
                      if (shownSecret) {
                        setRevealed(null)
                      } else {
                        const s = await reveal(selected.id)
                        if (s) setRevealed({ id: selected.id, secret: s })
                      }
                    }}
                    className="rounded border px-2 py-0.5 text-[11px]"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--muted)',
                    }}
                  >
                    {shownSecret ? t('tools.otp.hideSecret') : t('tools.otp.revealSecret')}
                  </button>
                  {shownSecret && (
                    <div
                      className="max-w-full break-all rounded px-2 py-1 font-mono text-[11px]"
                      style={{ background: 'var(--surface)', color: 'var(--text)' }}
                    >
                      {shownSecret}
                    </div>
                  )}
                </>
              )
            })()}

            <button
              onClick={() => void handleShowQr(selected.id)}
              className="rounded border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--muted)',
              }}
            >
              {qr?.id === selected.id ? t('tools.otp.hideQr') : t('tools.otp.showQr')}
            </button>
            {qrError?.id === selected.id && (
              <div className="text-[11px]" style={{ color: '#cc2200' }}>
                {qrError.message}
              </div>
            )}
            {qr?.id === selected.id && (
              <div className="flex flex-col items-center gap-1">
                <img
                  src={qr.dataUrl}
                  alt="OTP QR"
                  width={168}
                  height={168}
                  style={{ imageRendering: 'pixelated', background: '#fff', padding: 6 }}
                />
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {t('tools.otp.qrWarning')}
                </div>
              </div>
            )}
          </div>
        )
      }
    />
  )
}

// ── small themed form primitives ────────────────────────────────────────────

/**
 * `htmlFor` needs the id of the control it labels. This used to mint an id with
 * `useId()` and never hand it to the child, so every label in this form — issuer,
 * account, secret, type, algorithm, digits, period, counter — pointed at nothing
 * and no screen reader could announce the field it belonged to.
 */
function Labeled({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-0.5 block text-[10px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  const id = useId()
  return (
    <Labeled label={label} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border px-2 py-1 text-xs ${mono ? 'font-mono' : ''}`}
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      />
    </Labeled>
  )
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <Labeled label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border px-2 py-1 text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Labeled>
  )
}
