/**
 * Presentational atoms for the JWK tool. Pure move out of `JwkTool.tsx` — the
 * markup is unchanged.
 */
import { type ReactNode } from 'react'
import CopyButton from '../../shared/CopyButton'
import { useTranslation } from '../../../lib/i18n'
import {
  isPrivateJwk,
  prettyJwk,
  summarizeJwk,
  toPublicJwk,
  type Jwk,
  type JwkSummary,
} from '../../../lib/tools/jwk'
import { GREEN, RED } from './shared'

// ─────────────────────────────────────────────────────────────────────────────
// Shared atoms
// ─────────────────────────────────────────────────────────────────────────────

export const INPUT_STYLE = {
  background: 'var(--white)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
} as const

/** Short, human label for a key — thumbprint first, then what it is. */
export function describe(jwk: Jwk): string {
  const s: JwkSummary = summarizeJwk(jwk)
  const size = s.crv ?? (s.bits ? `${s.bits}-bit` : '')
  return [s.kid ?? '(no kid)', s.kty, size, s.alg].filter(Boolean).join(' · ')
}

export function Pane({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col overflow-auto">{children}</div>
}

export function Hint({ text }: { text: string }) {
  return (
    <div className="p-4 text-xs" style={{ color: 'var(--muted)' }}>
      {text}
    </div>
  )
}

export function JwkCard({
  jwk,
  title,
  note,
  onAdd,
}: {
  jwk: Jwk
  title?: string
  note?: string
  onAdd?: () => void
}) {
  const { t } = useTranslation()
  const secret = isPrivateJwk(jwk)
  const summary = summarizeJwk(jwk)
  const json = prettyJwk(jwk)
  const publicJson = prettyJwk(toPublicJwk(jwk))

  return (
    <div
      className="rounded border"
      style={{ borderColor: secret ? RED : 'var(--border)', background: 'var(--white)' }}
      data-testid={secret ? 'jwk-card-private' : 'jwk-card-public'}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <KindBadge secret={secret} />
        {title ? (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </span>
        ) : null}
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {summary.kty}
          {summary.crv ? ` · ${summary.crv}` : summary.bits ? ` · ${summary.bits}-bit` : ''}
          {summary.alg ? ` · ${summary.alg}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {/*
           * The accessible name has to say WHICH half this copies. On a private
           * card the generic "Copy" sat right next to "Copy public half" and put
           * the private key on the clipboard without saying so.
           */}
          <CopyButton
            text={json}
            label={t('tools.common.copy')}
            ariaLabel={secret ? t('tools.jwk.copyPrivateJwk') : t('tools.jwk.copyPublicJwk')}
          />
          {secret ? (
            <CopyButton
              text={publicJson}
              label={t('tools.jwk.copyPublic')}
              ariaLabel={t('tools.jwk.copyPublicJwk')}
            />
          ) : null}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="rounded border px-1.5 py-0.5 text-[11px]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--accent-text)',
              }}
            >
              {t('tools.jwk.addToSet')}
            </button>
          ) : null}
        </span>
      </div>

      {summary.kid ? (
        <div className="px-2 pt-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
          {`${t('tools.jwk.kid')}: `}
          <span className="font-mono" style={{ color: 'var(--text)' }}>
            {summary.kid}
          </span>
        </div>
      ) : null}

      {secret ? (
        <div className="px-2 pt-1.5 text-[11px]" style={{ color: RED }}>
          {t('tools.jwk.privateWarning')}
        </div>
      ) : null}
      {note ? (
        <div className="px-2 pt-1.5 text-[11px]" style={{ color: GREEN }}>
          {note}
        </div>
      ) : null}

      <pre
        className="m-0 max-h-64 overflow-auto px-2 py-2 font-mono text-xs whitespace-pre-wrap break-all"
        style={{ color: 'var(--text)' }}
      >
        {json}
      </pre>
    </div>
  )
}

export function PemBlock({ title, pem, secret }: { title: string; pem: string; secret: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      className="rounded border"
      style={{ borderColor: secret ? RED : 'var(--border)', background: 'var(--white)' }}
    >
      <div
        className="flex items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <KindBadge secret={secret} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
          {title}
        </span>
        <span className="ml-auto">
          <CopyButton
            text={pem}
            label={t('tools.common.copy')}
            ariaLabel={t('tools.jwk.copyPem')}
          />
        </span>
      </div>
      <pre
        className="m-0 max-h-56 overflow-auto px-2 py-2 font-mono text-xs whitespace-pre-wrap break-all"
        style={{ color: 'var(--text)' }}
      >
        {pem}
      </pre>
    </div>
  )
}

export function KindBadge({ secret }: { secret: boolean }) {
  const { t } = useTranslation()
  const color = secret ? RED : GREEN
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}
    >
      {secret ? t('tools.jwk.privateBadge') : t('tools.jwk.publicBadge')}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-2">
      <div
        className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

export function ErrorLine({ text }: { text: string }) {
  return (
    <div className="px-3 py-2 text-[11px]" style={{ color: RED }} role="alert">
      {text}
    </div>
  )
}

export function ModePill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        background: active ? 'var(--white)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      {children}
    </button>
  )
}
