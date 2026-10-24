import type { KeyValuePair } from '../../types'
import VariableAutocompleteInput from '../shared/VariableAutocompleteInput'
import { useTranslation } from '../../lib/i18n'

/**
 * The Params tab's Path Variables table (issue #276) — the same anatomy as the
 * query-params `KeyValueTable` (flush grid, Key / Value / Description), but the
 * rows come from the URL's `:name` segments: no add / remove / enable, the key
 * is read-only, a row appears or disappears as the URL changes.
 */
const GRID_COLS = '28px minmax(100px, 1fr) minmax(100px, 1fr) minmax(80px, 0.5fr) 28px'

interface PathVariablesTableProps {
  rows: KeyValuePair[]
  onUpdate: (id: string, updates: Partial<Pick<KeyValuePair, 'value' | 'description'>>) => void
}

export default function PathVariablesTable({ rows, onUpdate }: PathVariablesTableProps) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="path-variables-table"
      className="overflow-visible"
      style={{ background: 'var(--white)' }}
    >
      <div
        className="grid text-[var(--hint)]"
        style={{
          gridTemplateColumns: GRID_COLS,
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <div />
        <div className="px-2.5 py-1">{t('kv.key')}</div>
        <div className="px-2.5 py-1">{t('kv.value')}</div>
        <div className="px-2.5 py-1">{t('kv.description')}</div>
        <div />
      </div>
      {rows.map((row, idx) => (
        <div
          key={row.id}
          data-testid={`path-var-row-${row.key}`}
          className="grid"
          style={{
            gridTemplateColumns: GRID_COLS,
            borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none',
          }}
        >
          <div />
          <div
            data-testid="path-var-key"
            className="truncate px-2.5 py-[5px] font-mono text-[var(--text)]"
            style={{ borderRight: '1px solid var(--border)' }}
            title={`:${row.key}`}
          >
            {row.key}
          </div>
          <div style={{ borderRight: '1px solid var(--border)' }}>
            <VariableAutocompleteInput
              data-testid="path-var-value"
              value={row.value}
              onChange={(value) => onUpdate(row.id, { value })}
              className="w-full border-none bg-transparent px-2.5 py-[5px] outline-none"
              style={{ color: 'var(--text)' }}
              placeholder={t('kv.value')}
            />
          </div>
          <div>
            <input
              data-testid="path-var-description"
              value={row.description || ''}
              onChange={(e) => onUpdate(row.id, { description: e.target.value })}
              className="w-full border-none bg-transparent px-2.5 py-[5px] text-[var(--muted)] outline-none"
              placeholder={t('kv.description')}
            />
          </div>
          <div />
        </div>
      ))}
    </div>
  )
}
