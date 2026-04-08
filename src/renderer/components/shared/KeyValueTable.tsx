import { useState, useRef, useEffect } from 'react'
import { Check, X } from 'lucide-react'
import type { KeyValuePair } from '../../types'

const COMMON_HEADERS = [
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Length',
  'Content-Type',
  'Cookie',
  'Date',
  'ETag',
  'Expect',
  'Forwarded',
  'From',
  'Host',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'If-Range',
  'If-Unmodified-Since',
  'Keep-Alive',
  'Origin',
  'Pragma',
  'Proxy-Authorization',
  'Range',
  'Referer',
  'SOAPAction',
  'Set-Cookie',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'User-Agent',
  'Via',
  'Warning',
  'X-API-Key',
  'X-API-Version',
  'X-Content-Type-Options',
  'X-Correlation-ID',
  'X-Forwarded-For',
  'X-Forwarded-Host',
  'X-Forwarded-Proto',
  'X-Frame-Options',
  'X-Request-ID',
  'X-Requested-With',
  'X-XSS-Protection',
]

const CONTENT_TYPE_VALUES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'application/octet-stream',
  'application/soap+xml',
  'application/graphql',
  'application/javascript',
  'application/pdf',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'text/xml',
  'text/xml; charset=utf-8',
  'text/csv',
]

interface KeyValueTableProps {
  rows: KeyValuePair[]
  onUpdate: (id: string, updates: Partial<KeyValuePair>) => void
  onRemove: (id: string) => void
  onAdd: () => void
  addLabel?: string
  valueColor?: string
  enableAutocomplete?: boolean
}

interface AutocompleteState {
  rowId: string
  field: 'key' | 'value'
  suggestions: string[]
  selectedIndex: number
}

export default function KeyValueTable({
  rows,
  onUpdate,
  onRemove,
  onAdd,
  addLabel = '+ Add Parameter',
  valueColor,
  enableAutocomplete = false,
}: KeyValueTableProps) {
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAutocomplete(null)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  function handleKeyInputChange(rowId: string, value: string) {
    onUpdate(rowId, { key: value })
    if (!enableAutocomplete) return
    if (value.length > 0) {
      const filtered = COMMON_HEADERS.filter((h) =>
        h.toLowerCase().includes(value.toLowerCase())
      )
      if (filtered.length > 0) {
        setAutocomplete({ rowId, field: 'key', suggestions: filtered, selectedIndex: 0 })
      } else {
        setAutocomplete(null)
      }
    } else {
      setAutocomplete(null)
    }
  }

  function handleValueInputChange(rowId: string, key: string, value: string) {
    onUpdate(rowId, { value })
    if (!enableAutocomplete) return
    if (key.toLowerCase() === 'content-type' && value.length > 0) {
      const filtered = CONTENT_TYPE_VALUES.filter((v) =>
        v.toLowerCase().includes(value.toLowerCase())
      )
      if (filtered.length > 0) {
        setAutocomplete({ rowId, field: 'value', suggestions: filtered, selectedIndex: 0 })
      } else {
        setAutocomplete(null)
      }
    } else {
      setAutocomplete(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!autocomplete) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAutocomplete((prev) =>
        prev ? { ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, prev.suggestions.length - 1) } : null
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAutocomplete((prev) =>
        prev ? { ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) } : null
      )
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (autocomplete.suggestions.length > 0) {
        e.preventDefault()
        const selected = autocomplete.suggestions[autocomplete.selectedIndex]
        if (autocomplete.field === 'key') {
          onUpdate(autocomplete.rowId, { key: selected })
        } else {
          onUpdate(autocomplete.rowId, { value: selected })
        }
        setAutocomplete(null)
      }
    } else if (e.key === 'Escape') {
      setAutocomplete(null)
    }
  }

  function selectSuggestion(suggestion: string) {
    if (!autocomplete) return
    if (autocomplete.field === 'key') {
      onUpdate(autocomplete.rowId, { key: suggestion })
    } else {
      onUpdate(autocomplete.rowId, { value: suggestion })
    }
    setAutocomplete(null)
  }

  return (
    <div>
      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-[var(--border)]" style={{ background: 'var(--white)' }}>
        {/* Header row — Apidog style: Name | Value | Description */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: '32px minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 0.6fr) 32px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            borderRadius: '8px 8px 0 0',
          }}
        >
          <div />
          <div className="px-2.5 py-1.5" style={{ fontSize: 11, color: 'var(--hint)', fontWeight: 400, fontFamily: 'inherit' }}>
            Ad
          </div>
          <div className="px-2.5 py-1.5" style={{ fontSize: 11, color: 'var(--hint)', fontWeight: 400, fontFamily: 'inherit' }}>
            Değer
          </div>
          <div className="px-2.5 py-1.5" style={{ fontSize: 11, color: 'var(--hint)', fontWeight: 400, fontFamily: 'inherit' }}>
            Açıklama
          </div>
          <div />
        </div>

        {/* Data rows */}
        {rows.map((row, idx) => (
          <div
            key={row.id}
            className="group relative grid"
            style={{
              gridTemplateColumns: '32px minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 0.6fr) 32px',
              borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none',
              opacity: row.enabled ? 1 : 0.45,
              background: 'var(--white)',
            }}
          >
            {/* Checkbox */}
            <div className="flex items-center justify-center py-1">
              <button
                type="button"
                onClick={() => onUpdate(row.id, { enabled: !row.enabled })}
                className="flex h-[14px] w-[14px] shrink-0 cursor-pointer items-center justify-center rounded-[3px]"
                style={{
                  border: `1.5px solid ${row.enabled ? 'var(--accent)' : 'var(--hint)'}`,
                  background: row.enabled ? 'var(--accent)' : 'transparent',
                }}
              >
                {row.enabled && <Check size={9} color="white" strokeWidth={3} />}
              </button>
            </div>

            {/* Name/Key */}
            <div className="relative" style={{ borderRight: '1px solid var(--border)' }}>
              <input
                value={row.key}
                onChange={(e) => handleKeyInputChange(row.id, e.target.value)}
                onFocus={() => {
                  if (enableAutocomplete && row.key.length > 0) {
                    const filtered = COMMON_HEADERS.filter((h) =>
                      h.toLowerCase().includes(row.key.toLowerCase())
                    )
                    if (filtered.length > 0) {
                      setAutocomplete({ rowId: row.id, field: 'key', suggestions: filtered, selectedIndex: 0 })
                    }
                  }
                }}
                onKeyDown={handleKeyDown}
                className="w-full border-none bg-transparent px-3 py-[7px] text-[0.8125rem] text-[var(--text)] outline-none"
                style={{ fontFamily: 'inherit' }}
                placeholder="Name"
              />
              {autocomplete && autocomplete.rowId === row.id && autocomplete.field === 'key' && (
                <div
                  ref={dropdownRef}
                  className="absolute left-0 top-full z-[300] max-h-[200px] w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--white)]"
                  style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.1)' }}
                >
                  {autocomplete.suggestions.map((s, i) => (
                    <div
                      key={s}
                      className="cursor-pointer px-3 py-1.5 text-[0.8125rem]"
                      style={{
                        background: i === autocomplete.selectedIndex ? 'var(--accent-light)' : 'transparent',
                        color: i === autocomplete.selectedIndex ? 'var(--accent-text)' : 'var(--text)',
                      }}
                      onMouseDown={() => selectSuggestion(s)}
                      onMouseEnter={() =>
                        setAutocomplete((prev) => (prev ? { ...prev, selectedIndex: i } : null))
                      }
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Value */}
            <div className="relative" style={{ borderRight: '1px solid var(--border)' }}>
              <input
                value={row.value}
                onChange={(e) => handleValueInputChange(row.id, row.key, e.target.value)}
                onFocus={() => {
                  if (enableAutocomplete && row.key.toLowerCase() === 'content-type' && row.value.length > 0) {
                    const filtered = CONTENT_TYPE_VALUES.filter((v) =>
                      v.toLowerCase().includes(row.value.toLowerCase())
                    )
                    if (filtered.length > 0) {
                      setAutocomplete({ rowId: row.id, field: 'value', suggestions: filtered, selectedIndex: 0 })
                    }
                  }
                }}
                onKeyDown={handleKeyDown}
                className="w-full border-none bg-transparent px-3 py-[7px] text-[0.8125rem] outline-none"
                style={{ color: valueColor || 'var(--text)', fontFamily: 'inherit' }}
                placeholder="Value"
              />
              {autocomplete && autocomplete.rowId === row.id && autocomplete.field === 'value' && (
                <div
                  ref={dropdownRef}
                  className="absolute left-0 top-full z-[300] max-h-[200px] w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--white)]"
                  style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.1)' }}
                >
                  {autocomplete.suggestions.map((s, i) => (
                    <div
                      key={s}
                      className="cursor-pointer px-3 py-1.5 text-[0.8125rem]"
                      style={{
                        background: i === autocomplete.selectedIndex ? 'var(--accent-light)' : 'transparent',
                        color: i === autocomplete.selectedIndex ? 'var(--accent-text)' : 'var(--text)',
                      }}
                      onMouseDown={() => selectSuggestion(s)}
                      onMouseEnter={() =>
                        setAutocomplete((prev) => (prev ? { ...prev, selectedIndex: i } : null))
                      }
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <input
                value={row.description || ''}
                onChange={(e) => onUpdate(row.id, { description: e.target.value })}
                className="w-full border-none bg-transparent px-3 py-[7px] text-[0.8125rem] text-[var(--muted)] outline-none"
                style={{ fontFamily: 'inherit' }}
                placeholder="Description"
              />
            </div>

            {/* Delete */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                style={{ background: 'transparent', border: 'none', color: 'var(--hint)', padding: 2 }}
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hint)' }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}

        {/* Placeholder row — "Add a new param" like Apidog */}
        <div
          className="grid cursor-pointer"
          style={{
            gridTemplateColumns: '32px minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 0.6fr) 32px',
            borderTop: rows.length > 0 ? '1px solid var(--border)' : 'none',
            background: 'var(--white)',
          }}
          onClick={onAdd}
        >
          <div />
          <div className="px-3 py-[7px] text-[0.8125rem]" style={{ color: 'var(--muted)' }}>
            Add a new param
          </div>
          <div />
          <div />
          <div />
        </div>
      </div>

      {/* "+" add button below table */}
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 w-full cursor-pointer rounded-[7px] border border-dashed border-[var(--border)] bg-transparent py-1.5 text-[0.8125rem] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        style={{ color: 'var(--muted)' }}
      >
        {addLabel}
      </button>
    </div>
  )
}
