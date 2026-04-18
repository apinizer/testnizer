import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useEnvironmentStore } from '../../stores/environment.store'

/** Built-in dynamic variables with $ prefix */
const BUILTIN_DYNAMIC_VARS: { name: string; description: string }[] = [
  { name: '$randomInt', description: 'Random integer 0-1000' },
  { name: '$randomInt(min,max)', description: 'Random integer in range' },
  { name: '$timestamp', description: 'Unix timestamp (seconds)' },
  { name: '$isoTimestamp', description: 'ISO 8601 date string' },
  { name: '$randomUUID', description: 'Random UUID v4' },
  { name: '$randomEmail', description: 'Random email address' },
  { name: '$randomName', description: 'Random full name' },
  { name: '$randomString', description: 'Random 8-char string' },
  { name: '$randomString(n)', description: 'Random n-char string' },
  { name: '$datetime(format)', description: 'Formatted date (YYYY-MM-DD etc.)' },
]

type VariableCategory = 'environment' | 'global' | 'dynamic'

interface Suggestion {
  name: string
  value: string
  category: VariableCategory
  description?: string
}

const CATEGORY_CONFIG: Record<VariableCategory, { label: string; color: string; bg: string }> = {
  environment: { label: 'E', color: '#2D5FA0', bg: '#e8f0fa' },
  global: { label: 'G', color: '#1a7a4a', bg: '#e8f9f1' },
  dynamic: { label: 'D', color: '#b35a00', bg: '#fff4e0' },
}

interface VariableAutocompleteInputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  style?: React.CSSProperties
  className?: string
}

/**
 * An input that shows variable autocomplete when the user types `{{`.
 * Displays environment variables, global variables, and built-in dynamic vars.
 */
export default function VariableAutocompleteInput({
  value,
  onChange,
  onKeyDown: externalKeyDown,
  placeholder,
  style,
  className,
}: VariableAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [queryStart, setQueryStart] = useState(-1) // cursor position where {{ started
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })

  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const globalVariables = useEnvironmentStore((s) => s.globalVariables)

  const getActiveEnvVars = useCallback((): Suggestion[] => {
    const env = environments.find((e) => e.id === activeEnvironmentId)
    if (!env) return []
    return env.variables
      .filter((v) => v.enabled)
      .map((v) => ({
        name: v.key,
        value: v.value || v.initialValue || '',
        category: 'environment' as VariableCategory,
      }))
  }, [environments, activeEnvironmentId])

  const getGlobalVars = useCallback((): Suggestion[] => {
    return globalVariables
      .filter((v) => v.enabled)
      .map((v) => ({
        name: v.key,
        value: v.value || v.initialValue || '',
        category: 'global' as VariableCategory,
      }))
  }, [globalVariables])

  const getDynamicVars = useCallback((): Suggestion[] => {
    return BUILTIN_DYNAMIC_VARS.map((v) => ({
      name: v.name,
      value: '',
      category: 'dynamic' as VariableCategory,
      description: v.description,
    }))
  }, [])

  const updateSuggestions = useCallback(
    (query: string) => {
      const all = [...getActiveEnvVars(), ...getGlobalVars(), ...getDynamicVars()]
      const q = query.toLowerCase()
      const filtered = q
        ? all.filter((s) => s.name.toLowerCase().includes(q))
        : all
      setSuggestions(filtered)
      setSelectedIndex(0)
    },
    [getActiveEnvVars, getGlobalVars, getDynamicVars]
  )

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    // Position dropdown below the input
    setDropPos({
      top: rect.bottom + 2,
      left: rect.left,
    })
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value
      const cursorPos = e.target.selectionStart || 0
      onChange(newVal)

      // Check if we're inside a {{ ... context
      const textBeforeCursor = newVal.slice(0, cursorPos)
      const lastOpen = textBeforeCursor.lastIndexOf('{{')
      const lastClose = textBeforeCursor.lastIndexOf('}}')

      if (lastOpen !== -1 && lastOpen > lastClose) {
        // We're inside {{ ... — extract the query after {{
        const query = textBeforeCursor.slice(lastOpen + 2)
        // Don't show if there's a space before any text (user likely not typing a variable)
        if (!query.includes('}}')) {
          setQueryStart(lastOpen)
          updateSuggestions(query)
          updateDropdownPosition()
          return
        }
      }

      // Not in a variable context
      setSuggestions([])
      setQueryStart(-1)
    },
    [onChange, updateSuggestions, updateDropdownPosition]
  )

  const selectSuggestion = useCallback(
    (suggestion: Suggestion) => {
      if (queryStart === -1 || !inputRef.current) return

      const cursorPos = inputRef.current.selectionStart || value.length
      const before = value.slice(0, queryStart)
      const after = value.slice(cursorPos)
      const varName = suggestion.name
      const newValue = `${before}{{${varName}}}${after}`
      onChange(newValue)

      setSuggestions([])
      setQueryStart(-1)

      // Set cursor position after the inserted variable
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const newPos = before.length + varName.length + 4 // {{name}}
          inputRef.current.setSelectionRange(newPos, newPos)
          inputRef.current.focus()
        }
      })
    },
    [queryStart, value, onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          e.stopPropagation()
          selectSuggestion(suggestions[selectedIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSuggestions([])
          setQueryStart(-1)
          return
        }
      }
      externalKeyDown?.(e)
    },
    [suggestions, selectedIndex, selectSuggestion, externalKeyDown]
  )

  // Close on outside click
  useEffect(() => {
    if (suggestions.length === 0) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setSuggestions([])
        setQueryStart(-1)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [suggestions.length])

  // Scroll selected item into view
  useEffect(() => {
    if (!dropRef.current || suggestions.length === 0) return
    const items = dropRef.current.querySelectorAll('[data-suggestion-item]')
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, suggestions.length])

  const isOpen = suggestions.length > 0

  // Sync overlay scroll with input scroll; also copy computed padding/font
  // so the overlay aligns exactly even when styles come from classNames.
  const overlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const input = inputRef.current
    const overlay = overlayRef.current
    if (!input || !overlay) return
    const cs = window.getComputedStyle(input)
    overlay.style.paddingLeft = cs.paddingLeft
    overlay.style.paddingRight = cs.paddingRight
    overlay.style.paddingTop = cs.paddingTop
    overlay.style.paddingBottom = cs.paddingBottom
    overlay.style.fontFamily = cs.fontFamily
    overlay.style.fontSize = cs.fontSize
    overlay.style.fontWeight = cs.fontWeight
    overlay.style.lineHeight = cs.lineHeight
    overlay.style.letterSpacing = cs.letterSpacing
    const syncScroll = () => {
      overlay.scrollLeft = input.scrollLeft
    }
    input.addEventListener('scroll', syncScroll)
    return () => input.removeEventListener('scroll', syncScroll)
  }, [value, className, style])

  // Build highlighted segments: plain text between {{ }} + colored variable tokens
  const segments = useMemo(() => {
    const out: Array<{ text: string; isVar: boolean }> = []
    const re = /\{\{[^}]*?\}\}/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      if (m.index > last) out.push({ text: value.slice(last, m.index), isVar: false })
      out.push({ text: m[0], isVar: true })
      last = m.index + m[0].length
    }
    if (last < value.length) out.push({ text: value.slice(last), isVar: false })
    return out
  }, [value])

  // Extract font-related style props to sync overlay. We mirror padding and
  // font metrics so overlay glyphs align exactly with the input caret.
  const inputStyle = (style || {}) as React.CSSProperties
  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    display: 'flex',
    alignItems: 'center',
    padding: inputStyle.padding,
    paddingLeft: inputStyle.paddingLeft,
    paddingRight: inputStyle.paddingRight,
    paddingTop: inputStyle.paddingTop,
    paddingBottom: inputStyle.paddingBottom,
    fontFamily: inputStyle.fontFamily,
    fontSize: inputStyle.fontSize,
    fontWeight: inputStyle.fontWeight,
    lineHeight: inputStyle.lineHeight,
    letterSpacing: inputStyle.letterSpacing,
    color: inputStyle.color || 'var(--text)',
    borderRadius: inputStyle.borderRadius,
    // Transparent border so overlay box matches input's content box
    border: '1px solid transparent',
    boxSizing: inputStyle.boxSizing || 'border-box',
  }

  // Hide the real text in the input so only the overlay shows colored text,
  // but keep the caret visible.
  const inputOverlayHider: React.CSSProperties = value
    ? { color: 'transparent', caretColor: (inputStyle as React.CSSProperties).color as string || 'var(--text)' }
    : {}

  return (
    <>
      <span
        style={{
          position: 'relative',
          display: 'flex',
          flex: (inputStyle as React.CSSProperties).flex ?? undefined,
          width: className?.includes('w-full') ? '100%' : (inputStyle as React.CSSProperties).width,
          minWidth: 0,
        }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            ...inputStyle,
            ...inputOverlayHider,
            flex: 1,
            width: '100%',
            position: 'relative',
            zIndex: 1,
            background: 'transparent',
          }}
          className={className}
        />
        <div ref={overlayRef} aria-hidden="true" style={overlayStyle}>
          {segments.map((seg, i) =>
            seg.isVar ? (
              <span key={i} style={{ color: 'var(--variable-color, #0066cc)', fontWeight: 500 }}>{seg.text}</span>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </div>
      </span>
      {isOpen &&
        createPortal(
          <div
            ref={dropRef}
            style={{
              position: 'fixed',
              top: dropPos.top,
              left: dropPos.left,
              zIndex: 999999,
              minWidth: 280,
              maxWidth: 420,
              maxHeight: 240,
              overflowY: 'auto',
              background: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
              padding: 4,
            }}
          >
            {suggestions.map((s, i) => {
              const cfg = CATEGORY_CONFIG[s.category]
              return (
                <div
                  key={`${s.category}-${s.name}`}
                  data-suggestion-item
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectSuggestion(s)
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 8px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    background: i === selectedIndex ? 'var(--accent-light)' : 'transparent',
                  }}
                >
                  {/* Category badge */}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      fontSize: 13,
                      fontWeight: 700,
                      color: cfg.color,
                      background: cfg.bg,
                      flexShrink: 0,
                    }}
                  >
                    {cfg.label}
                  </span>
                  {/* Variable name */}
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--text)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.name}
                  </span>
                  {/* Value preview or description */}
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--muted)',
                      fontStyle: 'italic',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 140,
                      textAlign: 'right',
                    }}
                  >
                    {s.description || s.value}
                  </span>
                </div>
              )
            })}
            {suggestions.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--muted)' }}>
                No variables found
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
