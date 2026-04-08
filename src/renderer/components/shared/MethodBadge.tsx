const METHOD_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  GET: { bg: '#e8f4ff', color: '#0066cc', border: '#b3d4f5' },
  POST: { bg: '#e8f9f1', color: '#1a7a4a', border: '#b3e5cc' },
  PUT: { bg: '#fff4e0', color: '#b35a00', border: '#f5d4a0' },
  PATCH: { bg: '#f0faf5', color: '#0a7a5a', border: '#a0e0c8' },
  DELETE: { bg: '#fff0f0', color: '#cc2200', border: '#f5b3b3' },
  HEAD: { bg: '#f5f0ff', color: '#6600cc', border: '#d4b3f5' },
  OPTIONS: { bg: '#f0f5ff', color: '#0044aa', border: '#b3c4f5' },
}

interface MethodBadgeProps {
  method: string
  small?: boolean
}

export default function MethodBadge({ method, small = false }: MethodBadgeProps) {
  const c = METHOD_COLORS[method] || METHOD_COLORS.GET
  return (
    <span
      className="inline-block shrink-0 whitespace-nowrap font-mono font-bold tracking-wide"
      style={{
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        padding: small ? '1px 5px' : '2px 8px',
        fontSize: small ? '0.65rem' : '0.786rem',
        letterSpacing: '0.02em',
      }}
    >
      {method}
    </span>
  )
}

export { METHOD_COLORS }
