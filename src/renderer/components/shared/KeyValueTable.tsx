import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type { KeyValuePair } from '../../types'
import VariableAutocompleteInput from './VariableAutocompleteInput'

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

/** Autocomplete dropdown rendered via portal so it's never clipped */
function AutocompleteDropdown({
  anchorRef,
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
}: {
  anchorRef: React.RefObject<HTMLInputElement | null>
  suggestions: string[]
  selectedIndex: number
  onSelect: (s: string) => void
  onHover: (i: number) => void
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
    }
  }, [anchorRef, suggestions])

  return createPortal(
    <div
      className="fixed z-[9999] max-h-[200px] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--white)]"
      style={{ top: pos.top, left: pos.left, width: pos.width, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
    >
      {suggestions.map((s, i) => (
        <div
          key={s}
          className="cursor-pointer px-2.5 py-1 text-[13px]"
          style={{
            background: i === selectedIndex ? 'var(--accent-light)' : 'transparent',
            color: i === selectedIndex ? 'var(--accent-text)' : 'var(--text)',
          }}
          onMouseDown={() => onSelect(s)}
          onMouseEnter={() => onHover(i)}
        >
          {s}
        </div>
      ))}
    </div>,
    document.body
  )
}

const GRID_COLS = '28px minmax(100px, 1fr) minmax(100px, 1fr) minmax(80px, 0.5fr) 28px'

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
  const activeInputRef = useRef<HTMLInputElement | null>(null)

  // Close autocomplete on outside click
  useEffect(() => {
    if (!autocomplete) return
    const handler = () => setAutocomplete(null)
    // Delay to let onMouseDown fire first
    const timeout = setTimeout(() => {
      window.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('mousedown', handler)
    }
  }, [autocomplete])

  const handleKeyInputChange = useCallback(
    (rowId: string, value: string, ref: HTMLInputElement | null) => {
      onUpdate(rowId, { key: value })
      if (!enableAutocomplete) return
      activeInputRef.current = ref
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
    },
    [enableAutocomplete, onUpdate]
  )

  const handleValueInputChange = useCallback(
    (rowId: string, key: string, value: string, ref: HTMLInputElement | null) => {
      onUpdate(rowId, { value })
      if (!enableAutocomplete) return
      activeInputRef.current = ref
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
    },
    [enableAutocomplete, onUpdate]
  )

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
      <div className="overflow-visible rounded-md border border-[var(--border)]" style={{ background: 'var(--white)' }}>
        {/* Header */}
        <div
          className="grid text-[11px] text-[var(--hint)]"
          style={{
            gridTemplateColumns: GRID_COLS,
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div />
          <div className="px-2.5 py-1">Key</div>
          <div className="px-2.5 py-1">Value</div>
          <div className="px-2.5 py-1">Description</div>
          <div />
        </div>

        {/* Rows */}
        {rows.map((row, idx) => (
          <div
            key={row.id}
            className="group grid"
            style={{
              gridTemplateColumns: GRID_COLS,
              borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : 'none',
              opacity: row.enabled ? 1 : 0.45,
            }}
          >
            {/* Checkbox */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => onUpdate(row.id, { enabled: !row.enabled })}
                className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm"
                style={{
                  border: `1.5px solid ${row.enabled ? 'var(--accent)' : 'var(--hint)'}`,
                  background: row.enabled ? 'var(--accent)' : 'transparent',
                }}
              >
                {row.enabled && <Check size={9} color="white" strokeWidth={3} />}
              </button>
            </div>

            {/* Key */}
            <div className="relative" style={{ borderRight: '1px solid var(--border)' }}>
              <input
                value={row.key}
                onChange={(e) => handleKeyInputChange(row.id, e.target.value, e.currentTarget)}
                onFocus={(e) => {
                  if (enableAutocomplete && row.key.length > 0) {
                    activeInputRef.current = e.currentTarget
                    const filtered = COMMON_HEADERS.filter((h) =>
                      h.toLowerCase().includes(row.key.toLowerCase())
                    )
                    if (filtered.length > 0) {
                      setAutocomplete({ rowId: row.id, field: 'key', suggestions: filtered, selectedIndex: 0 })
                    }
                  }
                }}
                onKeyDown={handleKeyDown}
                className="w-full border-none bg-transparent px-2.5 py-[5px] text-[13px] text-[var(--text)] outline-none"
                placeholder="Key"
              />
            </div>

            {/* Value */}
            <div className="relative" style={{ borderRight: '1px solid var(--border)' }}>
              <VariableAutocompleteInput
                value={row.value}
                onChange={(val) => handleValueInputChange(row.id, row.key, val, null)}
                onKeyDown={handleKeyDown}
                className="w-full border-none bg-transparent px-2.5 py-[5px] text-[13px] outline-none"
                style={{ color: valueColor || 'var(--text)' }}
                placeholder="Value"
              />
            </div>

            {/* Description */}
            <div>
              <input
                value={row.description || ''}
                onChange={(e) => onUpdate(row.id, { description: e.target.value })}
                className="w-full border-none bg-transparent px-2.5 py-[5px] text-[13px] text-[var(--muted)] outline-none"
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

        {/* Placeholder row */}
        <div
          className="grid cursor-pointer"
          style={{
            gridTemplateColumns: GRID_COLS,
            borderTop: rows.length > 0 ? '1px solid var(--border)' : 'none',
          }}
          onClick={onAdd}
        >
          <div />
          <div className="px-2.5 py-[5px] text-[13px] text-[var(--hint)]">
            Add new...
          </div>
          <div />
          <div />
          <div />
        </div>
      </div>

      {/* Add button */}
      <button
        type="button"
        onClick={onAdd}
        className="mt-1.5 w-full cursor-pointer rounded-md border border-dashed border-[var(--border)] bg-transparent py-1 text-[13px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {addLabel}
      </button>

      {/* Autocomplete portal */}
      {autocomplete && autocomplete.suggestions.length > 0 && (
        <AutocompleteDropdown
          anchorRef={activeInputRef}
          suggestions={autocomplete.suggestions}
          selectedIndex={autocomplete.selectedIndex}
          onSelect={selectSuggestion}
          onHover={(i) => setAutocomplete((prev) => (prev ? { ...prev, selectedIndex: i } : null))}
        />
      )}
    </div>
  )
}
