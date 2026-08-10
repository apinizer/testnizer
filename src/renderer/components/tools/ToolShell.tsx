import type { ReactNode } from 'react'

interface ToolShellProps {
  title: string
  toolbar?: ReactNode
  inputPane: ReactNode
  outputPane: ReactNode
  footer?: ReactNode
  /**
   * Colour for the footer text. Defaults to muted.
   *
   * A verdict belongs in colour: WS-Security printed "Signature is valid" and
   * "Signature INVALID" in the same grey, so the two outcomes a signature
   * checker exists to distinguish looked identical at a glance.
   */
  footerTone?: 'muted' | 'ok' | 'error'
  inputLabel?: string
  outputLabel?: string
}

const FOOTER_TONE_COLOR: Record<'muted' | 'ok' | 'error', string> = {
  muted: 'var(--muted)',
  ok: 'var(--green, #1a7a4a)',
  error: '#cc2200',
}

/**
 * Common layout for all standalone tool tabs (JWT, JSON formatter, encode/decode, etc.).
 * Two side-by-side panes with optional toolbar above and footer below.
 */
export default function ToolShell({
  title,
  toolbar,
  inputPane,
  outputPane,
  footer,
  footerTone,
  inputLabel,
  outputLabel,
}: ToolShellProps) {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--heading)' }}>
          {title}
        </h2>
        {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex min-w-0 flex-1 flex-col border-r"
          style={{ borderColor: 'var(--border)' }}
        >
          {inputLabel ? (
            <div
              className="shrink-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)', background: 'var(--surface)' }}
            >
              {inputLabel}
            </div>
          ) : null}
          <div className="flex-1 min-h-0">{inputPane}</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {outputLabel ? (
            <div
              className="shrink-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)', background: 'var(--surface)' }}
            >
              {outputLabel}
            </div>
          ) : null}
          <div className="flex-1 min-h-0">{outputPane}</div>
        </div>
      </div>

      {footer ? (
        <div
          role="status"
          className="shrink-0 border-t px-3 py-1.5 text-xs"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--white)',
            color: FOOTER_TONE_COLOR[footerTone ?? 'muted'],
            fontWeight: footerTone && footerTone !== 'muted' ? 600 : undefined,
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
