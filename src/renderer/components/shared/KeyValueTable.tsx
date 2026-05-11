import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Check, X, Upload } from 'lucide-react'
import type { KeyValuePair } from '../../types'
import VariableAutocompleteInput from './VariableAutocompleteInput'
import { useTranslation } from '../../lib/i18n'
import { filterHeaderSuggestions } from '../../lib/http-headers'
import { rowsToBulkText, bulkTextToRows } from '../../lib/key-value-bulk'

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
  /**
   * When true, the value cell offers context-sensitive suggestions
   * (currently: Content-Type values). Independent of `keyAutocompleteEntries`.
   */
  enableAutocomplete?: boolean
  /**
   * Header-name suggestions for the key column. When provided and the user
   * has typed at least one character (and is not in the middle of a `{{var}}`
   * expression), a prefix-matched suggestion popup is shown.
   *
   * Callers pass this only when the table represents an HTTP-style header
   * list — query-param tables omit it so the popup never appears there.
   */
  keyAutocompleteEntries?: readonly string[]
  /**
   * When true, render a Type column (Text / File) and turn the Value cell
   * into a file picker for rows where `type === 'file'`. Used by the
   * multipart/form-data body editor.
   */
  enableFileType?: boolean
  /**
   * Replace the entire row list — used by Bulk Edit mode to commit a parsed
   * textarea back to the parent store in one shot. When omitted the Bulk
   * Edit toggle is hidden.
   */
  onReplaceAll?: (rows: KeyValuePair[]) => void
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
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}
    >
      {suggestions.map((s, i) => (
        <div
          key={s}
          className="cursor-pointer px-2.5 py-1"
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
    document.body,
  )
}

const GRID_COLS = '28px minmax(100px, 1fr) minmax(100px, 1fr) minmax(80px, 0.5fr) 28px'
const GRID_COLS_FILE = '28px minmax(100px, 1fr) 76px minmax(120px, 1fr) minmax(80px, 0.5fr) 28px'

export default function KeyValueTable({
  rows,
  onUpdate,
  onRemove,
  onAdd,
  addLabel,
  valueColor,
  enableAutocomplete = false,
  keyAutocompleteEntries,
  enableFileType = false,
  onReplaceAll,
}: KeyValueTableProps) {
  const keyAutocompleteEnabled = !!keyAutocompleteEntries && keyAutocompleteEntries.length > 0
  const { t } = useTranslation()
  const resolvedAddLabel = addLabel ?? `+ ${t('kv.key')} / ${t('kv.value')}`
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

  /**
   * Returns true when the cursor (assumed at end-of-value here, since the
   * native input doesn't expose caret data through onChange) is inside an
   * unclosed `{{...` expression. In that case we skip header-name autocomplete
   * so the variable autocomplete (handled by VariableAutocompleteInput on the
   * value side, and by the user's typing pattern on the key side) takes
   * precedence and we don't pollute the popup with header names.
   */
  function isInsideVariableExpression(value: string): boolean {
    const lastOpen = value.lastIndexOf('{{')
    if (lastOpen === -1) return false
    const lastClose = value.lastIndexOf('}}')
    return lastClose < lastOpen
  }

  const handleKeyInputChange = useCallback(
    (rowId: string, value: string, ref: HTMLInputElement | null) => {
      onUpdate(rowId, { key: value })
      if (!keyAutocompleteEnabled || !keyAutocompleteEntries) return
      activeInputRef.current = ref
      if (value.length === 0 || isInsideVariableExpression(value)) {
        setAutocomplete(null)
        return
      }
      const filtered = filterHeaderSuggestions(value, keyAutocompleteEntries)
      if (filtered.length > 0) {
        setAutocomplete({ rowId, field: 'key', suggestions: filtered, selectedIndex: 0 })
      } else {
        setAutocomplete(null)
      }
    },
    [keyAutocompleteEnabled, keyAutocompleteEntries, onUpdate],
  )

  const handleValueInputChange = useCallback(
    (rowId: string, key: string, value: string, ref: HTMLInputElement | null) => {
      onUpdate(rowId, { value })
      if (!enableAutocomplete) return
      activeInputRef.current = ref
      if (key.toLowerCase() === 'content-type' && value.length > 0) {
        const filtered = CONTENT_TYPE_VALUES.filter((v) =>
          v.toLowerCase().includes(value.toLowerCase()),
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
    [enableAutocomplete, onUpdate],
  )

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!autocomplete) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAutocomplete((prev) =>
        prev
          ? {
              ...prev,
              selectedIndex: Math.min(prev.selectedIndex + 1, prev.suggestions.length - 1),
            }
          : null,
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAutocomplete((prev) =>
        prev ? { ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) } : null,
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

  /**
   * Open the native file dialog and apply the chosen file to a row. The main
   * process returns a `{ filePath, fileName, size }` payload — we store
   * `filePath` (used by http.engine for streaming) and put the human-readable
   * name into `value` so the renderer/IDB still has something to display.
   */
  async function handlePickFile(rowId: string): Promise<void> {
    try {
      const api = (
        window as unknown as {
          api?: {
            dialog?: {
              openFile: (opts?: unknown) => Promise<{
                success: boolean
                data?: { filePath: string; fileName: string; size?: number }
                error?: string
              }>
            }
          }
        }
      ).api
      const result = await api?.dialog?.openFile({ title: t('formdata.chooseFile') })
      if (result && result.success && result.data) {
        onUpdate(rowId, {
          type: 'file',
          filePath: result.data.filePath,
          value: result.data.fileName,
        })
      }
    } catch {
      // Cancelled or main-process error — leave row unchanged.
    }
  }

  function clearFile(rowId: string): void {
    onUpdate(rowId, { filePath: undefined, value: '' })
  }

  const gridCols = enableFileType ? GRID_COLS_FILE : GRID_COLS

  // Bulk-edit mode: hidden when no onReplaceAll handler was passed.
  // File-type rows can't round-trip through a `key:value` textarea (file
  // paths aren't reasonable to express line-by-line), so we suppress the
  // toggle when `enableFileType` is on as well.
  const bulkEditEnabled = !!onReplaceAll && !enableFileType
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState('')
  // Snapshot rows on entry so repeated commits (blur → edit → blur) still
  // see the original descriptions instead of losing them on first commit.
  const bulkSnapshotRef = useRef<KeyValuePair[]>([])

  useEffect(() => {
    if (!bulkMode) return
    bulkSnapshotRef.current = rows
    setBulkText(rowsToBulkText(rows))
    // Only re-snapshot when entering bulk mode; preserve user's typing afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkMode])

  function commitBulk(): void {
    if (!onReplaceAll) return
    onReplaceAll(bulkTextToRows(bulkText, bulkSnapshotRef.current))
  }

  return (
    <div>
      {bulkEditEnabled && (
        <div className="mb-1 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              // Commit on the way back to table view so any unsaved edits
              // in the textarea aren't silently dropped.
              if (bulkMode) commitBulk()
              setBulkMode((v) => !v)
            }}
            className="cursor-pointer rounded border border-transparent bg-transparent text-[var(--accent)] hover:underline"
            style={{ fontSize: 13 }}
          >
            {bulkMode ? t('kv.keyValueEdit') : t('kv.bulkEdit')}
          </button>
        </div>
      )}
      {bulkMode ? (
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          onBlur={commitBulk}
          spellCheck={false}
          className="w-full rounded-md border border-[var(--border)] p-2 font-mono outline-none focus:border-[var(--accent)]"
          style={{
            background: 'var(--white)',
            color: 'var(--text)',
            fontSize: 13,
            minHeight: 180,
            resize: 'vertical',
          }}
          placeholder={'key:value\nkey2:value2\n//disabledKey:disabledValue'}
        />
      ) : (
        <div
          className="overflow-visible rounded-md border border-[var(--border)]"
          style={{ background: 'var(--white)' }}
        >
          {/* Header */}
          <div
            className="grid text-[var(--hint)]"
            style={{
              gridTemplateColumns: gridCols,
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <div />
            <div className="px-2.5 py-1">{t('kv.key')}</div>
            {enableFileType && <div className="px-2.5 py-1">{t('kv.type')}</div>}
            <div className="px-2.5 py-1">{t('kv.value')}</div>
            <div className="px-2.5 py-1">{t('kv.description')}</div>
            <div />
          </div>

          {/* Rows */}
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className="group grid"
              style={{
                gridTemplateColumns: gridCols,
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
                    if (
                      keyAutocompleteEnabled &&
                      keyAutocompleteEntries &&
                      row.key.length > 0 &&
                      !isInsideVariableExpression(row.key)
                    ) {
                      activeInputRef.current = e.currentTarget
                      const filtered = filterHeaderSuggestions(row.key, keyAutocompleteEntries)
                      if (filtered.length > 0) {
                        setAutocomplete({
                          rowId: row.id,
                          field: 'key',
                          suggestions: filtered,
                          selectedIndex: 0,
                        })
                      }
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full border-none bg-transparent px-2.5 py-[5px] text-[var(--text)] outline-none"
                  placeholder={t('kv.key')}
                />
              </div>

              {/* Type column (form-data only) */}
              {enableFileType && (
                <div
                  className="relative flex items-center"
                  style={{ borderRight: '1px solid var(--border)' }}
                >
                  <select
                    value={row.type === 'file' ? 'file' : 'text'}
                    onChange={(e) => {
                      const next = e.target.value as 'text' | 'file'
                      if (next === 'text') {
                        onUpdate(row.id, { type: 'text', filePath: undefined, value: '' })
                      } else {
                        onUpdate(row.id, { type: 'file' })
                      }
                    }}
                    className="w-full cursor-pointer border-none bg-transparent px-2.5 py-[5px] text-[var(--text)] outline-none"
                    style={{ appearance: 'none' }}
                  >
                    <option value="text">{t('formdata.text')}</option>
                    <option value="file">{t('formdata.file')}</option>
                  </select>
                </div>
              )}

              {/* Value */}
              <div className="relative" style={{ borderRight: '1px solid var(--border)' }}>
                {enableFileType && row.type === 'file' ? (
                  row.filePath ? (
                    <div className="flex items-center gap-1 px-2.5 py-[5px]">
                      <span
                        className="truncate text-[var(--text)]"
                        title={row.filePath}
                        style={{ flex: 1 }}
                      >
                        {row.value || row.filePath}
                      </span>
                      <button
                        type="button"
                        onClick={() => clearFile(row.id)}
                        className="cursor-pointer text-[var(--hint)] hover:text-[var(--accent)]"
                        style={{ background: 'transparent', border: 'none', padding: 2 }}
                        title={t('formdata.clearFile')}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handlePickFile(row.id)}
                      className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-2.5 py-[5px] text-[var(--muted)] outline-none hover:text-[var(--accent)]"
                    >
                      <Upload size={12} />
                      {t('formdata.chooseFile')}
                    </button>
                  )
                ) : (
                  <VariableAutocompleteInput
                    value={row.value}
                    onChange={(val) => handleValueInputChange(row.id, row.key, val, null)}
                    onKeyDown={handleKeyDown}
                    className="w-full border-none bg-transparent px-2.5 py-[5px] outline-none"
                    style={{ color: valueColor || 'var(--text)' }}
                    placeholder={t('kv.value')}
                  />
                )}
              </div>

              {/* Description */}
              <div>
                <input
                  value={row.description || ''}
                  onChange={(e) => onUpdate(row.id, { description: e.target.value })}
                  className="w-full border-none bg-transparent px-2.5 py-[5px] text-[var(--muted)] outline-none"
                  placeholder={t('kv.description')}
                />
              </div>

              {/* Delete */}
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hint)',
                    padding: 2,
                  }}
                  onMouseOver={(e) => {
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--red)'
                  }}
                  onMouseOut={(e) => {
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--hint)'
                  }}
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
              gridTemplateColumns: gridCols,
              borderTop: rows.length > 0 ? '1px solid var(--border)' : 'none',
            }}
            onClick={onAdd}
          >
            <div />
            <div className="px-2.5 py-[5px] text-[var(--hint)]">{t('kv.addNew')}</div>
            {enableFileType && <div />}
            <div />
            <div />
            <div />
          </div>
        </div>
      )}

      {/* Add button (table mode only — bulk mode adds rows via newline) */}
      {!bulkMode && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-1.5 w-full cursor-pointer rounded-md border border-dashed border-[var(--border)] bg-transparent py-1 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          {resolvedAddLabel}
        </button>
      )}

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
