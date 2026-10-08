import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { useMcpStore } from '../../stores/mcp.store'
import KeyValueTable from '../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../lib/http-headers'

/**
 * Collapsible "Custom Headers" block for the MCP editor (issue #137) — sends
 * `Authorization: Bearer …` / API-gateway `X-…` headers on the Streamable
 * HTTP / SSE handshake. Mirrors the SSE editor's block. Rows stay editable
 * while connected; edits apply on the next Connect. Hidden for stdio, which
 * has no HTTP layer.
 */
export default function McpHeadersSection() {
  const [expanded, setExpanded] = useState(false)
  const transport = useMcpStore((s) => s.transport)
  const customHeaders = useMcpStore((s) => s.customHeaders)
  const addHeader = useMcpStore((s) => s.addHeader)
  const updateHeader = useMcpStore((s) => s.updateHeader)
  const removeHeader = useMcpStore((s) => s.removeHeader)

  if (transport === 'stdio') return null

  const enabledCount = customHeaders.filter((h) => h.enabled && h.key.trim()).length

  return (
    <div
      data-testid="mcp-headers-section"
      className="shrink-0 border-b border-[var(--border)] px-3.5 py-2"
    >
      <div className="rounded-lg border border-[var(--border)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="mcp-headers-toggle"
          aria-expanded={expanded}
          className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Settings2 size={14} className="text-[var(--muted)]" />
          <span>Custom Headers</span>
          {enabledCount > 0 && (
            <span
              data-testid="mcp-headers-count"
              className="ml-1 rounded-full bg-[var(--green-bg)] px-[5px] text-[var(--green)]"
            >
              {enabledCount}
            </span>
          )}
        </button>
        {expanded && (
          <div className="max-h-60 overflow-auto border-t border-[var(--border)] p-3">
            <KeyValueTable
              rows={customHeaders}
              onUpdate={updateHeader}
              onRemove={removeHeader}
              onAdd={addHeader}
              addLabel="+ Add Header"
              keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
            />
          </div>
        )}
      </div>
    </div>
  )
}
