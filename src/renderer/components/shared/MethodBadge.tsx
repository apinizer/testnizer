import { getMethodColors } from '../../styles/tokens'

const METHOD_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  GET:     { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
  POST:    { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
  PUT:     { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
  PATCH:   { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' },
  DELETE:  { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' },
  HEAD:    { bg: '#ede9fe', color: '#5b21b6', border: '#ddd6fe' },
  OPTIONS: { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
}

interface MethodBadgeProps {
  method: string
  small?: boolean
}

export default function MethodBadge({ method, small = false }: MethodBadgeProps) {
  const c = getMethodColors(method)
  return (
    <span
      style={{
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        padding: small ? '1px 5px' : '3px 9px',
        fontSize: small ? 9 : 11,
        fontWeight: 700,
        fontFamily: "'SF Mono','Cascadia Code','Fira Code',monospace",
        letterSpacing: '0.03em',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {method}
    </span>
  )
}

export { METHOD_COLORS }
