interface StatusBadgeProps {
  status: number
  statusText?: string
  /** When true, renders as a Postman-style solid pill (e.g. on top-right of response pane) */
  pill?: boolean
}

/**
 * Status code → semantic color key. Maps to CSS vars so dark mode adapts.
 */
function getStatusVar(status: number): { fg: string; bg: string; border: string } {
  if (status >= 200 && status < 300) {
    return { fg: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-border)' }
  }
  if (status >= 300 && status < 400) {
    return { fg: 'var(--blue)', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.32)' }
  }
  if (status >= 400 && status < 500) {
    return { fg: 'var(--orange)', bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.34)' }
  }
  return { fg: 'var(--red)', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.32)' }
}

/** Legacy helper — returns the foreground color string for this status. */
function getStatusColor(status: number): string {
  return getStatusVar(status).fg
}

export default function StatusBadge({ status, statusText, pill = false }: StatusBadgeProps) {
  const { fg, bg, border } = getStatusVar(status)

  if (pill) {
    return (
      <span
        className="inline-flex items-center rounded-[4px] px-2 py-[3px] font-semibold"
        style={{
          color: fg,
          background: bg,
          border: `1px solid ${border}`,
        }}
      >
        {status} {statusText || ''}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 font-bold" style={{ color: fg }}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: fg }} />
      {status} {statusText || ''}
    </span>
  )
}

export { getStatusColor }
