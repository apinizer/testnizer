import { useState, useMemo, useRef, useEffect } from 'react'
import { useResponseStore } from '../../stores/response.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import {
  ChevronDown,
  Play,
  Image as ImageIcon,
  WrapText,
  Filter,
  Search,
  Copy,
  ExternalLink,
  Check,
} from 'lucide-react'

type ViewMode = 'Pretty' | 'Raw' | 'Preview'
type FormatMode = 'JSON' | 'XML' | 'HTML' | 'Text'

/**
 * Postman-style response body viewer.
 *
 * Layout (matches res60.png):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ {} JSON ▾   ▷ Preview   [img] Visualize  ▾  │ ⇌ ≡ 🔎 ⎘ ↗ │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  1  [                                                    │
 *   │  2    {                                                  │
 *   │  ...                                                     │
 *   └──────────────────────────────────────────────────────────┘
 */
export default function ResponseBody() {
  const response = useResponseStore((s) => s.response)
  const [viewMode, setViewMode] = useState<ViewMode>('Pretty')
  const [formatMode, setFormatMode] = useState<FormatMode>('JSON')
  const [formatOpen, setFormatOpen] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [filter, setFilter] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [copied, setCopied] = useState(false)
  const formatRef = useRef<HTMLDivElement>(null)

  const body = response?.body || ''

  // Auto-detect format from content-type header
  const autoFormat = useMemo<FormatMode>(() => {
    const ct = response?.headers?.['content-type'] || ''
    if (ct.includes('xml') || ct.includes('soap')) return 'XML'
    if (ct.includes('html')) return 'HTML'
    if (ct.includes('json')) return 'JSON'
    try { JSON.parse(body); return 'JSON' } catch { /* ignore */ }
    if (body.trimStart().startsWith('<')) return 'XML'
    return 'Text'
  }, [response, body])

  // Initialize format mode from autoFormat once per response
  useEffect(() => {
    setFormatMode(autoFormat)
  }, [autoFormat])

  const effectiveFormat = formatMode || autoFormat

  // Close format dropdown on outside click
  useEffect(() => {
    if (!formatOpen) return
    const handler = (e: MouseEvent) => {
      if (formatRef.current && !formatRef.current.contains(e.target as Node)) {
        setFormatOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [formatOpen])

  // Pretty-print for Pretty view
  const prettyBody = useMemo(() => {
    if (viewMode !== 'Pretty') return body
    if (effectiveFormat === 'JSON') {
      try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body }
    }
    if (effectiveFormat === 'XML' || effectiveFormat === 'HTML') {
      return formatXml(body)
    }
    return body
  }, [body, viewMode, effectiveFormat])

  // Apply filter (simple substring — highlighting done by editor search)
  const displayBody = useMemo(() => {
    if (!filter.trim() || viewMode !== 'Pretty') return prettyBody
    // For JSON: try jsonpath-like filter; fall back to substring grep of lines.
    if (effectiveFormat === 'JSON') {
      try {
        const parsed = JSON.parse(prettyBody)
        if (Array.isArray(parsed)) {
          const f = filter.toLowerCase()
          const matches = parsed.filter((item) => JSON.stringify(item).toLowerCase().includes(f))
          return JSON.stringify(matches, null, 2)
        }
      } catch { /* ignore */ }
    }
    const lines = prettyBody.split('\n').filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    return lines.join('\n')
  }, [prettyBody, filter, viewMode, effectiveFormat])

  const monacoLang = effectiveFormat === 'XML' ? 'xml'
    : effectiveFormat === 'HTML' ? 'html'
    : effectiveFormat === 'JSON' ? 'json'
    : 'plaintext'

  async function handleCopy() {
    if (!body) return
    try {
      await navigator.clipboard.writeText(displayBody || body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  const ICON_BTN: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    padding: 5,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ── */}
      <div
        className="flex shrink-0 items-center gap-1 px-2"
        style={{
          background: 'var(--white)',
          borderBottom: '1px solid var(--border)',
          height: 32,
        }}
      >
        {/* Format dropdown — { } JSON ▾ */}
        <div ref={formatRef} className="relative">
          <button
            type="button"
            onClick={() => setFormatOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-[3px] text-[12px]"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontWeight: 500,
            }}
          >
            <span style={{ color: 'var(--muted)' }}>{'{ }'}</span>
            {formatMode}
            <ChevronDown size={11} style={{ color: 'var(--muted)' }} />
          </button>
          {formatOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-md py-1 shadow-lg"
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
              }}
            >
              {(['JSON', 'XML', 'HTML', 'Text'] as FormatMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setFormatMode(m); setFormatOpen(false) }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--item-hover)]"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text)' }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View mode buttons — Pretty/Raw as tab-like links */}
        <button
          type="button"
          onClick={() => setViewMode('Pretty')}
          className="cursor-pointer rounded px-2 py-[3px] text-[12px] transition-colors"
          style={{
            background: 'transparent',
            border: 'none',
            color: viewMode === 'Pretty' ? 'var(--accent-text)' : 'var(--muted)',
            fontWeight: viewMode === 'Pretty' ? 600 : 400,
          }}
        >
          <span className="inline-flex items-center gap-1">
            <Play size={11} style={{ color: viewMode === 'Pretty' ? 'var(--accent)' : 'var(--muted)' }} />
            Preview
          </span>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('Raw')}
          className="cursor-pointer rounded px-2 py-[3px] text-[12px] transition-colors"
          style={{
            background: 'transparent',
            border: 'none',
            color: viewMode === 'Raw' ? 'var(--accent-text)' : 'var(--muted)',
            fontWeight: viewMode === 'Raw' ? 600 : 400,
          }}
        >
          Raw
        </button>

        <button
          type="button"
          onClick={() => setViewMode('Preview')}
          className="cursor-pointer rounded px-2 py-[3px] text-[12px] transition-colors"
          style={{
            background: 'transparent',
            border: 'none',
            color: viewMode === 'Preview' ? 'var(--accent-text)' : 'var(--muted)',
            fontWeight: viewMode === 'Preview' ? 600 : 400,
          }}
        >
          <span className="inline-flex items-center gap-1">
            <ImageIcon size={11} />
            Visualize
          </span>
        </button>

        <div className="flex-1" />

        {/* Right-side icon actions — wrap • filter • search • copy • external */}
        <button
          type="button"
          title={wrap ? 'Disable word wrap' : 'Enable word wrap'}
          onClick={() => setWrap((v) => !v)}
          style={{
            ...ICON_BTN,
            color: wrap ? 'var(--accent)' : 'var(--muted)',
            background: wrap ? 'var(--accent-light)' : 'transparent',
          }}
        >
          <WrapText size={13} />
        </button>

        <button
          type="button"
          title="Filter"
          onClick={() => setShowFilter((v) => !v)}
          style={{
            ...ICON_BTN,
            color: showFilter ? 'var(--accent)' : 'var(--muted)',
            background: showFilter ? 'var(--accent-light)' : 'transparent',
          }}
        >
          <Filter size={13} />
        </button>

        <button type="button" title="Search" style={ICON_BTN}>
          <Search size={13} />
        </button>

        <button
          type="button"
          title="Copy"
          onClick={handleCopy}
          style={{
            ...ICON_BTN,
            color: copied ? 'var(--green)' : 'var(--muted)',
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>

        <button type="button" title="Open in new tab" style={ICON_BTN}>
          <ExternalLink size={13} />
        </button>
      </div>

      {/* Filter input bar (toggles on) */}
      {showFilter && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-1.5"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        >
          <Filter size={11} style={{ color: 'var(--muted)' }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter response... (substring or JSONPath-like)"
            autoFocus
            className="flex-1 text-[12px] outline-none"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '3px 8px',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="cursor-pointer text-[11px]"
              style={{ color: 'var(--muted)', background: 'transparent', border: 'none' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Body content ── */}
      <div className="flex-1 overflow-hidden bg-[var(--white)]">
        {viewMode === 'Pretty' && (
          <MonacoWrapper
            value={displayBody}
            language={monacoLang}
            readOnly
            lineNumbers="on"
            height="100%"
            wordWrap={wrap}
          />
        )}

        {viewMode === 'Raw' && (
          <MonacoWrapper
            value={body}
            language="plaintext"
            readOnly
            lineNumbers="on"
            height="100%"
            wordWrap={wrap}
          />
        )}

        {viewMode === 'Preview' && (
          <iframe
            srcDoc={body}
            className="h-full w-full border-none"
            sandbox="allow-same-origin"
            title="Response Preview"
          />
        )}
      </div>
    </div>
  )
}

/** Simple XML/HTML beautifier — adds indentation without external deps */
function formatXml(xml: string): string {
  try {
    const PADDING = '  '
    let formatted = ''
    let indent = 0
    // Normalize: remove existing whitespace between tags
    const normalized = xml.replace(/(>)\s*(<)/g, '$1\n$2').trim()
    const lines = normalized.split('\n')

    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue

      // Closing tag
      if (line.startsWith('</')) {
        indent = Math.max(0, indent - 1)
        formatted += PADDING.repeat(indent) + line + '\n'
      }
      // Self-closing tag or processing instruction
      else if (line.endsWith('/>') || line.startsWith('<?')) {
        formatted += PADDING.repeat(indent) + line + '\n'
      }
      // Opening tag that also has a closing tag on the same line: <tag>value</tag>
      else if (line.startsWith('<') && line.includes('</') && !line.startsWith('<!--')) {
        formatted += PADDING.repeat(indent) + line + '\n'
      }
      // Opening tag
      else if (line.startsWith('<') && !line.startsWith('<!--')) {
        formatted += PADDING.repeat(indent) + line + '\n'
        indent++
      }
      // Comment or text content
      else {
        formatted += PADDING.repeat(indent) + line + '\n'
      }
    }
    return formatted.trimEnd()
  } catch {
    return xml
  }
}
