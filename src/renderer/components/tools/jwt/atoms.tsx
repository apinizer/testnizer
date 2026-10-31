import type { ClaimRow } from '../../../lib/tools/jwt'
import { TONE, type Tone } from '../palette'

/**
 * The JWT Debugger's presentational atoms, lifted out of `JwtTool.tsx` verbatim
 * when #63 added the claim editor, the JWKS panel and the JWE screen.
 *
 * Nothing here changed shape in the move — same markup, same CSS variables — so
 * the existing decoder/encoder render byte-for-byte as before; the extraction
 * exists only so the new panels can reuse them instead of growing a second,
 * slightly-different set of badges and buttons.
 */

export type View = 'json' | 'table'

export function PanelHeader({
  title,
  actions,
}: {
  title: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center justify-between border-b px-3 py-1.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <span
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {title}
      </span>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  )
}

export function ViewToggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: active ? 'var(--accent-light)' : 'transparent',
        color: active ? 'var(--accent-text)' : 'var(--muted)',
        border: '1px solid',
        borderColor: active ? 'var(--accent-text)' : 'var(--border)',
      }}
    >
      {children}
    </button>
  )
}

export function ModePill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
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

/**
 * Re-export of the shared button. The private copy that used to live here
 * swallowed clipboard failures and had the glyph "⧉" as its only accessible
 * name; callers keep importing `CopyButton` from this module unchanged.
 */
export { default as CopyButton } from '../../shared/CopyButton'

/**
 * `label` is required: these buttons do not clear a field, they reset it to a
 * template, and a panel can hold more than one of them. The old version was
 * titled "Clear" in English regardless of locale.
 */
export function ClearButton({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border px-1.5 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border)',
        color: 'var(--muted)',
        background: 'var(--white)',
      }}
      aria-label={label}
      title={label}
    >
      ✕
    </button>
  )
}

/**
 * A status pill. `tone` picks a theme token triple (text + tint + border) from
 * the shared Tools palette — the old `color` prop derived the tint by appending
 * an alpha suffix to a light-theme hex, unreadable in the dark theme (G-03).
 */
export function Badge({
  tone,
  children,
  testId,
}: {
  tone: Tone
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  const c = TONE[tone]
  return (
    <span
      data-testid={testId}
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {children}
    </span>
  )
}

/** jwt.io-style three-color JWT split by dots (header / payload / signature). */
export function ColorizedJwt({ token }: { token: string }): React.JSX.Element {
  const parts = token.split('.')
  const colors = [TONE.danger.fg, TONE.accent.fg, 'var(--mb-patch-fg)']
  return (
    <div className="font-mono text-xs break-all leading-relaxed">
      {parts.map((p, i) => (
        <span key={i}>
          <span style={{ color: colors[i] ?? 'var(--text)' }}>{p}</span>
          {i < parts.length - 1 ? <span style={{ color: 'var(--muted)' }}>.</span> : null}
        </span>
      ))}
    </div>
  )
}

/** Very small JSON colorizer for the read-only decoded view — the response viewer's `--json-*` tokens. */
export function colorizeJson(src: string): React.ReactNode {
  const tokens: { v: string; c: string }[] = []
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([\s\S])/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) {
      const isKey = !!m[2]
      tokens.push({ v: m[1], c: isKey ? 'var(--json-key)' : 'var(--json-string)' })
      if (m[2]) tokens.push({ v: m[2], c: 'inherit' })
    } else if (m[3] !== undefined) {
      tokens.push({ v: m[3], c: 'var(--json-number)' })
    } else if (m[4] !== undefined) {
      const isNull = m[4].toLowerCase() === 'null'
      tokens.push({ v: m[4], c: isNull ? 'var(--json-null)' : 'var(--json-bool)' })
    } else {
      tokens.push({ v: m[5], c: 'inherit' })
    }
  }
  return tokens.map((tok, i) => (
    <span key={i} style={{ color: tok.c }}>
      {tok.v}
    </span>
  ))
}

export function rowsToText(rows: ClaimRow[]): string {
  return rows.map((r) => `${r.key}: ${r.value}${r.iso ? ` (${r.iso})` : ''}`).join('\n')
}

export const FIELD_STYLE = {
  background: 'var(--white)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
} as const
