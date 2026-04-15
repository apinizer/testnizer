import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import KeyValueTable from '../shared/KeyValueTable'
import WsConnectionBar from './WsConnectionBar'
import WsComposer from './WsComposer'
import WsMessageLog from './WsMessageLog'

export default function WebSocketEditor() {
  const [headersExpanded, setHeadersExpanded] = useState(false)
  const customHeaders = useWebSocketStore((s) => s.customHeaders)
  const addHeader = useWebSocketStore((s) => s.addHeader)
  const updateHeader = useWebSocketStore((s) => s.updateHeader)
  const removeHeader = useWebSocketStore((s) => s.removeHeader)
  const connectionState = useWebSocketStore((s) => s.connectionState)

  const enabledHeaderCount = customHeaders.filter((h) => h.enabled && h.key.trim()).length

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          WebSocket
        </span>
        {connectionState === 'connected' && (
          <span className="rounded-full px-2 py-0.5 font-medium" style={{ background: '#e8f9f1', color: '#1a7a4a' }}>
            Connected
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {/* Connection bar */}
        <WsConnectionBar />

        {/* Custom headers (collapsible) */}
        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setHeadersExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {headersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Settings2 size={14} className="text-[var(--muted)]" />
            <span>Custom Headers</span>
            {enabledHeaderCount > 0 && (
              <span
                className="ml-1 rounded-full px-[5px]"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                {enabledHeaderCount}
              </span>
            )}
          </button>
          {headersExpanded && (
            <div className="border-t border-[var(--border)] p-3">
              <KeyValueTable
                rows={customHeaders}
                onUpdate={updateHeader}
                onRemove={removeHeader}
                onAdd={addHeader}
                addLabel="+ Add Header"
              />
            </div>
          )}
        </div>

        {/* Message composer */}
        <WsComposer />

        {/* Message log */}
        <WsMessageLog />
      </div>
    </div>
  )
}
