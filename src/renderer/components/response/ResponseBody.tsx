import { useState } from 'react'
import { useResponseStore } from '../../stores/response.store'
import MonacoWrapper from '../shared/MonacoWrapper'

type ViewMode = 'Pretty' | 'Raw' | 'Preview'
type FormatMode = 'JSON' | 'XML'

export default function ResponseBody() {
  const response = useResponseStore((s) => s.response)
  const [viewMode, setViewMode] = useState<ViewMode>('Pretty')
  const [formatMode, setFormatMode] = useState<FormatMode>('JSON')

  const body = response?.body || ''

  // Try to format JSON for pretty view
  let prettyBody = body
  if (viewMode === 'Pretty' && formatMode === 'JSON') {
    try {
      prettyBody = JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      prettyBody = body
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* View mode toggle + format selector (rendered within the tab bar externally, but also here) */}
      <div className="flex shrink-0 items-center justify-end gap-0.5 border-b border-[var(--border)] bg-[var(--white)] px-2.5 py-1">
        {(['Pretty', 'Raw', 'Preview'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className="cursor-pointer rounded-[5px] px-2 py-[3px] text-[0.875rem] transition-colors"
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
        <select
          value={formatMode}
          onChange={(e) => setFormatMode(e.target.value as FormatMode)}
          className="ml-1.5 rounded-[5px] border border-[var(--border2)] bg-[var(--bg)] px-1.5 py-[2px] text-[0.875rem] text-[var(--muted)] outline-none"
        >
          <option>JSON</option>
          <option>XML</option>
        </select>
      </div>

      {/* Body content */}
      <div className="flex-1 overflow-auto bg-[var(--surface)]">
        {viewMode === 'Pretty' && (
          <MonacoWrapper
            value={prettyBody}
            language={formatMode === 'XML' ? 'xml' : 'json'}
            readOnly
            lineNumbers="off"
            height="100%"
          />
        )}

        {viewMode === 'Raw' && (
          <pre className="m-0 whitespace-pre-wrap p-3.5 font-mono text-sm leading-relaxed text-[var(--text)]">
            {body}
          </pre>
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
