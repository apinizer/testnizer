import { useResponseStore } from '../../stores/response.store'

export default function CookieTab() {
  const response = useResponseStore((s) => s.response)
  const cookies = response?.cookies || []

  if (cookies.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-[var(--hint)]">No cookies in response.</div>
    )
  }

  return (
    <div className="p-3.5 font-mono text-sm">
      {/* Header */}
      <div className="mb-1 grid grid-cols-5 gap-4 text-[0.875rem] font-medium text-[var(--muted)]">
        <span>Name</span>
        <span>Value</span>
        <span>Domain</span>
        <span>Path</span>
        <span>Flags</span>
      </div>

      {/* Rows */}
      {cookies.map((cookie, idx) => {
        const flags: string[] = []
        if (cookie.httpOnly) flags.push('HttpOnly')
        if (cookie.secure) flags.push('Secure')
        if (cookie.sameSite) flags.push(`SameSite=${cookie.sameSite}`)

        return (
          <div
            key={`${cookie.name}-${idx}`}
            className="grid grid-cols-5 gap-4 border-b border-[var(--border)] py-1.5"
          >
            <span className="text-[var(--accent-text)]">{cookie.name}</span>
            <span className="text-[var(--text)]">{cookie.value}</span>
            <span className="text-[var(--muted)]">{cookie.domain || '-'}</span>
            <span className="text-[var(--muted)]">{cookie.path || '/'}</span>
            <span className="text-[0.875rem] text-[var(--orange)]">{flags.join(', ') || '-'}</span>
          </div>
        )
      })}
    </div>
  )
}
