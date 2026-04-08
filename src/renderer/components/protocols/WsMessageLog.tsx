import { useState, useEffect, useRef } from 'react'
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import type { WsMessage } from '../../types'

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function formatContent(msg: WsMessage): string {
  if (msg.contentType === 'json') {
    try {
      return JSON.stringify(JSON.parse(msg.content), null, 2)
    } catch {
      return msg.content
    }
  }
  return msg.content
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}

export default function WsMessageLog() {
  const messages = useWebSocketStore((s) => s.messages)
  const clearMessages = useWebSocketStore((s) => s.clearMessages)
  const autoScroll = useWebSocketStore((s) => s.autoScroll)
  const setAutoScroll = useWebSocketStore((s) => s.setAutoScroll)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, autoScroll])

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--hint)]">
            No messages yet. Connect and send a message to begin.
          </div>
        ) : (
          messages.map((msg) => {
            const isSent = msg.direction === 'sent'
            const isExpanded = expandedId === msg.id
            return (
              <div
                key={msg.id}
                className="cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
                onClick={() => setExpandedId(isExpanded ? null : msg.id)}
              >
                <div className="flex items-center gap-2">
                  {/* Direction */}
                  {isSent ? (
                    <ArrowUp size={12} className="shrink-0 text-[var(--blue)]" />
                  ) : (
                    <ArrowDown size={12} className="shrink-0 text-[var(--green)]" />
                  )}
                  {/* Preview */}
                  <span className="flex-1 truncate font-mono text-[0.875rem] text-[var(--text)]">
                    {truncate(msg.content.replace(/\n/g, ' '), 80)}
                  </span>
                  {/* Type badge */}
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[0.643rem] font-medium uppercase" style={{
                    background: msg.contentType === 'json' ? 'var(--accent-light)' : 'var(--surface)',
                    color: msg.contentType === 'json' ? 'var(--accent-text)' : 'var(--muted)',
                  }}>
                    {msg.contentType}
                  </span>
                  {/* Timestamp */}
                  <span className="shrink-0 text-[0.875rem] text-[var(--hint)]">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                {/* Expanded content */}
                {isExpanded && (
                  <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[0.875rem] text-[var(--text)]">
                    {formatContent(msg)}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[0.875rem] text-[var(--muted)]">
          {messages.length} message{messages.length !== 1 ? 's' : ''}
          {' '}({messages.filter((m) => m.direction === 'sent').length} sent,{' '}
          {messages.filter((m) => m.direction === 'received').length} received)
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-[0.875rem] text-[var(--muted)]">Auto-scroll</span>
          </label>
          <button
            type="button"
            onClick={clearMessages}
            className="flex cursor-pointer items-center gap-1 text-[0.875rem] text-[var(--hint)] transition-colors hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <Trash2 size={11} />
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
