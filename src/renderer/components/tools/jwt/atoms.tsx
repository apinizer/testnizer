import { useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { ClaimRow } from '../../../lib/tools/jwt'

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
        background: active ? 'var(--accentLight)' : 'transparent',
        color: active ? 'var(--accentText)' : 'var(--muted)',
        border: '1px solid',
        borderColor: active ? 'var(--accentText)' : 'var(--border)',
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

export function CopyButton({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={copied ? t('tools.common.copied') : t('tools.common.copy')}
      className="rounded border px-1.5 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border)',
        color: copied ? 'var(--green, #1a7a4a)' : 'var(--muted)',
        background: 'var(--white)',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

export function ClearButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded border px-1.5 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border)',
        color: 'var(--muted)',
        background: 'var(--white)',
      }}
      title="Clear"
    >
      ✕
    </button>
  )
}

export function Badge({
  color,
  children,
}: {
  color: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: color + '15', color, border: `1px solid ${color}40` }}
    >
      {children}
    </span>
  )
}

/** jwt.io-style three-color JWT split by dots. */
export function ColorizedJwt({ token }: { token: string }): React.JSX.Element {
  const parts = token.split('.')
  const colors = ['#b35a00', '#7c1fa6', '#0a7a5a']
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

/** Very small JSON colorizer for the read-only decoded view. */
export function colorizeJson(src: string): React.ReactNode {
  const tokens: { v: string; c: string }[] = []
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([\s\S])/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) {
      const isKey = !!m[2]
      tokens.push({ v: m[1], c: isKey ? '#0066cc' : '#1a7a4a' })
      if (m[2]) tokens.push({ v: m[2], c: 'inherit' })
    } else if (m[3] !== undefined) {
      tokens.push({ v: m[3], c: '#0066cc' })
    } else if (m[4] !== undefined) {
      tokens.push({ v: m[4], c: '#b35a00' })
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
