import { useId } from 'react'
import { useTranslation } from '../../../lib/i18n'
import { describeExpiry, type ClaimEdits } from '../../../lib/tools/jwt'
import { Badge, FIELD_STYLE } from './atoms'

/**
 * Registered-claim editor (#63) for the JWT encoder.
 *
 * ── Why relative offsets ────────────────────────────────────────────────────
 *
 * `exp`/`nbf` are typed as durations ('15m', '2h', '7d'), not epochs, because
 * that is how a tester states the intent: "a token good for fifteen minutes".
 * The absolute seconds are computed at sign time against the same `now` the
 * payload gets, so the token is never stale by the time it is signed.
 *
 * ── Why it does not own the payload ─────────────────────────────────────────
 *
 * This form is a convenience OVER the JSON payload editor, never a replacement:
 * `applyClaimEdits` merges into whatever the user typed and preserves every
 * non-registered claim. Leaving a field blank REMOVES that claim, which is the
 * only way to say "no expiry" from a form.
 */
export default function ClaimsEditor({
  edits,
  onChange,
  previewPayload,
  nowSeconds,
}: {
  edits: ClaimEdits
  onChange: (next: ClaimEdits) => void
  /** The payload as it would be signed — drives the human-readable expiry. */
  previewPayload: Record<string, unknown>
  nowSeconds: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const ids = {
    iss: useId(),
    sub: useId(),
    aud: useId(),
    jti: useId(),
    exp: useId(),
    nbf: useId(),
    iat: useId(),
  }
  const expiry = describeExpiry(previewPayload, nowSeconds)

  const set = (patch: Partial<ClaimEdits>): void => onChange({ ...edits, ...patch })

  return (
    <div className="px-3 py-2">
      <div
        className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {t('tools.jwt.claims')}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field id={ids.iss} label={t('tools.jwt.claimIss')}>
          <input
            id={ids.iss}
            value={edits.iss ?? ''}
            onChange={(e) => set({ iss: e.target.value })}
            placeholder="https://idp.example.com"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Field>
        <Field id={ids.sub} label={t('tools.jwt.claimSub')}>
          <input
            id={ids.sub}
            value={edits.sub ?? ''}
            onChange={(e) => set({ sub: e.target.value })}
            placeholder="user-123"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Field>
        <Field id={ids.aud} label={t('tools.jwt.claimAud')}>
          <input
            id={ids.aud}
            value={edits.aud ?? ''}
            onChange={(e) => set({ aud: e.target.value })}
            placeholder="api://payments"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Field>
        <Field id={ids.jti} label={t('tools.jwt.claimJti')}>
          <input
            id={ids.jti}
            value={edits.jti ?? ''}
            onChange={(e) => set({ jti: e.target.value })}
            placeholder="a-unique-id"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Field>
        <Field id={ids.exp} label={t('tools.jwt.claimExp')}>
          <input
            id={ids.exp}
            value={edits.expiresIn ?? ''}
            onChange={(e) => set({ expiresIn: e.target.value })}
            placeholder="15m"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Field>
        <Field id={ids.nbf} label={t('tools.jwt.claimNbf')}>
          <input
            id={ids.nbf}
            value={edits.notBeforeIn ?? ''}
            onChange={(e) => set({ notBeforeIn: e.target.value })}
            placeholder="0s"
            className="w-full rounded border px-2 py-1 font-mono text-xs"
            style={FIELD_STYLE}
          />
        </Field>
      </div>

      <label
        htmlFor={ids.iat}
        className="mt-2 flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--muted)' }}
      >
        <input
          id={ids.iat}
          type="checkbox"
          checked={edits.issuedAt ?? false}
          onChange={(e) => set({ issuedAt: e.target.checked })}
        />
        {t('tools.jwt.claimIat')}
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge color={expiry.state === 'expired' ? '#cc2200' : '#1a7a4a'}>{expiry.text}</Badge>
        {expiry.iso ? (
          <span className="font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
            {expiry.iso}
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-[10px]" style={{ color: 'var(--hint)' }}>
        {t('tools.jwt.claimsHint')}
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
