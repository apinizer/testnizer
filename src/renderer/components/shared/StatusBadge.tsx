interface StatusBadgeProps {
  status: number
  statusText?: string
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return '#1a7a4a'
  if (status >= 300 && status < 400) return '#0066cc'
  if (status >= 400 && status < 500) return '#b35a00'
  return '#cc2200'
}

export default function StatusBadge({ status, statusText }: StatusBadgeProps) {
  const color = getStatusColor(status)

  return (
    <span className="flex items-center gap-1.5 text-[0.875rem] font-bold" style={{ color }}>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {status} {statusText || ''}
    </span>
  )
}

export { getStatusColor }
