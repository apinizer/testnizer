import { useResponseStore } from '../../stores/response.store'
import { useTranslation } from '../../lib/i18n'

// Header and rows are separate grids — they only line up because they share
// this exact template. Value gets a double-width column (col-span-2) since
// JWT-sized values are the common long case (issue #105).
const GRID_TEMPLATE = 'grid grid-cols-6 gap-4'

export default function CookieTab() {
  const { t } = useTranslation()
  const response = useResponseStore((s) => s.response)
  const cookies = response?.cookies || []

  if (cookies.length === 0) {
    return <div className="p-4 text-center text-[var(--hint)]">{t('response.cookies.none')}</div>
  }

  return (
    <div className="p-3.5 font-mono">
      {/* Header */}
      <div className={`${GRID_TEMPLATE} mb-1 font-medium text-[var(--muted)]`}>
        <span className="min-w-0">{t('response.cookies.name')}</span>
        <span className="col-span-2 min-w-0">{t('response.cookies.value')}</span>
        <span className="min-w-0">{t('response.cookies.domain')}</span>
        <span className="min-w-0">{t('response.cookies.path')}</span>
        <span className="min-w-0">{t('response.cookies.flags')}</span>
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
            className={`${GRID_TEMPLATE} items-start border-b border-[var(--border)] py-1.5`}
          >
            <span className="min-w-0 break-all text-[var(--accent-text)]">{cookie.name}</span>
            <span className="col-span-2 min-w-0 break-all text-[var(--text)]">{cookie.value}</span>
            <span className="min-w-0 break-all text-[var(--muted)]">{cookie.domain || '-'}</span>
            <span className="min-w-0 break-all text-[var(--muted)]">{cookie.path || '/'}</span>
            <span className="min-w-0 break-words text-[var(--orange)]">
              {flags.join(', ') || '-'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
