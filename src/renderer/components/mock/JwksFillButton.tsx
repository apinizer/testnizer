import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import KeyMaterialPicker, { type KeyMaterialSelection } from '../shared/KeyMaterialPicker'
import { parseJwksKeys } from '../../lib/jwks-serve'

/**
 * "Fill from Security / keystore" (#61 / Faz D1) — the ONE added control on the
 * mock response body.
 *
 * ── ADDITIVE, by construction ───────────────────────────────────────────────
 *
 * It writes into the SAME `body` field the user types in and does nothing until
 * clicked: a hand-authored body keeps serving byte-for-byte, and no response
 * row grows a new column or a new shape. Serving the result needs zero new mock
 * primitives (D1-1) — an ordinary `GET /.well-known/jwks.json` endpoint with an
 * ordinary 200/json response.
 *
 * ── Why the document is built in MAIN ───────────────────────────────────────
 *
 * D1-2: the mock script sandbox has no `require`/`node:crypto`/`jose`, so a
 * JWKS can never be produced at request time. `jwks:build` pre-computes the
 * static text; the store's ordinary `mock:response:update` persists it and
 * hot-reloads a running server — which is also how ROTATION works: pick another
 * key, the new one leads the document, the old one stays for tokens still in
 * flight.
 *
 * ── What crosses the bridge ─────────────────────────────────────────────────
 *
 * Out: an OPAQUE `MaterialSource` (ids/aliases/paths + any write-only password
 * the picker collected). It is used for this ONE call and deliberately never
 * stored in component state, so nothing can later persist it.
 * Back: public JWKs only (D1-4) — main strips `d,p,q,dp,dq,qi,k` and refuses a
 * symmetric key outright, so what lands in the body is publishable by
 * construction.
 */
export default function JwksFillButton({
  body,
  onFill,
  projectId,
  label,
  testId = 'mock-jwks-fill',
}: {
  /** Current body text — its keys are carried over so a pick ADDS a key. */
  body: string
  onFill: (body: string) => void
  /** Enables the picker's "Certificate" tab for the project's saved certs. */
  projectId?: string
  /** Overrides the button caption; the caller decides what "built" means. */
  label?: string
  testId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)

  async function handleSelect(selection: KeyMaterialSelection): Promise<void> {
    setOpen(false)
    setBusy(true)
    setError(null)
    try {
      const res = (await window.api?.jwks?.build({
        // The source is passed straight through and then dropped — a write-only
        // password may ride this one payload and must not outlive it.
        sources: [selection.source],
        // Keys already in the body survive, so filling twice rotates rather
        // than replaces.
        extraKeys: parseJwksKeys(body),
      })) as
        | { success: boolean; data?: { body: string; count: number }; error?: string }
        | undefined

      if (res?.success && res.data) {
        onFill(res.data.body)
        setCount(res.data.count)
      } else {
        setError(res?.error ?? t('mock.jwksFillFailed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {count !== null && !error && (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {`${count} ${t('mock.jwksKeys')}`}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          data-testid={testId}
          title={t('mock.jwksFillHint')}
          className="cursor-pointer rounded border px-2 py-0.5 text-[11px] disabled:cursor-default disabled:opacity-50"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--muted)',
            background: 'var(--white)',
          }}
        >
          {busy ? t('mock.jwksBuilding') : (label ?? t('mock.jwksFill'))}
        </button>
      </div>

      {error && (
        <div className="mt-1 text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </div>
      )}

      <KeyMaterialPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(selection) => void handleSelect(selection)}
        // Only the PUBLIC half is ever published, so an entry without a private
        // key is perfectly usable here.
        filter="publicOnly"
        projectId={projectId}
      />
    </>
  )
}
