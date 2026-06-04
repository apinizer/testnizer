import { useMemo, useState } from 'react'
import ToolShell from './ToolShell'
import { HTTP_STATUS_CODES, type HttpStatus } from '../../lib/tools/http-status'
import { useTranslation } from '../../lib/i18n'

const CATEGORIES: { id: HttpStatus['category']; color: string }[] = [
  { id: '1xx', color: '#0066cc' },
  { id: '2xx', color: '#1a7a4a' },
  { id: '3xx', color: '#b35a00' },
  { id: '4xx', color: '#cc2200' },
  { id: '5xx', color: '#7c1fa6' },
]

export default function HttpStatusTool() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<HttpStatus['category'] | 'all'>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return HTTP_STATUS_CODES.filter((s) => {
      if (activeCategory !== 'all' && s.category !== activeCategory) return false
      if (!q) return true
      return (
        String(s.code).includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      )
    })
  }, [query, activeCategory])

  const groups = useMemo(() => {
    const map = new Map<HttpStatus['category'], HttpStatus[]>()
    for (const s of filtered) {
      const arr = map.get(s.category) ?? []
      arr.push(s)
      map.set(s.category, arr)
    }
    return CATEGORIES.map((c) => ({ ...c, items: map.get(c.id) ?? [] })).filter(
      (g) => g.items.length > 0,
    )
  }, [filtered])

  const toolbar = (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('tools.httpStatus.search')}
        className="rounded border px-2 py-1 text-xs"
        style={{
          width: 220,
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      />
      <div
        className="flex items-center rounded p-0.5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <FilterPill active={activeCategory === 'all'} onClick={() => setActiveCategory('all')}>
          {t('tools.httpStatus.all')}
        </FilterPill>
        {CATEGORIES.map((c) => (
          <FilterPill
            key={c.id}
            active={activeCategory === c.id}
            color={c.color}
            onClick={() => setActiveCategory(c.id)}
          >
            {c.id}
          </FilterPill>
        ))}
      </div>
    </>
  )

  return (
    <ToolShell
      title={t('tools.httpStatus.title')}
      toolbar={toolbar}
      inputPane={
        <div className="h-full overflow-auto">
          {groups.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
              {t('tools.httpStatus.noMatches')}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.id}>
                <div
                  className="sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-1.5 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: g.color,
                  }}
                >
                  <span
                    className="rounded px-1.5 py-0.5"
                    style={{ background: g.color + '20', color: g.color }}
                  >
                    {g.id}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>{labelForCategory(g.id, t)}</span>
                </div>
                <div>
                  {g.items.map((s) => (
                    <CodeRow key={s.code} status={s} color={g.color} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      }
      outputPane={
        <div className="h-full overflow-auto p-4 text-sm" style={{ color: 'var(--text)' }}>
          <h3 className="m-0 mb-2 text-base font-semibold" style={{ color: 'var(--heading)' }}>
            {t('tools.httpStatus.referenceTitle')}
          </h3>
          <p style={{ color: 'var(--muted)' }}>{t('tools.httpStatus.intro')}</p>
          <ul className="my-2 list-disc pl-5" style={{ color: 'var(--muted)' }}>
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <span className="font-mono font-semibold" style={{ color: c.color }}>
                  {c.id}
                </span>{' '}
                — {labelForCategory(c.id, t)}
              </li>
            ))}
          </ul>
          <p style={{ color: 'var(--muted)' }}>{t('tools.httpStatus.tip')}</p>
        </div>
      }
      footer={
        <span>
          {filtered.length} {t('tools.httpStatus.codes')}
        </span>
      }
    />
  )
}

function labelForCategory(c: HttpStatus['category'], t: (k: string) => string): string {
  switch (c) {
    case '1xx':
      return t('tools.httpStatus.cat1')
    case '2xx':
      return t('tools.httpStatus.cat2')
    case '3xx':
      return t('tools.httpStatus.cat3')
    case '4xx':
      return t('tools.httpStatus.cat4')
    case '5xx':
      return t('tools.httpStatus.cat5')
  }
}

function CodeRow({ status, color }: { status: HttpStatus; color: string }) {
  return (
    <div className="flex gap-3 border-b px-4 py-2" style={{ borderColor: 'var(--border)' }}>
      <span
        className="shrink-0 rounded px-2 py-0.5 font-mono text-sm font-semibold"
        style={{
          background: color + '15',
          color,
          border: `1px solid ${color}40`,
          minWidth: 48,
          textAlign: 'center',
        }}
      >
        {status.code}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {status.name}
        </div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          {status.description}
        </div>
      </div>
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean
  onClick: () => void
  color?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="rounded px-2 py-0.5 text-[11px] font-semibold"
      style={{
        background: active ? 'var(--white)' : 'transparent',
        color: active ? (color ?? 'var(--text)') : 'var(--muted)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      {children}
    </button>
  )
}
