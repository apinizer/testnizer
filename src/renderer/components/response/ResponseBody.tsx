import { useState, useMemo } from 'react'
import { useResponseStore } from '../../stores/response.store'
import MonacoWrapper from '../shared/MonacoWrapper'

type ViewMode = 'Pretty' | 'Raw' | 'Preview'
type FormatMode = 'JSON' | 'XML' | 'HTML' | 'Text'

export default function ResponseBody() {
  const response = useResponseStore((s) => s.response)
  const [viewMode, setViewMode] = useState<ViewMode>('Pretty')
  const [formatMode, setFormatMode] = useState<FormatMode>('JSON')

  const body = response?.body || ''

  // Auto-detect format from content-type header
  const autoFormat = useMemo<FormatMode>(() => {
    const ct = response?.headers?.['content-type'] || ''
    if (ct.includes('xml') || ct.includes('soap')) return 'XML'
    if (ct.includes('html')) return 'HTML'
    if (ct.includes('json')) return 'JSON'
    // Try parsing as JSON
    try { JSON.parse(body); return 'JSON' } catch { /* ignore */ }
    if (body.trimStart().startsWith('<')) return 'XML'
    return 'Text'
  }, [response, body])

  const effectiveFormat = formatMode || autoFormat

  // Pretty-print for Pretty view
  const prettyBody = useMemo(() => {
    if (viewMode !== 'Pretty') return body
    if (effectiveFormat === 'JSON') {
      try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body }
    }
    return body
  }, [body, viewMode, effectiveFormat])

  const monacoLang = effectiveFormat === 'XML' ? 'xml'
    : effectiveFormat === 'HTML' ? 'html'
    : effectiveFormat === 'JSON' ? 'json'
    : 'plaintext'

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — Postman style: Raw/Preview toggle + format dropdown */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--white)] px-2 py-0.5">
        {(['Pretty', 'Raw', 'Preview'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className="cursor-pointer rounded px-1.5 py-0.5 text-[13px] transition-colors"
            style={{
              background: viewMode === mode ? 'var(--accent-light)' : 'transparent',
              color: viewMode === mode ? 'var(--accent-text)' : 'var(--muted)',
              fontWeight: viewMode === mode ? 500 : 400,
              border: 'none',
            }}
          >
            {mode}
          </button>
        ))}

        <span className="mx-1" style={{ color: 'var(--border2)' }}>|</span>

        <select
          value={formatMode}
          onChange={(e) => setFormatMode(e.target.value as FormatMode)}
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-px text-[13px] font-medium text-[var(--accent-text)] outline-none"
        >
          <option value="JSON">JSON</option>
          <option value="XML">XML</option>
          <option value="HTML">HTML</option>
          <option value="Text">Text</option>
        </select>

        <div className="flex-1" />

        {/* Copy button */}
        <button
          type="button"
          className="cursor-pointer rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
          onClick={() => { if (body) navigator.clipboard.writeText(body) }}
        >
          Copy
        </button>
      </div>

      {/* Body content */}
      <div className="flex-1 overflow-hidden bg-[var(--surface)]">
        {viewMode === 'Pretty' && (
          <MonacoWrapper
            value={prettyBody}
            language={monacoLang}
            readOnly
            lineNumbers="on"
            height="100%"
          />
        )}

        {viewMode === 'Raw' && (
          <MonacoWrapper
            value={body}
            language="plaintext"
            readOnly
            lineNumbers="on"
            height="100%"
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
